// 日本語入力 (折り曲げ式): 共有エンジン foldcore を使い、行(子音)を「折り曲げの2進数」で選び、
// フリック方向で母音を選ぶ。パーに戻すと確定。backend 不要のフロント完結。
//   運指(2進数): あ=1(親), か=2(人), さ=3(親人), た=4(中), な=5(親中), は=6(人中),
//                ま=7(親人中), や=8(薬), ら=9(親薬), わ=10(人薬)。濁点/小=12(中薬)。
//   詳細は docs/japanese_input.md。しきい値/運指は設定UIで調整可 (foldcore.th / foldMap)。
import { foldFromNumber, createFoldEngine } from "../foldcore.js";
import { renderFoldConfig } from "../fingereditor.js";
import {
  $, clearPadCursor, drawPadCursor, setGesture, setCameraState, applyLangCamState,
} from "../core.js";

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

// 濁音/半濁音/小 のループ (対応字がある場合のみ。順: 濁音→半濁音→小→元)
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

// --- 運指マッピング: 行/操作 → 折る指集合 (2進数)。設定UIで変更可・言語切替をまたいで維持。 ---
const SPECIAL_ORDER = ["濁点", "消す"];
const ALL_ENTRIES = [...ROW_ORDER, ...SPECIAL_ORDER];
const ROW_NUM = { "あ": 1, "か": 2, "さ": 3, "た": 4, "な": 5, "は": 6, "ま": 7, "や": 8, "ら": 9, "わ": 10 };
const DEFAULT_FOLD = {};
for (const r of ROW_ORDER) DEFAULT_FOLD[r] = foldFromNumber(ROW_NUM[r]);
DEFAULT_FOLD["濁点"] = foldFromNumber(12);   // 中+薬 (濁音/半濁音/小)
DEFAULT_FOLD["消す"] = foldFromNumber(28);   // 中+薬+小 (親は曲げない)
export let foldMap = JSON.parse(JSON.stringify(DEFAULT_FOLD));

function entryLabel(e) { return e === "濁点" ? "濁点化" : e === "消す" ? "1文字削除" : `${e}行`; }

// --- 出力 ---
function jpAppend(kana) { const o = $("jpFlickOutput"); if (o) o.value += kana; }
function jpStatus(text) { const s = $("jpFlickStatus"); if (s) s.textContent = text; }
function applyDakuten() {
  const o = $("jpFlickOutput");
  if (!o || !o.value) { jpStatus("濁点化: 直前の文字がありません"); return; }
  const last = o.value.slice(-1), next = DAKUTEN_NEXT[last];
  if (next) { o.value = o.value.slice(0, -1) + next; jpStatus(`濁点/半濁点/小: ${last} → ${next}`); }
  else jpStatus(`濁点化: 「${last}」に対応形なし`);
}

export function jpFlickBackspace() { const o = $("jpFlickOutput"); if (o) o.value = o.value.slice(0, -1); }
export function jpFlickClear() {
  const o = $("jpFlickOutput"); if (o) o.value = "";
  engine.reset();
  jpStatus("指を折って行を選び、フリック→パーで確定します。");
}

// --- パー確定時の出力 ---
function onCommit(entry, flickIndex) {
  if (entry === "濁点") applyDakuten();
  else if (entry === "消す") {
    const o = $("jpFlickOutput");
    if (o && o.value) { o.value = o.value.slice(0, -1); jpStatus("1文字削除しました"); }
    else jpStatus("削除: 文字がありません");
  } else {
    const kana = ROWS[entry][flickIndex];
    jpAppend(kana);
    jpStatus(`${entry}行 ${DIR_LABELS[flickIndex]} = ${kana}`);
  }
}

const engine = createFoldEngine(() => foldMap, () => ALL_ENTRIES, onCommit);

export default {
  id: "japanese",
  label: "日本語",
  reset() { engine.reset(); },
  onFrame(ctx) {
    const { lm, cursor, now, langInfo } = ctx;
    drawPadCursor(cursor.x, cursor.y, "point");
    const st = engine.update(lm, now);
    if (st.phase === "locked") {
      const e = st.entry;
      if (e === "濁点") jpStatus("濁点/半濁点/小: パーに戻すと適用");
      else if (e === "消す") jpStatus("1文字削除: パーに戻すと実行");
      else jpStatus(`${e}行 → ${DIR_LABELS[st.flickIndex]}「${ROWS[e][st.flickIndex]}」 (パーで確定)`);
    } else if (st.phase === "pending") jpStatus(`${entryLabel(st.entry)} …`);
    else if (st.phase === "idle") jpStatus("パー基準: 指を折って行/操作を選択");
    else if (st.phase === "unknown") jpStatus("その運指は未割り当て");
    setGesture(langInfo.fired ? `🔁 ${langInfo.label}` : "日本語(折り曲げ)");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "日本語入力モード", "指を折って行→フリック→パーで確定");
    }
  },
};

// =====================================================================
//  設定UI (デモ): しきい値スライダ + 運指(行/濁点/消す → 折る指)エディタ
// =====================================================================
export function renderJapaneseSettings() {
  renderFoldConfig($("jpFingerConfig"), {
    thresholds: true,
    foldMap, order: ALL_ENTRIES,
    labelFn: (e) => (SPECIAL_ORDER.includes(e) ? e : `${e}行`),
    mapTitle: "運指 (行/操作 → 折り曲げる指)",
  });
}
