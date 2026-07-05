// 折り曲げ式入力の共有エンジン。日本語/英語が同じ運指メカニクスを使う。
//   パー基準 → 指を折って行を選ぶ(HOLD_MS 保持でロック) → 手のひらのフリック方向を1つ採用
//   → パーに戻して確定。折り/フリックは各入力1回だけロックする。
// 運指は 2進数で表す: bit0=親(T), bit1=人(I), bit2=中(M), bit3=薬(R), bit4=小(P)。
import { LM } from "./config.js";
import { dist, fingerUp } from "./core.js";

// 調整用しきい値 (両言語共通・設定UIで変更可)
export const th = { HOLD_MS: 150, FLICK_DIST: 0.16, THUMB_FOLD: 0.6 };

export const FINGER_ORDER = ["T", "I", "M", "R", "P"];   // bit0..bit4
export const FINGER_LABEL = { T: "親", I: "人", M: "中", R: "薬", P: "小" };
export const canonFold = (arr) => FINGER_ORDER.filter((f) => arr.includes(f)).join("");
// 2進数(行番号) → 折る指集合
export const foldFromNumber = (n) => FINGER_ORDER.filter((_, i) => n & (1 << i));

const thumbFolded = (lm) => {
  const s = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6;
  return dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_MCP]) / s < th.THUMB_FOLD;   // 親先が手のひら中央に近い=折り
};
// 折れている指の集合を正規化文字列 (T,I,M,R,P 順) で返す
export function foldedSet(lm) {
  const a = [];
  if (thumbFolded(lm)) a.push("T");
  if (!fingerUp(lm, LM.INDEX_TIP, LM.INDEX_PIP)) a.push("I");
  if (!fingerUp(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP)) a.push("M");
  if (!fingerUp(lm, LM.RING_TIP, LM.RING_PIP)) a.push("R");
  if (!fingerUp(lm, LM.PINKY_TIP, LM.PINKY_PIP)) a.push("P");
  return a.join("");
}
// 折り曲げで動かない手のひらの代表点 (手首+人差し/小指付け根の中心)。selfie 座標(1-x)。
const palmPoint = (lm) => {
  const w = lm[LM.WRIST], i = lm[LM.INDEX_MCP], p = lm[LM.PINKY_MCP];
  return { x: 1 - (w.x + i.x + p.x) / 3, y: (w.y + i.y + p.y) / 3 };
};
function flickDir(dx, dy) {
  if (Math.hypot(dx, dy) < th.FLICK_DIST) return 0;          // 中央
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;   // 左 / 右
  return dy < 0 ? 2 : 4;                                    // 上 / 下
}

// 状態機械。getFoldMap()=現運指(エントリ→指配列), getOrder()=エントリ順,
// onCommit(entry, flickIndex)=パー確定時に呼ばれる。update() は毎フレーム状態を返す。
export function createFoldEngine(getFoldMap, getOrder, onCommit) {
  let pending = null, locked = null, start = null, idx = 0, flickLocked = false;
  const reset = () => { pending = null; locked = null; start = null; idx = 0; flickLocked = false; };
  function foldToEntry() {
    const m = {};
    for (const e of getOrder()) m[canonFold(getFoldMap()[e])] = e;
    return m;
  }
  function update(lm, now) {
    const fs = foldedSet(lm);
    if (locked) {
      if (fs === "") { const e = locked, fi = idx; reset(); onCommit(e, fi); return { phase: "commit", entry: e, flickIndex: fi }; }
      if (!flickLocked && start) {
        const c = palmPoint(lm), dx = c.x - start.x, dy = c.y - start.y;
        if (Math.hypot(dx, dy) >= th.FLICK_DIST) { idx = flickDir(dx, dy); flickLocked = true; }
      }
      return { phase: "locked", entry: locked, flickIndex: idx };
    }
    if (fs === "") { pending = null; return { phase: "idle" }; }
    const entry = foldToEntry()[fs] || null;
    if (!entry) { pending = null; return { phase: "unknown" }; }
    if (!pending || pending.key !== fs) { pending = { key: fs, since: now, ref: palmPoint(lm) }; return { phase: "pending", entry }; }
    if (now - pending.since >= th.HOLD_MS) { locked = entry; start = pending.ref; idx = 0; flickLocked = false; pending = null; return { phase: "locked", entry, flickIndex: 0 }; }
    return { phase: "pending", entry };
  }
  return { update, reset };
}
