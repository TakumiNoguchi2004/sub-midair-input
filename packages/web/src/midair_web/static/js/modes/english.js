// 英語入力 (折り曲げ式): 日本語と同じ運指エンジン (foldcore) を使う。
//   行(1-11) を「折り曲げの2進数」で選び、フリック方向で文字を選ぶ。パーで確定。
//   中指+薬指(=12) : 直前英字の大文字/小文字トグル
//   中指+薬指+小指(=28): 1文字削除 (日本語の削除と共通)
// 運指は英語モードの設定パネル(#enRef)で変更可。
import { foldFromNumber, createFoldEngine } from "../foldcore.js";
import { renderFoldConfig } from "../fingereditor.js";
import { t, dirLabels } from "../i18n.js";
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
    if (o && o.value && isAlpha(o.value.slice(-1))) { o.value = o.value.slice(0, -1) + swapCase(o.value.slice(-1)); enStatus(t("en.caseToggled")); }
    else enStatus(t("en.caseNoAlpha"));
    return;
  }
  if (entry === "消す") {
    if (o && o.value) { o.value = o.value.slice(0, -1); enStatus(t("en.deleted")); }
    else enStatus(t("en.delEmpty"));
    return;
  }
  const ch = ROWS[entry][flickIndex] || "";
  if (!ch) { enStatus(t("en.dirUnassigned")); return; }
  enAppend(ch);
  enStatus(t("en.committed", { entry, dir: dirLabels()[flickIndex], ch: show(ch) }));
}

const engine = createFoldEngine(() => foldMap, () => ALL_ENTRIES, onCommit);

function preview(entry, flickIndex) {
  if (entry === "大小") return t("en.previewCase");
  if (entry === "消す") return t("en.previewDelete");
  return t("en.previewRow", { entry, dir: dirLabels()[flickIndex], ch: show(ROWS[entry][flickIndex] || "") });
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
    else if (st.phase === "pending") enStatus(t("en.pending", { entry: st.entry }));
    else if (st.phase === "idle") enStatus(t("en.idle"));
    else if (st.phase === "unknown") enStatus(t("en.unknown"));
    setGesture(langInfo.fired ? `🔁 ${langInfo.label}` : t("gesture.enFold"));
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", t("cam.modeLabel", { label: t("mode.english") }), t("cam.foldDetail"));
    }
  },
};

// 英語モードの運指参照 (読み取り専用)。#enRef に描画。
// 英語モードの運指エディタ (日本語と同じ共有UI・変更可)。行ラベルに文字も表示。
export function renderEnglishSettings() {
  renderFoldConfig($("enRef"), {
    thresholds: false,   // しきい値スライダは日本語側に集約 (両言語共通)
    foldMap, order: ALL_ENTRIES,
    labelFn: (e) => (e === "大小" ? t("en.special.case") : e === "消す" ? t("en.special.delete") : `${e}:${ROWS[e].map(show).join("")}`),
    mapTitle: t("en.mapTitle"),
  });
}
