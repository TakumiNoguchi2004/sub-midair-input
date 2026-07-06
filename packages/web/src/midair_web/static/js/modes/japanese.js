// 日本語入力 (新方式):
//   グー / パー = レスト (入力待ち)
//   中間状態 (T/I/M のいずれかを伸展) + orientation(0°/90°) → 行選択
//   フリック → 即自動確定
//   グー → あ段 (フリックなし) 確定
//   CommonGestures delete (グーフリップ) → 1文字削除
import { LM } from "../config.js";
import {
  dist, fingerUp, $, clearPadCursor, drawPadCursor, setGesture, setCameraState, applyLangCamState,
} from "../core.js";

// --- 調整用しきい値 ---
let HOLD_MS    = 150;   // 行選択ポーズをこの ms 保持でロック
let FLICK_DIST = 0.05;  // 基準点からこの距離を超えたらフリック検知
// 戻り判定: FLICK_DIST * FLICK_RETURN_RATIO 以内に戻ったら次フリックを受け付ける
const FLICK_RETURN_RATIO = 0.5;

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
const DIR_LABELS = ["中央", "左", "上", "右", "下"];

// --- 濁音/半濁音/小 のループ ---
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

// --- 運指テーブル: orient(0°/90°) × extend(T/I/M) → 行 ---
// orient 0  = 手のひらが通常向き (|roll| < 45°)
// orient 90 = 手を90°傾けた向き (|roll| >= 45°)
export const DEFAULT_ROW_MAP = [
  { row: "あ", orient: 0,  extend: ["T"]           },
  { row: "か", orient: 0,  extend: ["I"]           },
  { row: "さ", orient: 0,  extend: ["T", "I"]      },
  { row: "た", orient: 0,  extend: ["I", "M"]      },
  { row: "な", orient: 0,  extend: ["T", "I", "M"] },
  { row: "は", orient: 90, extend: ["T"]           },
  { row: "ま", orient: 90, extend: ["I"]           },
  { row: "や", orient: 90, extend: ["T", "I"]      },
  { row: "ら", orient: 90, extend: ["I", "M"]      },
  { row: "わ", orient: 90, extend: ["T", "I", "M"] },
];
export let rowMap = JSON.parse(JSON.stringify(DEFAULT_ROW_MAP));

const EXTEND_ORDER = ["T", "I", "M"];
export function canonExtend(arr) { return EXTEND_ORDER.filter((f) => arr.includes(f)).join(""); }

// 伸展中の T/I/M をキーに変換 (薬指・小指は無視)
function extendedKey(hand) {
  const s = [];
  if (hand.fingers.thumb)  s.push("T");
  if (hand.fingers.index)  s.push("I");
  if (hand.fingers.middle) s.push("M");
  return s.join("");
}

// |roll| >= 45° を 90°グループ、それ以外を 0°グループとして扱う
function orientGroup(hand) {
  return Math.abs(hand.orientation.roll) >= 45 ? 90 : 0;
}

// extend × orient → 行名 (マッチなければ null)
function extendToRow(hand) {
  const key = extendedKey(hand);
  if (!key) return null;
  const og = orientGroup(hand);
  for (const r of rowMap) {
    if (r.orient === og && canonExtend(r.extend) === key) return r.row;
  }
  return null;
}

function flickDir(dx, dy) {
  if (Math.hypot(dx, dy) < FLICK_DIST) return 0;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 2 : 4;
}

// --- 出力ヘルパ ---
function jpAppend(kana) { const o = $("jpFlickOutput"); if (o) o.value += kana; }
function jpStatus(text) { const s = $("jpFlickStatus"); if (s) s.textContent = text; }

function applyDakuten() {
  const o = $("jpFlickOutput");
  if (!o || !o.value) { jpStatus("濁点化: 直前の文字がありません"); return; }
  const last = o.value.slice(-1);
  const next = DAKUTEN_NEXT[last];
  if (next) { o.value = o.value.slice(0, -1) + next; jpStatus(`${last} → ${next}`); }
  else jpStatus(`「${last}」に対応形なし`);
}

export function jpFlickBackspace() { const o = $("jpFlickOutput"); if (o) o.value = o.value.slice(0, -1); }
export function jpFlickClear() {
  const o = $("jpFlickOutput"); if (o) o.value = "";
  resetState();
  jpStatus("クリアしました");
}

// --- 状態機械 ---
let lockedRow  = null;   // ロック中の行名 (null = 未ロック)
let rowPending = null;   // { row, since, ref } 行選択のデバウンス候補
let flickStart = null;   // ポーズロック時の手のひら基準座標 (固定)
let flickArmed = true;   // true=フリック受付中, false=検知済み・基準に戻るまで待機

function resetFull() {
  lockedRow = null; rowPending = null; flickStart = null; flickArmed = true;
}

function updateJapanese(hand, now) {
  const isRest = hand.isFist || hand.isOpen;
  const row    = isRest ? null : extendToRow(hand);

  // ---- ロック中 ----
  if (lockedRow) {
    // パー → キャンセル
    if (hand.isOpen) { resetFull(); jpStatus("キャンセル"); return; }

    // グー → あ段確定 + ロック解除
    if (hand.isFist) {
      const r = lockedRow; resetFull();
      const kana = ROWS[r][0]; jpAppend(kana);
      jpStatus(`${r}行 中央 → ${kana}`);
      return;
    }

    // ポーズが変わった → HOLD_MS で新しい行へ切り替え (レスト不要)
    if (row !== lockedRow) {
      flickArmed = true;
      if (!row) { rowPending = null; jpStatus(`${lockedRow}行 (未割り当て)`); return; }
      if (!rowPending || rowPending.row !== row) {
        rowPending = { row, since: now, ref: hand.palmPoint };
      } else if (now - rowPending.since >= HOLD_MS) {
        lockedRow  = row;
        flickStart = rowPending.ref;
        rowPending = null; flickArmed = true;
        jpStatus(`${row}行: フリックで母音 / グーであ段`);
      } else { jpStatus(`${row}行…`); }
      return;
    }

    // 同じ行: フリック判定
    rowPending = null;
    if (!flickStart) flickStart = hand.palmPoint;

    const cur = hand.palmPoint;
    const dx = cur.x - flickStart.x, dy = cur.y - flickStart.y;
    const d   = Math.hypot(dx, dy);
    const dir = flickDir(dx, dy);

    if (!flickArmed) {
      // 検知済み: 基準に戻ったら再度受け付け
      if (d < FLICK_DIST * FLICK_RETURN_RATIO) flickArmed = true;
      jpStatus(`${lockedRow}行: 基準に戻して次フリック`);
      return;
    }

    // フリック受付中: 閾値を超えたら即確定
    if (dir !== 0) {
      const kana = ROWS[lockedRow][dir];
      jpAppend(kana);
      jpStatus(`${lockedRow}行 ${DIR_LABELS[dir]} → ${kana}`);
      flickArmed = false;
      return;
    }

    jpStatus(`${lockedRow}行: フリックで母音 / グーであ段`);
    return;
  }

  // ---- 非ロック ----
  if (isRest) {
    rowPending = null;
    jpStatus(orientGroup(hand) === 90 ? "90°: は/ま/や/ら/わ行" : "0°: あ/か/さ/た/な行");
    return;
  }

  // ---- 中間状態: 行選択 ----
  if (!row) { rowPending = null; jpStatus("未割り当て"); return; }
  if (!rowPending || rowPending.row !== row) {
    rowPending = { row, since: now, ref: hand.palmPoint };
  } else if (now - rowPending.since >= HOLD_MS) {
    lockedRow  = row;
    flickStart = rowPending.ref;
    rowPending = null; flickArmed = true;
    jpStatus(`${row}行: フリックで母音 / グーであ段`);
  } else { jpStatus(`${row}行…`); }
}

export default {
  id: "japanese",
  label: "日本語",
  reset() { resetFull(); },
  onFrame(ctx) {
    const { cursor, now, langInfo, hand, gesture } = ctx;
    // CommonGestures delete → 1文字削除
    if (gesture && gesture.fired === "delete") { jpFlickBackspace(); jpStatus("1文字削除"); }
    drawPadCursor(cursor.x, cursor.y, "point");
    updateJapanese(hand, now);
    // デバッグ: flickStart (基準点) と判定半径を padCursor に重ね描画
    if (lockedRow && flickStart) {
      const el = $("padCursor");
      if (el) {
        const g = el.getContext("2d");
        const px = flickStart.x * el.width, py = flickStart.y * el.height;
        const r  = FLICK_DIST * el.width;
        g.save();
        g.strokeStyle = flickArmed ? "#00cc44" : "#ff8800";
        g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, 8, 0, Math.PI * 2); g.stroke();
        g.setLineDash([4, 4]);
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.restore();
      }
    }
    setGesture(langInfo.fired ? `-> ${langInfo.label}` : "日本語");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "日本語入力モード", "指を伸ばして行選択 / フリック or グーで確定");
    }
  },
};

// =====================================================================
//  設定UI: しきい値スライダ + 運指テーブル表示
// =====================================================================
export function renderJapaneseSettings() {
  const root = $("jpFingerConfig");
  if (!root) return;
  root.innerHTML = "";

  const thTitle = document.createElement("div");
  thTitle.className = "jp-cfg-title"; thTitle.textContent = "検出しきい値";
  root.appendChild(thTitle);
  root.appendChild(makeSlider("行ロック(ms)", 60, 600, 10, HOLD_MS, (v) => { HOLD_MS = v; }));
  root.appendChild(makeSlider("フリック距離", 0.02, 1.00, 0.01, FLICK_DIST, (v) => { FLICK_DIST = v; }));

  const mapTitle = document.createElement("div");
  mapTitle.className = "jp-cfg-title"; mapTitle.textContent = "運指テーブル (orient × extend → 行)";
  root.appendChild(mapTitle);

  const table = document.createElement("table");
  table.className = "jp-cfg-table";
  table.innerHTML = `<thead><tr><th>行</th><th>向き</th><th>伸ばす指</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const r of rowMap) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.row}行</td><td>${r.orient}°</td><td>${r.extend.join("+")}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);
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
