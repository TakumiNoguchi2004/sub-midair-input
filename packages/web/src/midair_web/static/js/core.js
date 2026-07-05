// 全体機能 (フレームワーク層):
//   UI ヘルパ / 幾何 / 手書きキャンバス / 検索クライアント /
//   MediaPipe パイプライン / 入力モードの振り分け / 言語切替モーション / 初期化。
// 言語ごとの入力ロジックは modes/<lang>.js に分離し、ここは振り分けだけを担う。
import {
  MP_ASSET, LM, EMA, EDGE_MARGIN, POINTER_STYLE, DEFAULT_TOP_K,
  BACK_HOLD_MS, LANG_COOLDOWN_MS, FLIP_WINDOW_MS, ORIENT_DEADZONE, SWITCH_INPUT_COOLDOWN,
  INPUT_MODES,
} from "./config.js";
import { t, getLang, setLang, applyStaticI18n } from "./i18n.js";
import emoji from "./modes/emoji.js";
import japanese, { jpFlickBackspace, jpFlickClear, renderJapaneseSettings } from "./modes/japanese.js";
import english, { renderEnglishSettings } from "./modes/english.js";
import { testToggle, testNext, initTest, refreshTest } from "./test.js";

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
// muted=true で灰色トースト (入力結果の通知用: 言語切替など系統のポップアップと区別する)
export function showModeToast(text, muted = false) {
  const t = $("modeToast");
  if (!t) return;
  t.textContent = text;
  t.classList.toggle("muted", muted);
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
  el.textContent = orient === "palm" ? t("orient.palm") : orient === "back" ? t("orient.back") : t("orient.unknown");
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
  showModeToast(t("toast.entered", { c: emojiChar }), true);   // 灰色トーストで一時通知 (永続ログは残さない)
}

function render(results) {
  const grid = $("grid");
  grid.innerHTML = "";
  for (const r of results) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "pointer";
    card.title = t("card.clickToAdd");
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
  setStatus(t("status.searching"));
  if (source === "camera") setCameraState("searching", t("cam.searchRun"), t("cam.sendingImg"));
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
            emojiInput(job.results[0].emoji);   // 灰色トーストで通知 (#status には残さない)
            setStatus("");
          } else {
            setStatus(t("status.noresult"));
          }
        } else {
          render(job.results);
          setStatus(t("status.count", { n: job.results.length }));
        }
        if (source === "camera") setCameraState("detecting", t("cam.detecting"), t("cam.waitNext"));
        return;
      }
      if (job.status === "error") {
        setStatus(t("status.error", { e: job.error }));
        if (source === "camera") setCameraState("error", t("cam.searchErrLabel"), job.error || t("cam.searchFail"));
        return;
      }
    }
  } catch (e) {
    setStatus(t("status.commErr", { e: String(e) }));
    if (source === "camera") setCameraState("error", t("cam.commErrLabel"), String(e));
  }
}

export function searchText() {
  const q = $("q").value.trim();
  if (!q) { setStatus(t("status.needText")); return; }
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
export function currentModeLabel() { return t("mode." + inputMode); }
function resetAllModes() { for (const m of Object.values(MODES)) m.reset?.(); }

export function setInputMode(mode) {
  inputMode = mode;
  const current = INPUT_MODES.find((item) => item.id === mode) || INPUT_MODES[2];
  const label = $("inputModeLabel");
  if (label) label.textContent = t("mode." + current.id);
  for (const item of INPUT_MODES) {
    const button = $(item.buttonId);
    if (button) button.classList.toggle("active", item.id === mode);
  }
  MODES[mode]?.reset?.();
  clearPad();          // モード切替で描画軌跡を完全クリア (別モードへ移動 / 絵文字に戻っても消えたまま)
  clearPadCursor();
  const status = $("jpFlickStatus");
  if (status) status.textContent = t("guide." + mode);        // 入力方法ガイド (モード連動)
  applyViewLayout();   // 運指設定/入力欄の表示は testMode と mode に応じて決める
  const resultSetting = $("resultSettingPanel");
  if (resultSetting) resultSetting.style.display = (mode === "emoji") ? "" : "none";
  const drawActions = $("drawActions");
  if (drawActions) drawActions.style.display = (mode === "emoji") ? "" : "none";
  const textSearch = $("textSearchPanel");
  if (textSearch) textSearch.style.display = (mode === "emoji") ? "" : "none";
  if (!mpRunning) {
    const ml = t("mode." + current.id);
    setGesture(ml);
    setCameraState("idle", t("cam.modeLabel", { label: ml }), t("cam.idleDetail"));
    return;
  }
  if (mode === "japanese") {
    setGesture(t("gesture.jpFlick"));
    setCameraState("detecting", t("cam.modeLabel", { label: t("mode.japanese") }), t("cam.jpModeDetail"));
  } else if (mode === "emoji") {
    setGesture(t("gesture.emoji"));
    setCameraState("detecting", t("cam.modeLabel", { label: t("mode.emoji") }), t("cam.emojiModeDetail"));
  } else {
    setGesture(t("gesture.english"));
    setCameraState("detecting", t("cam.modeLabel", { label: t("mode.english") }), t("cam.enNotImpl"));
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
let inputSuppressUntil = 0;   // 言語切替直後はこの時刻まで入力を止める

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
  inputSuppressUntil = now + SWITCH_INPUT_COOLDOWN;   // 切替直後は少しの間 入力を止める
  cycleInputMode();
  const label = currentModeLabel();
  showModeToast(t("toast.switched", { label }));
  setFlash(`🔁 ${label}`, now + 700);
}

// カメラ状態表示に言語切替の発火/保持を反映 (反映したら true)
export function applyLangCamState(langInfo) {
  if (langInfo.fired) { setCameraState("detecting", t("toast.switched", { label: langInfo.label }), t("cam.langSwitched")); return true; }
  if (langInfo.charge > 0) { setCameraState("holding", t("cam.langHold"), t("cam.langHoldDetail", { pct: Math.round(langInfo.charge * 100) }), langInfo.charge); return true; }
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
  setGesture(t("gesture.modelLoad"));
  setCameraState("loading", t("cam.modelLoad"), t("cam.modelLoadDetail"));
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
    setGesture(t("gesture.permWait"));
    setCameraState("permission", t("cam.permWait"), t("cam.permDetail"));
    mpStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const v = $("cam");
    v.srcObject = mpStream;
    await v.play();
    mpRunning = true;
    $("camBtn").textContent = t("btn.camStop");
    setGesture(t("gesture.detecting"));
    setCameraState("detecting", t("cam.detecting"), t("cam.handIn"));
    mpLoop();
  } catch (e) {
    const msg = e.message || String(e);
    const denied = e.name === "NotAllowedError" || e.name === "PermissionDeniedError";
    setGesture((denied ? t("gesture.permErrPrefix") : t("gesture.camErrPrefix")) + msg);
    setCameraState(
      denied ? "denied" : "error",
      denied ? t("cam.denyLabel") : t("cam.errLabel"),
      denied ? t("cam.denyDetail") : msg,
    );
  }
}

// 未起動ならカメラを起動 (入力テストの「入力開始」から呼ぶ)
export function startCam() { if (!mpRunning) toggleCam(); }

function stopCam() {
  mpRunning = false;
  if (mpRaf) cancelAnimationFrame(mpRaf);
  if (mpStream) mpStream.getTracks().forEach((t) => t.stop());
  mpStream = null; cursor = null;
  resetAllModes(); resetLangState(); clearFlash();
  $("camBtn").textContent = t("btn.camStart");
  setGesture(t("gesture.dash"));
  setCameraState("idle", t("cam.idleLabel"), t("cam.idleDetail"));
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
    setGesture(t("gesture.noHand"));
    setCameraState("nohand", t("cam.noHandLabel"), t("cam.noHandDetail"));
    resetAllModes(); cursor = null; clearPadCursor();
    return;
  }
  const now = performance.now();
  // 手の一部しか写っていない (palm 見切れ等) は無効化 -> 誤検出・言語切替の連続発火を防ぐ
  if (!handFullyVisible(lm)) {
    drawOverlay(octx, lm, overlay, now);   // 見切れていてもランドマークは表示 (見切れが分かるように)
    setGesture(t("gesture.handClipped"));
    setCameraState("nohand", t("cam.clippedLabel"), t("cam.clippedDetail"));
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

  // 言語切替直後は一定時間 入力を止める (回転→入力の遷移で親指誤判定→誤入力するのを防ぐ)
  if (now < inputSuppressUntil) {
    currentMode().reset?.();   // 状態を溜めない
    clearPadCursor();
    drawOverlay(octx, lm, overlay, now);
    setGesture(langInfo.fired ? `🔁 ${langInfo.label}` : t("gesture.afterSwitch"));
    setCameraState("detecting", t("cam.modeLabel", { label: currentModeLabel() }), t("cam.afterSwitch"));
    return;
  }

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
  if (btn) btn.textContent = testMode ? t("btn.toNormal") : t("btn.toTest");
  // 入力ブロック(入力結果欄)を テスト領域 / 上部ブロック へ移動する
  const block = $("inputBlock"), slot = $("testInputSlot"), proto = document.querySelector(".jp-proto");
  if (block && slot && proto) (testMode ? slot : proto).appendChild(block);
  // 運指/しきい値の設定はテストページでは隠す (純粋に言語入力だけにする)
  const jpCfg = $("jpFingerConfig"), enRef = $("enRef");
  if (jpCfg) jpCfg.style.display = (!testMode && inputMode === "japanese") ? "" : "none";
  if (enRef) enRef.style.display = (!testMode && inputMode === "english") ? "" : "none";
}
export function toggleView() { testMode = !testMode; applyViewLayout(); refreshTest(); }

// --- 言語 (日本語 ⇄ 英語) の適用 / トグル ---
// 静的DOM + 動的に描画したパネル(運指設定/ガイド/モードUI/テスト)を現在言語で再構築する。
// カメラ稼働中のジェスチャ/状態表示は毎フレーム t() を通すため次フレームで自動反映される。
export function applyLang() {
  if (typeof document !== "undefined" && document.documentElement) document.documentElement.lang = getLang();
  applyStaticI18n();                              // data-i18n を持つ静的要素
  const lt = $("langToggle"); if (lt) lt.textContent = t("lang.toggle");
  renderJapaneseSettings();                       // 運指/しきい値エディタ (t() で組み立て)
  renderEnglishSettings();
  refreshTest();                                  // テストお題/統計ラベル
  setInputMode(inputMode);                        // ガイド/モードラベル/カメラ待機表示
}
export function toggleLang() { setLang(getLang() === "en" ? "ja" : "en"); applyLang(); }

function init() {
  initHandwriting();
  updateResultModeUI();   // 既定 top-k なので top-k 行を表示
  initTest();             // 入力テストの初期お題
  applyLang();            // 言語適用込みで 運指設定/ガイド/モードUI/テスト を構築 (renderXSettings 等を内包)
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") searchText(); });

  // index.html の onclick="..." から呼べるよう window に載せる
  Object.assign(window, {
    searchText, searchImage, clearPad, toggleCam, setInputMode,
    jpFlickBackspace, jpFlickClear, onLangMethodChange, setOrientInvert, updateResultModeUI,
    testToggle, testNext, toggleView, toggleLang,
  });
}

init();
