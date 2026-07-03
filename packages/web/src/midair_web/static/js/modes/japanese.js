// 日本語入力: 10種のピンチ運指で「行」、フリック方向で「母音」を選ぶ50音入力。
// backend 不要のフロント完結 (ジェスチャ→かなの直接写像)。
import { LM } from "../config.js";
import {
  dist, fingerUp, $, clearPadCursor, drawPadCursor, setGesture, setCameraState, applyLangCamState,
} from "../core.js";

// --- 運指・しきい値・かな表 (日本語固有) ---
const JP_PINCH_ON = 0.58;
const JP_PINCH_OFF = 0.76;
const JP_FLICK_MIN = 42;
const JP_ROWS = {
  I: ["あ", "い", "う", "え", "お"],
  M: ["か", "き", "く", "け", "こ"],
  R: ["さ", "し", "す", "せ", "そ"],
  P: ["た", "ち", "つ", "て", "と"],
  IM: ["な", "に", "ぬ", "ね", "の"],
  MR: ["は", "ひ", "ふ", "へ", "ほ"],
  RP: ["ま", "み", "む", "め", "も"],
  IR: ["や", "い", "ゆ", "え", "よ"],
  MP: ["ら", "り", "る", "れ", "ろ"],
  IP: ["わ", "を", "ん", "ー", "っ"],
};
const JP_PATTERN_LABELS = {
  I: "人差し", M: "中指", R: "薬指", P: "小指", IM: "人差し+中指", MR: "中指+薬指",
  RP: "薬指+小指", IR: "人差し+薬指", MP: "中指+小指", IP: "人差し+小指",
};
const JP_VOWEL_LABELS = ["中央", "左", "上", "右", "下"];

let jpFlick = null;      // { pattern, startX, startY, x, y }
let jpFlickArmed = true;

// 親指と各指先の距離パターン (10種) から「行」キーを求める
function jpPinchPattern(lm) {
  const scale = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6;
  const pairs = [["I", LM.INDEX_TIP], ["M", LM.MIDDLE_TIP], ["R", LM.RING_TIP], ["P", LM.PINKY_TIP]];
  const active = [];
  const threshold = jpFlick ? JP_PINCH_OFF : JP_PINCH_ON;
  for (const [key, tip] of pairs) {
    if (dist(lm[LM.THUMB_TIP], lm[tip]) / scale < threshold) active.push(key);
  }
  const pattern = active.join("");
  return JP_ROWS[pattern] ? pattern : null;
}

// パー (全指伸展かつ非ピンチ) = 次文字入力の再武装トリガ
function jpNeutralOpenPalm(lm) {
  const idxUp = fingerUp(lm, LM.INDEX_TIP, LM.INDEX_PIP);
  const midUp = fingerUp(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP);
  const rngUp = fingerUp(lm, LM.RING_TIP, LM.RING_PIP);
  const pnkUp = fingerUp(lm, LM.PINKY_TIP, LM.PINKY_PIP);
  return idxUp && midUp && rngUp && pnkUp && !jpPinchPattern(lm);
}

// 移動量 (dx,dy) → 母音インデックス (中央=あ段 / 左=い / 上=う / 右=え / 下=お)
function jpFlickVowelIndex(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < JP_FLICK_MIN) return 0;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 2 : 4;
}

function jpFlickAppend(kana) { const o = $("jpFlickOutput"); if (o) o.value += kana; }
function jpFlickSetStatus(text) { const s = $("jpFlickStatus"); if (s) s.textContent = text; }

// インライン onclick 用 (削除 / クリア)
export function jpFlickBackspace() { const o = $("jpFlickOutput"); if (o) o.value = o.value.slice(0, -1); }
export function jpFlickClear() {
  const o = $("jpFlickOutput"); if (o) o.value = "";
  jpFlick = null; jpFlickArmed = true;
  jpFlickSetStatus("10種類のピンチで行、フリック方向で母音を選びます。");
}

function updateJapaneseFlick(lm, cursor) {
  if (!jpFlickArmed) {
    if (jpNeutralOpenPalm(lm)) { jpFlickArmed = true; jpFlickSetStatus("パーを検出しました。次の文字を入力できます。"); }
    else jpFlickSetStatus("次の文字は、いったん手をパーに戻してから入力してください。");
    clearPadCursor();
    return;
  }
  const pattern = jpPinchPattern(lm);
  if (pattern) {
    if (!jpFlick || jpFlick.pattern !== pattern) jpFlick = { pattern, startX: cursor.x, startY: cursor.y, x: cursor.x, y: cursor.y };
    else { jpFlick.x = cursor.x; jpFlick.y = cursor.y; }
    const vowel = jpFlickVowelIndex(cursor.x - jpFlick.startX, cursor.y - jpFlick.startY);
    jpFlickSetStatus(`${JP_PATTERN_LABELS[pattern]}: ${JP_ROWS[pattern][0]}行 / ${JP_VOWEL_LABELS[vowel]} flick`);
    drawPadCursor(cursor.x, cursor.y, "draw");
    return;
  }
  if (jpFlick) {
    const vowel = jpFlickVowelIndex(jpFlick.x - jpFlick.startX, jpFlick.y - jpFlick.startY);
    const kana = JP_ROWS[jpFlick.pattern][vowel];
    jpFlickAppend(kana);
    jpFlickSetStatus(`${JP_PATTERN_LABELS[jpFlick.pattern]} + ${JP_VOWEL_LABELS[vowel]} = ${kana}`);
    jpFlick = null; jpFlickArmed = false;
  }
  clearPadCursor();
}

export default {
  id: "japanese",
  label: "日本語",
  reset() { jpFlick = null; jpFlickArmed = true; },
  onFrame(ctx) {
    const { lm, cursor, backFacing, langInfo } = ctx;
    if (backFacing) { jpFlick = null; clearPadCursor(); }   // 手の甲中はフリックを止める (言語切替専用)
    else updateJapaneseFlick(lm, cursor);
    setGesture(langInfo.fired ? `🔁 ${langInfo.label}` : "日本語フリック");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "日本語入力モード", backFacing ? "手の甲: 言語切替モーション中" : "ピンチで行、フリックで母音を選択");
    }
  },
};
