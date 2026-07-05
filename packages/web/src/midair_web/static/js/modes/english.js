// 英語入力 (折り曲げ式): 日本語と同じ運指エンジン (foldcore) を使う。
//   行(1-11) を「折り曲げの2進数」で選び、フリック方向で文字を選ぶ。パーで確定。
//   中指+薬指(=12) : 直前英字の大文字/小文字トグル
//   中指+薬指+小指(=28): 1文字削除 (日本語の削除と共通)
// 運指は英語モードの設定パネル(#enRef)で変更可。
import { foldFromNumber, createFoldEngine } from "../foldcore.js";
import { renderFoldConfig } from "../fingereditor.js";
import { $, drawPadCursor, setGesture, setCameraState, applyLangCamState } from "../core.js";

// 行 → [中央, 左, 上, 右, 下]。右フリックは空文字(=無し)のことがある。
const ROWS = {
  "1": ["a", "b", "c", "", "1"],
  "2": ["d", "e", "f", "", "2"],
  "3": ["g", "h", "i", "", "3"],
  "4": ["j", "k", "l", "", "4"],
  "5": ["m", "n", "o", "", "5"],
  "6": ["p", "q", "r", "s", "6"],
  "7": ["t", "u", "v", "", "7"],
  "8": ["w", "x", "y", "z", "8"],
  "9": ["(", ")", "'", '"', "9"],
  "10": ["-", "+", "*", "/", "0"],
  "11": [" ", ",", ".", "?", "!"],
};
const ROW_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
const SPECIAL_ORDER = ["大小", "消す"];
const ALL_ENTRIES = [...ROW_ORDER, ...SPECIAL_ORDER];
const DIR_LABELS = ["中央", "左", "上", "右", "下"];

const foldMap = {};
for (const r of ROW_ORDER) foldMap[r] = foldFromNumber(Number(r));
foldMap["大小"] = foldFromNumber(12);   // 中+薬
foldMap["消す"] = foldFromNumber(28);   // 中+薬+小 (日本語の削除と統一)

const isAlpha = (c) => c >= "a" && c <= "z" || c >= "A" && c <= "Z";
const swapCase = (c) => (c >= "a" && c <= "z" ? c.toUpperCase() : c >= "A" && c <= "Z" ? c.toLowerCase() : c);
const show = (c) => (c === " " ? "␣" : c || "—");

function enAppend(s) { const o = $("jpFlickOutput"); if (o) o.value += s; }
function enStatus(t) { const s = $("jpFlickStatus"); if (s) s.textContent = t; }

function onCommit(entry, flickIndex) {
  const o = $("jpFlickOutput");
  if (entry === "大小") {
    if (o && o.value && isAlpha(o.value.slice(-1))) { o.value = o.value.slice(0, -1) + swapCase(o.value.slice(-1)); enStatus("直前の英字の大小を切替"); }
    else enStatus("大小: 直前が英字ではありません");
    return;
  }
  if (entry === "消す") {
    if (o && o.value) { o.value = o.value.slice(0, -1); enStatus("1文字削除しました"); }
    else enStatus("削除: 文字がありません");
    return;
  }
  const ch = ROWS[entry][flickIndex] || "";
  if (!ch) { enStatus("その方向は未割り当て"); return; }
  enAppend(ch);
  enStatus(`行${entry} ${DIR_LABELS[flickIndex]} = ${show(ch)}`);
}

const engine = createFoldEngine(() => foldMap, () => ALL_ENTRIES, onCommit);

function preview(entry, flickIndex) {
  if (entry === "大小") return "直前英字の大小トグル (パーで確定)";
  if (entry === "消す") return "1文字削除 (パーで確定)";
  return `行${entry} → ${DIR_LABELS[flickIndex]}「${show(ROWS[entry][flickIndex] || "")}」 (パーで確定)`;
}

export default {
  id: "english",
  label: "英語",
  reset() { engine.reset(); },
  onFrame(ctx) {
    const { lm, cursor, now, langInfo } = ctx;
    drawPadCursor(cursor.x, cursor.y, "point");
    const st = engine.update(lm, now);
    if (st.phase === "locked") enStatus(preview(st.entry, st.flickIndex));
    else if (st.phase === "pending") enStatus(`行${st.entry} …`);
    else if (st.phase === "idle") enStatus("パー基準: 指を折って行を選択");
    else if (st.phase === "unknown") enStatus("その運指は未割り当て");
    setGesture(langInfo.fired ? `🔁 ${langInfo.label}` : "英語(折り曲げ)");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "英語入力モード", "指を折って行→フリック→パーで確定");
    }
  },
};

// 英語モードの運指参照 (読み取り専用)。#enRef に描画。
// 英語モードの運指エディタ (日本語と同じ共有UI・変更可)。行ラベルに文字も表示。
export function renderEnglishSettings() {
  renderFoldConfig($("enRef"), {
    thresholds: false,   // しきい値スライダは日本語側に集約 (両言語共通)
    foldMap, order: ALL_ENTRIES,
    labelFn: (e) => (SPECIAL_ORDER.includes(e) ? e : `${e}:${ROWS[e].map(show).join("")}`),
    mapTitle: "英語 運指 (行:文字 → 折る指) — 変更可",
  });
}
