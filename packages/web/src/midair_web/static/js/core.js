// 全体機能 (フレームワーク層):
//   UI ヘルパ / 幾何 / 手書きキャンバス / 検索クライアント /
//   MediaPipe パイプライン / 入力モードの振り分け / 言語切替モーション / 初期化。
// 言語ごとの入力ロジックは modes/<lang>.js に分離し、ここは振り分けだけを担う。
import {
  MP_ASSET, LM, EMA, EDGE_MARGIN, POINTER_STYLE, DEFAULT_TOP_K,
  BACK_HOLD_MS, LANG_COOLDOWN_MS, FLIP_WINDOW_MS, ORIENT_DEADZONE,
  INPUT_MODES, MODE_GUIDE,
} from "./config.js";
import emoji from "./modes/emoji.js";
import japanese, { jpFlickBackspace, jpFlickClear, renderJapaneseSettings } from "./modes/japanese.js";
import english, { renderEnglishSettings } from "./modes/english.js";
import { testCheck, testNext, initTest, refreshTest } from "./test.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================================================================
//  UI / 描画ヘルパ
// =====================================================================
export const $ = (id) => document.getElementById(id);
export const setStatus = (t) => { const e = $("status"); if (e) e.textContent = t; };
export const setGesture = (t) => { const g = $("gesture"); if (g) g.textContent = t; };

export function setCameraState(state, label, detail = "", progress = 0) {
  const box = $("camStatus"), meter = $("camMeter"), bar = $("camMeterBar");
  if (!box) return;
  box.dataset.state = state;
  $("camStateLabel").textContent = label;
  $("camStateDetail").textContent = detail;
  const pct = Math.max(0, Math.min(1, progress || 0));
  bar.style.width = `${Math.round(pct * 100)}%`;
  meter.classList.toggle("active", pct > 0 && pct < 1);
}

let modeToastTimer = null;
export function showModeToast(text) {
  const t = $("modeToast");
  if (!t) return;
  t.textContent = text;
  t.classList.add("show");
  if (modeToastTimer) clearTimeout(modeToastTimer);
  modeToastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

// カメラ overlay 上の発火フラッシュ (絵文字の確定 / 言語切替で使う)
let flash = null;
export function setFlash(text, until) { flash = { text, until }; }
export function clearFlash() { flash = null; }

export function drawOverlay(octx, lm, overlay, now) {
  const W = overlay.width, H = overlay.height;
  octx.fillStyle = "rgba(154,163,178,0.85)";
  for (const p of lm) { octx.beginPath(); octx.arc(p.x * W, p.y * H, 3, 0, Math.PI * 2); octx.fill(); }
  if (flash && now < flash.until) {
    octx.fillStyle = "rgba(0,0,0,0.5)"; octx.fillRect(0, 0, W, H);
    octx.save(); octx.scale(-1, 1);   // overlay は CSS ミラーなので文字だけ反転して戻す
    octx.fillStyle = "#fff"; octx.font = "bold 22px system-ui"; octx.textAlign = "center";
    octx.fillText(flash.text, -W / 2, H / 2);
    octx.restore();
  }
}

export function clearPadCursor() {
  const c = $("padCursor"); if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
}

export function drawPadCursor(x, y, mode) {
  const c = $("padCursor"); if (!c) return;
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  if (mode === "draw") {   // ペン書き: 赤い点
    g.fillStyle = "#ff5b5b";
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill();
    return;
  }
  if (POINTER_STYLE === "crosshair") {
    g.strokeStyle = "rgba(0,0,0,0.85)"; g.lineWidth = 1;
    const s = 7;
    g.beginPath();
    g.moveTo(x - s, y); g.lineTo(x + s, y);
    g.moveTo(x, y - s); g.lineTo(x, y + s);
    g.stroke();
  } else {   // レーザーポインタ (赤い発光ドット)
    const r = 9;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0.0, "rgba(255,90,70,0.85)");
    grad.addColorStop(0.45, "rgba(235,30,30,0.55)");
    grad.addColorStop(1.0, "rgba(220,0,0,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}

function updateOrientUI(orient) {
  const el = $("orientLabel");
  if (!el) return;
  el.textContent = orient === "palm" ? "手のひら" : orient === "back" ? "手の甲" : "—";
  el.className = "orient-val " + (orient === "back" ? "orient-back" : orient === "palm" ? "orient-palm" : "");
}

// =====================================================================
//  幾何ヘルパ (ランドマークの解釈に使う共通部品)
// =====================================================================
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 指が「伸びている」= 指先が PIP より手首から遠い
export const fingerUp = (lm, tip, pip) => dist(lm[tip], lm[LM.WRIST]) > dist(lm[pip], lm[LM.WRIST]) * 1.05;

// 画角の端マージンを除いた内側 [EDGE_MARGIN, 1-EDGE_MARGIN] を [0,1] にリマップ+クランプ。
// これで端(不安定)まで手を出さずに描画面の隅へ届き、端でのブレも隅にクランプされる。
function remapEdge(v) {
  const t = (v - EDGE_MARGIN) / (1 - 2 * EDGE_MARGIN);
  return Math.max(0, Math.min(1, t));
}

// ペン先(人差し+中指の中点, 左右反転)を EMA 平滑化した canvas 座標を返す
function penTip(lm, prev, width, height) {
  const ix = (lm[LM.INDEX_TIP].x + lm[LM.MIDDLE_TIP].x) / 2;
  const iy = (lm[LM.INDEX_TIP].y + lm[LM.MIDDLE_TIP].y) / 2;
  const cx = (1 - remapEdge(ix)) * width, cy = remapEdge(iy) * height;
  if (!prev) return { x: cx, y: cy };
  return { x: prev.x + (cx - prev.x) * EMA, y: prev.y + (cy - prev.y) * EMA };
}

// 手が枠内に収まっているか。一部でも画角外(palm 見切れ等)なら false。
// 見切れた手はランドマーク位置が外挿されて不安定になり、向き判定や言語切替を誤爆させるため無効化する。
const VISIBLE_MARGIN = 0.05;   // このぶんのはみ出しは許容 (端ノイズ用)
function handFullyVisible(lm) {
  for (const p of lm) {
    if (p.x < -VISIBLE_MARGIN || p.x > 1 + VISIBLE_MARGIN ||
        p.y < -VISIBLE_MARGIN || p.y > 1 + VISIBLE_MARGIN) return false;
  }
  return true;
}

// 4本指がすべて伸展 (パー相当) か。折り曲げ/入力中は言語切替を評価しないためのゲートに使う。
function fingersExtended(lm) {
  return fingerUp(lm, LM.INDEX_TIP, LM.INDEX_PIP) && fingerUp(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP) &&
         fingerUp(lm, LM.RING_TIP, LM.RING_PIP) && fingerUp(lm, LM.PINKY_TIP, LM.PINKY_PIP);
}

// 手のひら/甲の向き数値: 「手首→人差し/小指付け根」の 2D 外積符号 (>0 手のひら / <0 手の甲)
function handOrientation(lm, handedLabel, inverted) {
  const w = lm[LM.WRIST], i = lm[LM.INDEX_MCP], p = lm[LM.PINKY_MCP];
  const v1x = i.x - w.x, v1y = i.y - w.y;
  const v2x = p.x - w.x, v2y = p.y - w.y;
  const cross = v1x * v2y - v1y * v2x;
  const norm = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) + 1e-9;
  let m = -cross / norm;                       // ≒ sin(挟み角), 既定符号は実測合わせ
  m *= (handedLabel === "Left") ? -1 : 1;      // 左右差を打ち消す
  if (inverted) m = -m;
  return m;
}

// =====================================================================
//  手書きキャンバス (絵文字の描画ターゲット)
// =====================================================================
let canvas = null, padCtx = null;
export const getPadCtx = () => padCtx;
export function clearPad() { if (!padCtx) return; padCtx.fillStyle = "#fff"; padCtx.fillRect(0, 0, canvas.width, canvas.height); }

function initHandwriting() {
  canvas = $("pad");
  padCtx = canvas.getContext("2d");
  clearPad();
  padCtx.lineWidth = 10; padCtx.lineCap = "round"; padCtx.lineJoin = "round"; padCtx.strokeStyle = "#000";
  let drawing = false;
  const posOf = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * canvas.width / r.width, y: (t.clientY - r.top) * canvas.height / r.height };
  };
  const start = (e) => { drawing = true; const p = posOf(e); padCtx.beginPath(); padCtx.moveTo(p.x, p.y); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const p = posOf(e); padCtx.lineTo(p.x, p.y); padCtx.stroke(); e.preventDefault(); };
  const end = () => { drawing = false; };
  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);
}

// =====================================================================
//  検索クライアント (非同期ジョブ: 投入 -> ポーリング)。backend(emoji-search) を叩く。
// =====================================================================
export const topK = () => Math.max(1, parseInt($("topk").value, 10) || DEFAULT_TOP_K);
export const resultMode = () => { const el = $("resultMode"); return el ? el.value : "top1"; };
export const effectiveTopK = () => (resultMode() === "top1" ? 1 : topK());

export function updateResultModeUI() {
  const row = $("topkRow");
  if (row) row.style.display = (resultMode() === "top1") ? "none" : "";
}

// 検索結果の絵文字を入力結果 (#jpFlickOutput) に追加 (マウスクリック / top-1 自動入力)
export function emojiInput(emojiChar) {
  const output = $("jpFlickOutput");
  if (output) output.value += emojiChar;
  showModeToast(`${emojiChar} を入力`);
}

function render(results) {
  const grid = $("grid");
  grid.innerHTML = "";
  for (const r of results) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "pointer";
    card.title = "クリックで入力結果に追加";
    card.innerHTML = `
      <img src="${r.image_url}" alt="${r.label}" loading="lazy" />
      <div class="label">${r.emoji} ${r.label}</div>
      <div class="score">score ${r.score}</div>
      <div class="hex">${r.id}</div>`;
    card.addEventListener("click", () => emojiInput(r.emoji));
    grid.appendChild(card);
  }
}

async function runJob(url, body, source = "manual") {
  setStatus("検索中…");
  if (source === "camera") setCameraState("searching", "検索実行中", "手書き画像を送信しています");
  $("grid").innerHTML = "";
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const { job_id } = await res.json();
    while (true) {
      await sleep(300);
      const job = await (await fetch(`/api/jobs/${job_id}`)).json();
      if (job.status === "done") {
        if (resultMode() === "top1") {
          if (job.results.length) {
            emojiInput(job.results[0].emoji);
            setStatus(`最高スコア «${job.results[0].emoji}» を入力`);
          } else {
            setStatus("該当なし");
          }
        } else {
          render(job.results);
          setStatus(`${job.results.length} 件`);
        }
        if (source === "camera") setCameraState("detecting", "検出中", "次のジェスチャを待っています");
        return;
      }
      if (job.status === "error") {
        setStatus("エラー: " + job.error);
        if (source === "camera") setCameraState("error", "検索エラー", job.error || "検索に失敗しました");
        return;
      }
    }
  } catch (e) {
    setStatus("通信エラー: " + e);
    if (source === "camera") setCameraState("error", "通信エラー", String(e));
  }
}

export function searchText() {
  const q = $("q").value.trim();
  if (!q) { setStatus("テキストを入力してください"); return; }
  runJob("/api/search/text", { query: q, top_k: effectiveTopK() });
}
export function searchImage(source = "manual") {
  const dataUrl = canvas.toDataURL("image/png");
  runJob("/api/search/image", { image: dataUrl, top_k: effectiveTopK() }, source);
}

// =====================================================================
//  入力モードの登録と振り分け (backend の registry.build_searcher と対称)
// =====================================================================
const MODES = { emoji, japanese, english };
let inputMode = "japanese";   // 画面初期は日本語入力
export const currentMode = () => MODES[inputMode];
export function currentModeLabel() { const cur = INPUT_MODES.find((i) => i.id === inputMode); return cur ? cur.label : ""; }
function resetAllModes() { for (const m of Object.values(MODES)) m.reset?.(); }

export function setInputMode(mode) {
  inputMode = mode;
  const current = INPUT_MODES.find((item) => item.id === mode) || INPUT_MODES[2];
  const label = $("inputModeLabel");
  if (label) label.textContent = current.label;
  for (const item of INPUT_MODES) {
    const button = $(item.buttonId);
    if (button) button.classList.toggle("active", item.id === mode);
  }
  MODES[mode]?.reset?.();
  clearPad();          // モード切替で描画軌跡を完全クリア (別モードへ移動 / 絵文字に戻っても消えたまま)
  clearPadCursor();
  const status = $("jpFlickStatus");
  if (status) status.textContent = MODE_GUIDE[mode] || "";        // 入力方法ガイド (モード連動)
  applyViewLayout();   // 運指設定/入力欄の表示は testMode と mode に応じて決める
  const resultSetting = $("resultSettingPanel");
  if (resultSetting) resultSetting.style.display = (mode === "emoji") ? "" : "none";
  const drawActions = $("drawActions");
  if (drawActions) drawActions.style.display = (mode === "emoji") ? "" : "none";
  const textSearch = $("textSearchPanel");
  if (textSearch) textSearch.style.display = (mode === "emoji") ? "" : "none";
  if (!mpRunning) {
    setGesture(current.label);
    setCameraState("idle", `${current.label}入力モード`, "カメラは停止しています");
    return;
  }
  if (mode === "japanese") {
    setGesture("日本語フリック");
    setCameraState("detecting", "日本語入力モード", "同じピンチを50音フリックとして解釈します");
  } else if (mode === "emoji") {
    setGesture("絵文字入力");
    setCameraState("detecting", "絵文字入力モード", "ピンチ描画 / ピース検索 / 指差しクリア");
  } else {
    setGesture("英語入力");
    setCameraState("detecting", "英語入力モード", "動作は未実装です");
  }
}

export function cycleInputMode() {
  const index = INPUT_MODES.findIndex((item) => item.id === inputMode);
  setInputMode(INPUT_MODES[(index + 1) % INPUT_MODES.length].id);
}

// =====================================================================
//  🔁 言語切替モーション (手のひら/手の甲。全モード共通の横断機能)
//   確定したら cycleInputMode() で 日本語→英語→絵文字 を巡回する。
// =====================================================================
let langMethod = "flip";       // "off" | "holdback" | "flip"
let orientInverted = false;    // 手のひら/甲の判定が逆な環境向け
let curOrient = "unknown";     // "palm" | "back" | "unknown"
let sawPalmAt = -1, backHoldStart = 0, langArmed = true, langLastFire = 0;

function updateOrientation(lm, handedLabel, now) {
  const m = handOrientation(lm, handedLabel, orientInverted);
  if (m > ORIENT_DEADZONE) curOrient = "palm";
  else if (m < -ORIENT_DEADZONE) curOrient = "back";   // 不感帯内は直前保持 (チャタリング防止)
  if (curOrient === "palm") sawPalmAt = now;
  return curOrient;
}

function handleLanguageSwitch(orient, now) {
  if (langMethod === "off" || orient === "unknown") {
    backHoldStart = 0;
    if (orient !== "back") langArmed = true;
    return { charge: 0, fired: false, label: currentModeLabel() };
  }
  const cooldownOk = now - langLastFire > LANG_COOLDOWN_MS;
  let charge = 0, fired = false;
  if (langMethod === "holdback") {
    if (orient === "back") {
      if (backHoldStart === 0) backHoldStart = now;
      if (langArmed && cooldownOk) {
        charge = Math.min(1, (now - backHoldStart) / BACK_HOLD_MS);
        if (charge >= 1) { fireLangSwitch(now); fired = true; charge = 0; langArmed = false; }
      }
    } else { backHoldStart = 0; langArmed = true; }
  } else if (langMethod === "flip") {
    if (orient === "back") {
      if (langArmed && cooldownOk && sawPalmAt > 0 && (now - sawPalmAt) < FLIP_WINDOW_MS) {
        fireLangSwitch(now); fired = true; langArmed = false;
      }
    } else if (orient === "palm") { langArmed = true; }
  }
  return { charge, fired, label: currentModeLabel() };
}

function fireLangSwitch(now) {
  langLastFire = now;
  cycleInputMode();
  const label = currentModeLabel();
  showModeToast(`${label} に変更しました`);
  setFlash(`🔁 ${label}`, now + 700);
}

// カメラ状態表示に言語切替の発火/保持を反映 (反映したら true)
export function applyLangCamState(langInfo) {
  if (langInfo.fired) { setCameraState("detecting", `${langInfo.label} に変更しました`, "言語入力モードを切り替えました"); return true; }
  if (langInfo.charge > 0) { setCameraState("holding", "言語切替 保持中", `手の甲を保持 ${Math.round(langInfo.charge * 100)}%`, langInfo.charge); return true; }
  return false;
}

// UI ハンドラ (インライン属性から呼ぶため window に載せる)
export function onLangMethodChange(v) { langMethod = v; backHoldStart = 0; langArmed = true; sawPalmAt = -1; }
export function setOrientInvert(v) { orientInverted = v; }
function resetLangState() { curOrient = "unknown"; sawPalmAt = -1; backHoldStart = 0; langArmed = true; }

// =====================================================================
//  MediaPipe パイプライン (カメラ -> 手ランドマーク -> モードへ振り分け)
// =====================================================================
let mpLandmarker = null, mpStream = null, mpRunning = false, mpRaf = null, mpLastTs = -1;
let cursor = null;   // ペン先の平滑化座標 (全モード共通)

async function ensureLandmarker() {
  if (mpLandmarker) return mpLandmarker;
  setGesture("モデル読み込み中…");
  setCameraState("loading", "モデル読み込み中", "MediaPipe Hand Landmarker を読み込んでいます");
  const vision = await import(`${MP_ASSET}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_ASSET}/wasm`);
  mpLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${MP_ASSET}/hand_landmarker.task` },
    runningMode: "VIDEO",
    numHands: 1,
  });
  return mpLandmarker;
}

export async function toggleCam() {
  if (mpRunning) { stopCam(); return; }
  try {
    await ensureLandmarker();
    setGesture("カメラ権限待ち…");
    setCameraState("permission", "カメラ権限待ち", "ブラウザの許可ダイアログを確認してください");
    mpStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const v = $("cam");
    v.srcObject = mpStream;
    await v.play();
    mpRunning = true;
    $("camBtn").textContent = "カメラ停止";
    setGesture("検出中…");
    setCameraState("detecting", "検出中", "手をカメラ内に入れてください");
    mpLoop();
  } catch (e) {
    const msg = e.message || String(e);
    const denied = e.name === "NotAllowedError" || e.name === "PermissionDeniedError";
    setGesture((denied ? "権限エラー: " : "カメラエラー: ") + msg);
    setCameraState(
      denied ? "denied" : "error",
      denied ? "カメラ権限拒否" : "カメラエラー",
      denied ? "ブラウザ設定でカメラ権限を許可してから再実行してください" : msg,
    );
  }
}

function stopCam() {
  mpRunning = false;
  if (mpRaf) cancelAnimationFrame(mpRaf);
  if (mpStream) mpStream.getTracks().forEach((t) => t.stop());
  mpStream = null; cursor = null;
  resetAllModes(); resetLangState(); clearFlash();
  $("camBtn").textContent = "カメラ開始";
  setGesture("—");
  setCameraState("idle", "待機中", "カメラは停止しています");
  const o = $("overlay"); o.getContext("2d").clearRect(0, 0, o.width, o.height);
  clearPadCursor();
}

function mpLoop() {
  if (!mpRunning) return;
  const v = $("cam");
  if (v.readyState >= 2) {
    const ts = performance.now();
    if (ts !== mpLastTs) {
      mpLastTs = ts;
      handleHands(mpLandmarker.detectForVideo(v, ts));
    }
  }
  mpRaf = requestAnimationFrame(mpLoop);
}

// 1 フレームの読み取り: 手→向き/座標を求め、現在の入力モードへ振り分ける
function handleHands(res) {
  const overlay = $("overlay"), octx = overlay.getContext("2d");
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const lm = res.landmarks && res.landmarks[0];
  if (!lm) {
    setGesture("手が見えません");
    setCameraState("nohand", "手が見つかりません", "手全体が白い検出エリアに入るようにしてください");
    resetAllModes(); cursor = null; clearPadCursor();
    return;
  }
  const now = performance.now();
  // 手の一部しか写っていない (palm 見切れ等) は無効化 -> 誤検出・言語切替の連続発火を防ぐ
  if (!handFullyVisible(lm)) {
    drawOverlay(octx, lm, overlay, now);   // 見切れていてもランドマークは表示 (見切れが分かるように)
    setGesture("手全体を写してください");
    setCameraState("nohand", "手が見切れています", "手のひら〜指先まで枠内に収めてください");
    resetAllModes(); resetLangState(); cursor = null; clearPadCursor();
    return;
  }
  cursor = penTip(lm, cursor, canvas.width, canvas.height);

  // 🔁 言語切替モーション: 手の向きを全モード共通で先に評価
  const handedLabel = (res.handednesses || res.handedness || [])[0]?.[0]?.categoryName || "Right";
  const orient = updateOrientation(lm, handedLabel, now);
  updateOrientUI(orient);
  // 指を折り曲げている(入力中)ときは言語切替を評価しない (誤トリガ防止。back中に入力を止めるのと対称)
  let langInfo;
  if (fingersExtended(lm)) {
    langInfo = handleLanguageSwitch(orient, now);
  } else {
    resetLangState();
    langInfo = { charge: 0, fired: false, label: currentModeLabel() };
  }
  const backFacing = orient === "back";

  // 現在の入力モードへ振り分け (各モジュールが自分の描画/状態/入力を担う)
  currentMode().onFrame({ lm, now, cursor, orient, backFacing, langInfo, octx, overlay });
  drawOverlay(octx, lm, overlay, now);
}

// =====================================================================
//  初期化 & インライン onclick 用のグローバル公開
// =====================================================================
// --- テストページ表示切替 (右側を 通常 ⇄ テスト で切替) ---
let testMode = false;
function applyViewLayout() {
  const testPanel = $("inputTestPanel"), grid = $("grid"), btn = $("viewToggle");
  if (testPanel) testPanel.style.display = testMode ? "" : "none";
  if (grid) grid.style.display = testMode ? "none" : "";
  if (btn) btn.textContent = testMode ? "← 通常ページ" : "テストページ →";
  // 入力ブロック(入力結果欄)を テスト領域 / 上部ブロック へ移動する
  const block = $("inputBlock"), slot = $("testInputSlot"), proto = document.querySelector(".jp-proto");
  if (block && slot && proto) (testMode ? slot : proto).appendChild(block);
  // 運指/しきい値の設定はテストページでは隠す (純粋に言語入力だけにする)
  const jpCfg = $("jpFingerConfig"), enRef = $("enRef");
  if (jpCfg) jpCfg.style.display = (!testMode && inputMode === "japanese") ? "" : "none";
  if (enRef) enRef.style.display = (!testMode && inputMode === "english") ? "" : "none";
}
export function toggleView() { testMode = !testMode; applyViewLayout(); if (testMode) refreshTest(); }

function init() {
  initHandwriting();
  updateResultModeUI();   // 既定 top-k なので top-k 行を表示
  renderJapaneseSettings();   // 日本語の運指/しきい値エディタを構築 (日本語モードで表示)
  renderEnglishSettings();    // 英語の運指エディタを構築 (英語モードで表示)
  initTest();                 // 入力テストの初期お題
  setInputMode(inputMode);    // 初期モードに UI を同期 (既定=日本語)
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") searchText(); });

  // index.html の onclick="..." から呼べるよう window に載せる
  Object.assign(window, {
    searchText, searchImage, clearPad, toggleCam, setInputMode,
    jpFlickBackspace, jpFlickClear, onLangMethodChange, setOrientInvert, updateResultModeUI,
    testCheck, testNext, toggleView,
  });
}

init();
