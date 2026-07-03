// 日本語入力 (折り曲げ式): パーを基準に「指を折る」ことで行(子音)を選び、
// 手全体のフリック方向で母音を選ぶ。パーに戻すと確定。backend 不要のフロント完結。
//
// フロー:
//   パー(基準) → 指定指を折る(他は伸展)を HOLD_MS 保持 → 行をロック
//   → 手全体を FLICK_DIST 以上動かした方向を1つ採用(フリック) → パーに戻して確定
//   フリックせずにパーへ戻せば「あ段」。折り曲げ/フリックは各入力1回だけロックされる。
//   親+小 の折りは、直前の文字を 濁音→半濁音→小文字→元 でループさせる(フリックなし)。
//
// しきい値(HOLD_MS / FLICK_DIST / THUMB_FOLD)は下記で調整可(デモ)。
// 運指マッピング foldMap は設定で変更可・言語切替をまたいで維持する(モジュール変数)。
import { LM } from "../config.js";
import {
  dist, fingerUp, $, clearPadCursor, drawPadCursor, setGesture, setCameraState, applyLangCamState,
} from "../core.js";

// --- 調整用しきい値 (デモ: 下の設定UIのスライダで変更可・モード切替をまたいで維持) ---
let HOLD_MS = 150;       // 折り曲げポーズをこの ms 保持で行をロック
let FLICK_DIST = 0.16;   // 手全体(手のひら)がこの割合(正規化)動いたらフリック方向を採用
let THUMB_FOLD = 0.6;    // 親指が「折り」と判定する距離しきい (dist(親先,中付根)/手大きさ)

// --- かな表 (行の基準字 → [中央, 左, 上, 右, 下]) ---
const ROWS = {
  "あ": ["あ", "い", "う", "え", "お"],
  "か": ["か", "き", "く", "け", "こ"],
  "さ": ["さ", "し", "す", "せ", "そ"],
  "た": ["た", "ち", "つ", "て", "と"],
  "な": ["な", "に", "ぬ", "ね", "の"],
  "は": ["は", "ひ", "ふ", "へ", "ほ"],
  "ま": ["ま", "み", "む", "め", "も"],
  "や": ["や", "（", "ゆ", "）", "よ"],
  "ら": ["ら", "り", "る", "れ", "ろ"],
  "わ": ["わ", "を", "ん", "ー", "〜"],
};
const ROW_ORDER = ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"];
const DIR_LABELS = ["中央", "左", "上", "右", "下"];

// --- 濁音/半濁音/小 のループ (対応字がある場合のみ。順: 濁音→半濁音→小→元) ---
const DAKUTEN_CYCLES = [
  "あぁ", "いぃ", "うゔぅ", "えぇ", "おぉ",
  "かが", "きぎ", "くぐ", "けげ", "こご",
  "さざ", "しじ", "すず", "せぜ", "そぞ",
  "ただ", "ちぢ", "つづっ", "てで", "とど",
  "はばぱ", "ひびぴ", "ふぶぷ", "へべぺ", "ほぼぽ",
  "やゃ", "ゆゅ", "よょ", "わゎ",
];
const DAKUTEN_NEXT = {};
for (const cyc of DAKUTEN_CYCLES) {
  const arr = [...cyc];
  for (let i = 0; i < arr.length; i++) DAKUTEN_NEXT[arr[i]] = arr[(i + 1) % arr.length];
}

// --- 運指マッピング: 各行 → 折り曲げる指の集合 (T=親, I=人, M=中, R=薬, P=小) ---
// 特殊アクション: 濁点=濁点/半濁点/小ループ, 消す=直前1文字削除 (どちらもフリック無し・パーで実行)
const SPECIAL_ORDER = ["濁点", "消す"];
const ALL_ENTRIES = [...ROW_ORDER, ...SPECIAL_ORDER];
const DEFAULT_FOLD = {
  "あ": ["T"], "か": ["I"], "さ": ["M"], "た": ["T", "I"], "な": ["T", "M"],
  "は": ["T", "R"], "ま": ["I", "M"], "や": ["M", "R"], "ら": ["T", "I", "M"], "わ": ["I", "M", "R"],
  "濁点": ["T", "R", "P"],        // 親+薬+小
  "消す": ["T", "M", "R", "P"],   // 人差し指のみ立てる (親/中/薬/小 を折る)
};
export let foldMap = JSON.parse(JSON.stringify(DEFAULT_FOLD));  // 設定で変更可(設定UIから)

const FINGER_ORDER = ["T", "I", "M", "R", "P"];
export function canonFold(arr) { return FINGER_ORDER.filter((f) => arr.includes(f)).join(""); }
// 折り集合(正規化文字列) → エントリ名(行 or 濁点/消す)。foldMap から毎回構築(設定変更に追従)。
function foldToEntry() {
  const m = {};
  for (const e of ALL_ENTRIES) m[canonFold(foldMap[e])] = e;
  return m;
}
function entryLabel(e) { return e === "濁点" ? "濁点化" : e === "消す" ? "1文字削除" : `${e}行`; }

// --- 指の折り判定 ---
function thumbFolded(lm) {
  const scale = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6;
  return dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_MCP]) / scale < THUMB_FOLD;   // 親先が手のひら中央に近い=折り
}
function foldedSet(lm) {
  const s = [];
  if (thumbFolded(lm)) s.push("T");
  if (!fingerUp(lm, LM.INDEX_TIP, LM.INDEX_PIP)) s.push("I");
  if (!fingerUp(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP)) s.push("M");
  if (!fingerUp(lm, LM.RING_TIP, LM.RING_PIP)) s.push("R");
  if (!fingerUp(lm, LM.PINKY_TIP, LM.PINKY_PIP)) s.push("P");
  return s.join("");   // FINGER_ORDER 順
}

function flickDir(dx, dy) {
  if (Math.hypot(dx, dy) < FLICK_DIST) return 0;          // 中央 = あ段
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3; // 左 / 右
  return dy < 0 ? 2 : 4;                                  // 上 / 下
}

// --- 出力ヘルパ ---
function jpAppend(kana) { const o = $("jpFlickOutput"); if (o) o.value += kana; }
function jpStatus(text) { const s = $("jpFlickStatus"); if (s) s.textContent = text; }
function applyDakuten() {
  const o = $("jpFlickOutput");
  if (!o || !o.value) { jpStatus("濁点化: 直前の文字がありません"); return; }
  const last = o.value.slice(-1);
  const next = DAKUTEN_NEXT[last];
  if (next) { o.value = o.value.slice(0, -1) + next; jpStatus(`濁点/半濁点/小: ${last} → ${next}`); }
  else jpStatus(`濁点化: 「${last}」に対応形なし`);
}

export function jpFlickBackspace() { const o = $("jpFlickOutput"); if (o) o.value = o.value.slice(0, -1); }
export function jpFlickClear() {
  const o = $("jpFlickOutput"); if (o) o.value = "";
  resetState();
  jpStatus("パーから指を折って行を選び、フリック→パーで確定します。");
}

// --- 状態機械 (各入力で 折り1回・フリック1方向 だけロック) ---
let foldPending = null;   // { key, since } 折りのデバウンス候補
let lockedRow = null;     // ロック中のエントリ: 行の基準字 or "濁点" / "消す"
let flickStart = null;    // { x, y } ロック時の手首(スクリーン)座標
let flickIndex = 0;       // 採用したフリック方向 (0=中央)
let flickLocked = false;

function resetState() { foldPending = null; lockedRow = null; flickStart = null; flickIndex = 0; flickLocked = false; }

function commit() {
  if (lockedRow === "濁点") {
    applyDakuten();
  } else if (lockedRow === "消す") {
    const o = $("jpFlickOutput");
    if (o && o.value) { o.value = o.value.slice(0, -1); jpStatus("1文字削除しました"); }
    else jpStatus("削除: 文字がありません");
  } else {
    const kana = ROWS[lockedRow][flickIndex];
    jpAppend(kana);
    jpStatus(`${lockedRow}行 ${DIR_LABELS[flickIndex]} = ${kana}`);
  }
  resetState();
}

// 折り曲げで動かない手のひらの代表点 (手首+人差し/小指付け根の中心)。selfie 座標(1-x)。
function palmPoint(lm) {
  const w = lm[LM.WRIST], i = lm[LM.INDEX_MCP], p = lm[LM.PINKY_MCP];
  return { x: 1 - (w.x + i.x + p.x) / 3, y: (w.y + i.y + p.y) / 3 };
}

function updateJapanese(lm, cursor, now) {
  drawPadCursor(cursor.x, cursor.y, "point");   // 手の位置の目印
  const fs = foldedSet(lm);

  // ---- ロック中: 手のひらの移動方向を1つ採用し、パーに戻したら確定 ----
  if (lockedRow) {
    if (fs === "") { commit(); return; }        // パー = 確定
    if (!flickLocked && flickStart) {
      const cur = palmPoint(lm);   // 折り曲げ開始時の手のひら位置からの移動で判定
      const dx = cur.x - flickStart.x, dy = cur.y - flickStart.y;
      if (Math.hypot(dx, dy) >= FLICK_DIST) { flickIndex = flickDir(dx, dy); flickLocked = true; }
    }
    if (lockedRow === "濁点") jpStatus("濁点/半濁点/小: パーに戻すと適用");
    else if (lockedRow === "消す") jpStatus("1文字削除: パーに戻すと実行");
    else jpStatus(`${lockedRow}行 → ${DIR_LABELS[flickIndex]}「${ROWS[lockedRow][flickIndex]}」 (パーで確定)`);
    return;
  }

  // ---- 選択中: パー基準から折り曲げを HOLD_MS 保持でロック ----
  if (fs === "") { foldPending = null; jpStatus("パー基準: 指を折って行/操作を選択"); return; }
  const entry = foldToEntry()[fs] || null;
  if (entry) {
    if (!foldPending || foldPending.key !== fs) {
      // 最初に折り曲げた時の手のひら位置を基準として保持
      foldPending = { key: fs, since: now, ref: palmPoint(lm) };
    } else if (now - foldPending.since >= HOLD_MS) {
      lockedRow = entry;
      flickStart = foldPending.ref;   // 基準 = 折り曲げ開始時の手のひら位置
      flickIndex = 0; flickLocked = false; foldPending = null;
      jpStatus(`${entryLabel(entry)} を選択。パーで確定`);
    } else {
      jpStatus(`${entryLabel(entry)} …`);
    }
  } else {
    foldPending = null;
    jpStatus("その運指は未割り当て");
  }
}

export default {
  id: "japanese",
  label: "日本語",
  reset() { resetState(); },
  onFrame(ctx) {
    const { lm, cursor, now, langInfo } = ctx;
    // 言語切替は手が開いている時だけ(core側でゲート)。折り曲げ入力はここで常時処理する
    // (向きの一瞬の誤判定で入力/フリックをキャンセルしないようにする)。
    updateJapanese(lm, cursor, now);
    setGesture(langInfo.fired ? `🔁 ${langInfo.label}` : "日本語(折り曲げ)");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "日本語入力モード", "指を折って行→フリック→パーで確定");
    }
  },
};

// =====================================================================
//  設定UI (デモ): しきい値スライダ + 運指(行→折る指)エディタ。
//  しきい値/foldMap はモジュール変数なので、言語切替をまたいで維持される。
// =====================================================================
export function renderJapaneseSettings() {
  const root = $("jpFingerConfig");
  if (!root) return;
  root.innerHTML = "";

  const thTitle = document.createElement("div");
  thTitle.className = "jp-cfg-title"; thTitle.textContent = "検出しきい値 (デモ調整)";
  root.appendChild(thTitle);
  root.appendChild(makeSlider("行ロック(ms)", 60, 600, 10, HOLD_MS, (v) => { HOLD_MS = v; }));
  root.appendChild(makeSlider("フリック距離", 0.02, 1.00, 0.01, FLICK_DIST, (v) => { FLICK_DIST = v; }));
  root.appendChild(makeSlider("親指折りしきい", 0.40, 1.10, 0.02, THUMB_FOLD, (v) => { THUMB_FOLD = v; }));

  const mapTitle = document.createElement("div");
  mapTitle.className = "jp-cfg-title"; mapTitle.textContent = "運指 (行/操作 → 折り曲げる指)";
  root.appendChild(mapTitle);
  for (const entry of ALL_ENTRIES) root.appendChild(makeRowEditor(entry));
}

function makeSlider(label, min, max, step, value, onInput) {
  const row = document.createElement("div");
  row.className = "jp-cfg-th";
  const lab = document.createElement("span"); lab.className = "jp-cfg-thlab"; lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  const val = document.createElement("span"); val.className = "jp-cfg-thval"; val.textContent = value;
  inp.addEventListener("input", () => { val.textContent = inp.value; onInput(parseFloat(inp.value)); });
  row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
  return row;
}

const FINGER_LABELS = [["T", "親"], ["I", "人"], ["M", "中"], ["R", "薬"], ["P", "小"]];
function makeRowEditor(entry) {
  const el = document.createElement("div");
  el.className = "jp-cfg-row";
  const label = document.createElement("span");
  label.className = "jp-cfg-rowlabel";
  label.textContent = SPECIAL_ORDER.includes(entry) ? entry : `${entry}行`;
  el.appendChild(label);

  // 固定時の表示: 折る指を ✅ で強調、それ以外は淡色 (グレー一色で見づらいのを解消)
  const disp = document.createElement("span");
  disp.className = "jp-cfg-disp";
  function renderDisp() {
    disp.innerHTML = "";
    const set = new Set(foldMap[entry]);
    for (const [key, lbl] of FINGER_LABELS) {
      const s = document.createElement("span");
      s.className = set.has(key) ? "jp-cfg-on" : "jp-cfg-off";
      s.textContent = set.has(key) ? `✅${lbl}` : lbl;
      disp.appendChild(s);
    }
  }
  renderDisp();
  el.appendChild(disp);

  // 編集用チェックボックス (初期は非表示。運指変更を押したときだけ出す)
  const edit = document.createElement("span");
  edit.className = "jp-cfg-edit"; edit.style.display = "none";
  const boxes = {};
  for (const [key, lbl] of FINGER_LABELS) {
    const w = document.createElement("label"); w.className = "jp-cfg-cb";
    const cb = document.createElement("input"); cb.type = "checkbox";
    w.appendChild(cb); w.appendChild(document.createTextNode(lbl));
    edit.appendChild(w); boxes[key] = cb;
  }
  el.appendChild(edit);

  const btn = document.createElement("button");
  btn.className = "jp-cfg-btn"; btn.textContent = "運指変更";
  const msg = document.createElement("span"); msg.className = "jp-cfg-msg";
  btn.addEventListener("click", () => {
    if (btn.dataset.editing !== "1") {   // 編集開始
      const set = new Set(foldMap[entry]);
      for (const [key] of FINGER_LABELS) boxes[key].checked = set.has(key);
      disp.style.display = "none"; edit.style.display = "";
      btn.dataset.editing = "1"; btn.textContent = "保存"; msg.textContent = "";
      return;
    }
    // 保存: 1本以上 & 他エントリ(行/濁点/消す)と重複なし のときだけ確定
    const chosen = FINGER_ORDER.filter((k) => boxes[k].checked);
    const key = canonFold(chosen);
    if (!key) { msg.textContent = "1本以上選択してください"; return; }
    const others = ALL_ENTRIES.filter((e) => e !== entry).map((e) => canonFold(foldMap[e]));
    if (others.includes(key)) { msg.textContent = "他の運指と重複"; return; }
    foldMap[entry] = chosen;
    renderDisp();
    disp.style.display = ""; edit.style.display = "none";
    btn.dataset.editing = ""; btn.textContent = "運指変更"; msg.textContent = "保存しました";
  });
  el.appendChild(btn); el.appendChild(msg);
  return el;
}
