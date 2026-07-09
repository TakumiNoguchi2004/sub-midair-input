// 英語入力 (JP方式を移植):
//   行未ロック時: グー / パー = レスト (入力待ち)
//   中間状態 (T/I/M/R/P の伸展の組み合わせ) → 行選択
//   フリック(手を動かす) → 方向を即自動確定
//   グー(握る) → 中央の文字を小文字で即確定
//   フリップ(指を伸ばしたまま中央で手首をひねる) → 中央の文字を大文字で確定
//   確定直後、同じポーズのままもう一度フリップ → 大文字/小文字をトグル
//   フリップ中(ロール角がニュートラルから外れている間)は姿勢判定(グー/パー/行)を凍結し、
//   指の見え方が乱れても誤爆しないようにする
//   JP専用削除と同型の削除ジェスチャー(グーを握ってひねる) → 1文字削除 / 全削除
import { LM } from "../config.js";
import { $, drawPadCursor, setGesture, setCameraState, applyLangCamState } from "../core.js";

// --- 調整用しきい値 ---
let HOLD_MS    = 150;   // 行選択ポーズをこの ms 保持でロック
let FLICK_DIST = 0.07;  // 基準点からこの距離を超えたらフリック検知 / 戻り判定も同じ距離

// --- 行の文字表 (行の代表 → [中央, 左, 上, 右, 下]。空文字列は未割り当て) ---
const ROWS = {
  "1":  ["a", "b", "c", "",  "1"],
  "2":  ["d", "e", "f", "",  "2"],
  "3":  ["g", "h", "i", "",  "3"],
  "4":  ["j", "k", "l", "",  "4"],
  "5":  ["m", "n", "o", "",  "5"],
  "6":  ["p", "q", "r", "s", "6"],
  "7":  ["t", "u", "v", "",  "7"],
  "8":  ["w", "x", "y", "z", "8"],
  "9":  ["(", ")", "'", "\"", "9"],
  "10": ["-", "+", "*", "/", "0"],
  "11": [" ", ",", ".", "?", "!"],
};
const DIR_LABELS = ["center", "left", "up", "right", "down"];

const isAlpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const show = (c) => (c === " " ? "⎵" : c || "—");

// --- 運指テーブル: extend(T/I/M/P の組み合わせ) → 行。JPの運指テーブルと1:1で対応させ、
//     日本語のかな行(あ/か/さ/た/な/は/ま/や/ら/わ/、)と同じ指の動きで行を切り替えられるようにする ---
// JP と 1:1 対応 (同じ指の組み合わせで JP の同じ行番号を選択できる)
export const DEFAULT_ROW_MAP = [
  { row: "1",  extend: ["T"]                   },
  { row: "2",  extend: ["I"]                   },
  { row: "3",  extend: ["I", "M"]              },
  { row: "4",  extend: ["M", "R"]              },
  { row: "5",  extend: ["R", "P"]              },
  { row: "6",  extend: ["T", "I"]              },
  { row: "7",  extend: ["I", "M", "R"]         },
  { row: "8",  extend: ["M", "R", "P"]         },
  { row: "9",  extend: ["I", "M", "R", "P"]   },
  { row: "10", extend: ["T", "I", "M"]         },
  { row: "11", extend: ["P"]                   },
];
export let rowMap = JSON.parse(JSON.stringify(DEFAULT_ROW_MAP));

const EXTEND_ORDER = ["T", "I", "M", "R", "P"];
export function canonExtend(arr) { return EXTEND_ORDER.filter((f) => arr.includes(f)).join(""); }

function extendedKey(hand) {
  const s = [];
  if (hand.fingers.thumb)  s.push("T");
  if (hand.fingers.index)  s.push("I");
  if (hand.fingers.middle) s.push("M");
  if (hand.fingers.ring)   s.push("R");
  if (hand.fingers.pinky)  s.push("P");
  return s.join("");
}

// extend → 行名 (マッチなければ null)
function extendToRow(hand) {
  const key = extendedKey(hand);
  for (const r of rowMap) {
    if (canonExtend(r.extend) === key) return r.row;
  }
  return null;
}

function flickDir(dx, dy) {
  if (Math.hypot(dx, dy) < FLICK_DIST) return 0;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 2 : 4;
}

// ヒステリシス付き方向判定: 隣接セクター間の切り替えに HYST_RATIO の余裕を要求する
const HYST_RATIO = 1.5;
function flickDirHyst(dx, dy, prevDir) {
  if (Math.hypot(dx, dy) < FLICK_DIST) return 0;
  const rawHoriz = Math.abs(dx) >= Math.abs(dy);
  const rawDir   = rawHoriz ? (dx < 0 ? 1 : 3) : (dy < 0 ? 2 : 4);
  if (prevDir === 0) return rawDir;
  const prevHoriz = prevDir === 1 || prevDir === 3;
  if (prevHoriz !== rawHoriz) {
    const ratio = rawHoriz
      ? Math.abs(dx) / (Math.abs(dy) || 1e-9)
      : Math.abs(dy) / (Math.abs(dx) || 1e-9);
    if (ratio < HYST_RATIO) return prevDir;
  }
  return rawDir;
}

// --- 出力ヘルパ ---
function enAppend(ch) { const o = $("jpFlickOutput"); if (o) o.value += ch; }
function enStatus(text) { const s = $("jpFlickStatus"); if (s) s.textContent = text; }

export function enBackspace() { const o = $("jpFlickOutput"); if (o) o.value = o.value.slice(0, -1); }
export function enClear() {
  const o = $("jpFlickOutput"); if (o) o.value = "";
  resetFull();
  enStatus("Cleared");
}

// --- 状態機械 (JPと同型) ---
let lockedRow   = null;   // ロック中の行名 (null = 未ロック)
let rowPending  = null;   // { row, since } 行選択のデバウンス候補
let flickStart  = null;   // フリック基準座標 (最後のパー位置 or ロック時位置)
let flickArmed  = true;   // true=フリック受付中, false=検知済み・基準に戻るまで待機
let lastOpenPos = null;   // 最後に isOpen だったときの palmPoint
let _enGuuFrozenPos = null; // グー開始時に凍結したカーソル位置 (JP と同様)
let leftMargin  = false;  // 現在の確定サイクル中に一度でも FLICK_DIST 外に出たか
let centerBaseRoll = 0;   // 中央確定用フリップのロール基準 (中央保持中に追従)
let centerFlipping = false; // 中央確定用フリップの検出中フラグ
let _lastDir    = 0;      // 直前に確定したフリック方向 (マージン外連続入力のヒステリシス用)

// --- EN専用削除ステートマシン (JPと同一パラメータ) ---
const DEL_QUICK_MS     = 1000;  // これ以内に戻したら1文字削除
const DEL_HOLD_MS      = 1000;  // これ以上保持したら全削除
const DEL_ROLL_FLIP    = 90;    // roll がこれ以上変化したらフリップ (deg)
const DEL_ROLL_NEUTRAL = 30;    // この範囲内に戻ったら中立 (deg)
let _delCanFire   = false;
let _delFlipAt    = -1;

// 2つの角度(deg)の差を -180..180 に正規化して返す
function angleDelta(a, b) {
  let d = a - b;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function updateDelete(hand, now) {
  const roll = hand.orientation.roll;
  const isNeutral = Math.abs(roll) < DEL_ROLL_NEUTRAL;
  const isFlipped = Math.abs(roll) > DEL_ROLL_FLIP;
  const ret = (action, extra = {}) =>
    ({ action, phase: "idle", progress: 0, flippedMs: 0,
       isFlipped: _delCanFire && isFlipped, ...extra });

  if (!hand.isFist) {
    _delCanFire = false; _delFlipAt = -1;
    return ret(null, { phase: "idle" });
  }

  // roll=0°(基準姿勢)付近でのみ有効化
  if (!_delCanFire) {
    if (!isNeutral) return ret(null, { phase: "idle" });
    _delCanFire = true;
  }

  if (isNeutral) {
    if (_delFlipAt > 0) {
      const held = now - _delFlipAt;
      _delFlipAt = -1;
      if (held < DEL_QUICK_MS) {
        _delCanFire = false;
        return ret("delete1", { isFlipped: false });
      }
    }
    return ret(null, { phase: "armed" });
  }

  if (isFlipped) {
    if (_delFlipAt < 0) _delFlipAt = now;
    const held     = now - _delFlipAt;
    const progress = Math.min(1, held / DEL_HOLD_MS);
    if (held >= DEL_HOLD_MS) {
      _delFlipAt = -1; _delCanFire = false;
      return ret("deleteAll", { isFlipped: false });
    }
    return ret(null, { phase: "flipped", progress, flippedMs: held, isFlipped: true });
  }

  return ret(null, { phase: "armed" });
}

// --- 修飾ステートマシン (フリック後の大文字/小文字トグル) ---
const MOD_ROLL_FLIP    = 60;
const MOD_ROLL_NEUTRAL = 30;
let _modOrigChar   = null;   // フリック直後の元の文字 (常に小文字ベース)
let _modState      = 0;      // 0=小文字, 1=大文字
let _modBaseRoll   = 0;
let _modIsFlipping = false;

function cycleModifier() {
  if (_modOrigChar === null || !isAlpha(_modOrigChar)) return;
  const o = $("jpFlickOutput");
  if (!o || !o.value) return;
  _modState = _modState === 0 ? 1 : 0;
  const newChar = _modState === 1 ? _modOrigChar.toUpperCase() : _modOrigChar;
  o.value = o.value.slice(0, -1) + newChar;
}

function updateModifier(roll) {
  if (_modOrigChar === null) return;
  let d = roll - _modBaseRoll;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  if (!_modIsFlipping && Math.abs(d) > MOD_ROLL_FLIP) {
    _modIsFlipping = true;
    cycleModifier();
  } else if (_modIsFlipping && Math.abs(d) < MOD_ROLL_NEUTRAL) {
    _modIsFlipping = false;
    _modBaseRoll = roll;
  }
}

function resetModState() {
  _modOrigChar = null; _modState = 0; _modBaseRoll = 0; _modIsFlipping = false;
}

function resetRowState() {
  lockedRow = null; rowPending = null; flickStart = null; flickArmed = true; lastOpenPos = null;
  leftMargin = false; centerFlipping = false; _lastDir = 0;
  _delCanFire = false; _delFlipAt = -1;
}

function resetFull() {
  resetRowState();
  resetModState();
  _enGuuFrozenPos = null;
}

function updateEnglish(hand, now) {
  const isRest = hand.isFist || hand.isOpen;
  const row    = isRest ? null : extendToRow(hand);

  // ---- ロック中 ----
  if (lockedRow) {
    const rollBase = flickArmed ? centerBaseRoll : _modBaseRoll;
    const midFlip  = Math.abs(angleDelta(hand.orientation.roll, rollBase)) > MOD_ROLL_NEUTRAL;

    if (!midFlip) {
      // パー → キャンセル
      if (hand.isOpen) { resetFull(); enStatus("Cancelled"); return; }

      // グー → 中央の文字を小文字で即確定してロック解除
      if (hand.isFist) {
        if (flickArmed) {
          const ch = ROWS[lockedRow][0];
          enAppend(ch);
          enStatus(`Row ${lockedRow} center -> ${show(ch)}`);
        } else {
          enStatus(`Row ${lockedRow} done`);
        }
        resetRowState();
        return;
      }

      // ポーズが変わった → HOLD_MS で新しい行へ切り替え (レスト不要)
      if (row !== lockedRow) {
        if (!row) { rowPending = null; enStatus(`Row ${lockedRow} (unassigned pose)`); return; }
        if (!rowPending || rowPending.row !== row) {
          rowPending = { row, since: now };
        } else if (now - rowPending.since >= HOLD_MS) {
          lockedRow  = row;
          rowPending = null;
          flickArmed = false;   // 基準点へ戻るまでフリック判定を停止
          enStatus(`Row ${row}: return to center then flick / fist or flip for center`);
        } else { enStatus(`Row ${row}…`); }
        return;
      }
    }

    // 同じ行: フリック / フリップ判定
    rowPending = null;
    if (!flickStart) flickStart = hand.palmPoint;

    const cur = hand.palmPoint;
    const dx = cur.x - flickStart.x, dy = cur.y - flickStart.y;
    const d   = Math.hypot(dx, dy);
    const dir = flickDir(dx, dy);
    if (d >= FLICK_DIST) leftMargin = true;

    if (!flickArmed) {
      // マージン外: ヒステリシス付きで方向変化を検出し、境界を越えたら追加入力
      if (d >= FLICK_DIST) {
        const hystDir = flickDirHyst(dx, dy, _lastDir);
        if (hystDir !== 0 && hystDir !== _lastDir) {
          const ch = ROWS[lockedRow][hystDir];
          if (ch) {
            enAppend(ch);
            enStatus(`Row ${lockedRow} ${DIR_LABELS[hystDir]} -> ${show(ch)}`);
            _modOrigChar = ch; _modState = 0;
            _modBaseRoll = hand.orientation.roll; _modIsFlipping = false;
          }
          _lastDir = hystDir;
        }
      }
      // グー(削除ジェスチャー)とは手の形で区別する: 指を伸ばしたままの捻りのみ大小トグルとして扱う
      if (!hand.isFist) updateModifier(hand.orientation.roll);
      // 中央フリップでの確定は手を動かさないため、一度 FLICK_DIST の外に出て
      // 戻ってくるまでは再アームしない
      if (leftMargin && d < FLICK_DIST) {
        flickArmed = true; leftMargin = false; resetModState(); _lastDir = 0;
        centerBaseRoll = hand.orientation.roll; centerFlipping = false;
      }
      const modLabel = _modState === 1 ? " [UPPER]" : "";
      enStatus(`Row ${lockedRow}: return to center for next flick${modLabel} / flip to toggle case`);
      return;
    }

    // フリック受付中: 動かせば方向を即確定
    if (dir !== 0) {
      const ch = ROWS[lockedRow][dir];
      if (!ch) { enStatus(`Row ${lockedRow} ${DIR_LABELS[dir]}: unassigned`); return; }
      enAppend(ch);
      enStatus(`Row ${lockedRow} ${DIR_LABELS[dir]} -> ${show(ch)}`);
      _modOrigChar = ch; _modState = 0;
      _modBaseRoll = hand.orientation.roll; _modIsFlipping = false;
      _lastDir = dir;
      flickArmed = false;
      return;
    }

    // 中央 (未フリック): 手首をひねる(フリップ)で中央の文字を大文字で確定
    {
      const roll = hand.orientation.roll;
      const rd = angleDelta(roll, centerBaseRoll);
      if (!centerFlipping && Math.abs(rd) > MOD_ROLL_FLIP) {
        centerFlipping = true;
        const base = ROWS[lockedRow][0];
        // アルファベットなら素の小文字を経由せず、確定と同時に大文字から始める
        const hasUpper = isAlpha(base);
        const ch = hasUpper ? base.toUpperCase() : base;
        enAppend(ch);
        enStatus(`Row ${lockedRow} center -> ${show(ch)}`);
        _modOrigChar = base; _modState = hasUpper ? 1 : 0;
        _modBaseRoll = centerBaseRoll; _modIsFlipping = true;
        flickArmed = false;
        return;
      } else if (centerFlipping && Math.abs(rd) < MOD_ROLL_NEUTRAL) {
        centerFlipping = false; centerBaseRoll = roll;
      }
    }
    enStatus(`Row ${lockedRow}: flick for a letter / fist or flip for center`);
    return;
  }

  // ---- 非ロック ----
  if (isRest) {
    rowPending = null;
    if (hand.isOpen) lastOpenPos = hand.palmPoint;
    enStatus(hand.fingers.pinky ? "R+P: 5/8/9 or P: 11" : "T/I/M/R → rows 1/2/3/4");
    return;
  }

  // ---- 中間状態: 行選択 ----
  if (!row) { rowPending = null; enStatus("Unassigned"); return; }
  if (!rowPending || rowPending.row !== row) {
    rowPending = { row, since: now };
  } else if (now - rowPending.since >= HOLD_MS) {
    lockedRow  = row;
    flickStart = lastOpenPos ?? hand.palmPoint;
    rowPending = null; flickArmed = true; leftMargin = false;
    resetModState();
    centerBaseRoll = hand.orientation.roll; centerFlipping = false;
    enStatus(`Row ${row}: flick for a letter / fist or flip for center`);
  } else { enStatus(`Row ${row}…`); }
}

export default {
  id: "english",
  label: "English",
  reset() { resetFull(); const dbg = $("orientDebug"); if (dbg) dbg.style.display = "none"; },
  onFrame(ctx) {
    const { now, langInfo, hand, octx } = ctx;
    // EN専用削除: フリップ即戻し→1文字, 保持→全削除
    const del = updateDelete(hand, now);
    if (del.action === "delete1")        { enBackspace(); enStatus("Deleted 1 character"); }
    else if (del.action === "deleteAll") { enClear(); }
    if (hand.isFist) {
      const roll = hand.orientation.roll;
      if (del.phase === "flipped") {
        const remaining = Math.max(0, Math.round(DEL_QUICK_MS - del.flippedMs));
        enStatus(`roll:${roll.toFixed(0)}° flip detected / return -> delete 1 (${remaining}ms) / hold -> delete all (${Math.round(del.progress * 100)}%)`);
      } else if (del.phase === "armed") {
        enStatus(`roll:${roll.toFixed(0)}° fist detected / tilt to delete`);
      } else {
        enStatus(`roll:${roll.toFixed(0)}° fist`);
      }
    }
    // グー中はカーソルを最後のパー位置に凍結 (JP と同様)
    if (hand.isFist) {
      if (!_enGuuFrozenPos) _enGuuFrozenPos = flickStart ?? lastOpenPos ?? null;
    } else {
      _enGuuFrozenPos = null;
    }
    { const _pc = $("padCursor");
      const _cp = _enGuuFrozenPos ?? hand.palmPoint;
      drawPadCursor(_cp.x * (_pc?.width ?? 1), _cp.y * (_pc?.height ?? 1), "point"); }
    // 赤フラッシュ: drawPadCursor が clearRect するため必ずその後に描く (JP と同様)
    if (hand.isFist && del.isFlipped) {
      const pc = $("padCursor");
      if (pc) {
        const pg = pc.getContext("2d");
        pg.save();
        pg.fillStyle = "rgba(255,50,50,0.45)";
        pg.fillRect(0, 0, pc.width, pc.height);
        pg.restore();
      }
    }
    // デバッグ: 手に追従するローカル座標軸をoverlayに描画 (JPと同一の可視化)
    if (octx) {
      const lm = hand.lm;
      const o  = hand.orientation;
      const W  = octx.canvas.width, H = octx.canvas.height;

      const cx = (lm[LM.WRIST].x + lm[LM.INDEX_MCP].x + lm[LM.PINKY_MCP].x) / 3 * W;
      const cy = (lm[LM.WRIST].y + lm[LM.INDEX_MCP].y + lm[LM.PINKY_MCP].y) / 3 * H;

      const { fx, fy, fz } = hand.bodyFrame;

      const L = 50;
      const drawArrow = (g, ax, ay, bx, by, color) => {
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
        if (len < 1) return;
        const nx = dx / len, ny = dy / len;
        g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2;
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx - nx*9 + ny*4, by - ny*9 - nx*4);
        g.lineTo(bx - nx*9 - ny*4, by - ny*9 + nx*4);
        g.closePath(); g.fill();
      };
      const drawText = (g, text, canvasX, canvasY, color) => {
        g.save();
        g.translate(canvasX, canvasY); g.scale(-1, 1); g.textAlign = "center";
        g.font = "bold 11px monospace";
        g.lineWidth = 3; g.strokeStyle = "#000"; g.strokeText(text, 0, 0);
        g.fillStyle = color; g.fillText(text, 0, 0);
        g.restore();
      };

      const dot = (g, idx, color) => {
        const x = lm[idx].x * W, y = lm[idx].y * H;
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2);
        g.fillStyle = color; g.fill();
        g.strokeStyle = "#000"; g.lineWidth = 1.5; g.stroke();
      };
      octx.save();
      dot(octx, LM.WRIST,      "#4488ff");
      dot(octx, LM.MIDDLE_MCP, "#4488ff");
      dot(octx, LM.INDEX_MCP,  "#ff4444");
      dot(octx, LM.PINKY_MCP,  "#ff4444");

      drawArrow(octx, cx, cy, cx + fx[0]*L, cy + fx[1]*L, "#ff4444");
      drawText(octx, "X", cx + fx[0]*L, cy + fx[1]*L - 8, "#ff6666");
      drawArrow(octx, cx, cy, cx + fy[0]*L, cy + fy[1]*L, "#00ff44");
      drawText(octx, "Y", cx + fy[0]*L, cy + fy[1]*L - 8, "#00ff44");
      drawArrow(octx, cx, cy, cx + fz[0]*L, cy + fz[1]*L, "#4488ff");
      drawText(octx, "Z", cx + fz[0]*L, cy + fz[1]*L - 8, "#88aaff");

      const lx = cx, ly = cy + L + 16;
      drawText(octx, `R:${o.roll.toFixed(0)}°`,   lx, ly,      "#4488ff");
      drawText(octx, `P:${o.pitch.toFixed(0)}°`,  lx, ly + 14, "#ff4444");
      drawText(octx, `Y:${o.yaw.toFixed(0)}°`,    lx, ly + 28, "#00ff44");
      drawText(octx, `key:${extendedKey(hand)||"–"}`, lx, ly + 42, "#ffff00");

      octx.restore();
    }
    // updateEnglish 前にスナップショット (commit 後の resetRowState で消える前に取得)
    const _visRow = lockedRow;
    const _visRef = flickStart ?? (_enGuuFrozenPos ?? null);
    updateEnglish(hand, now);
    // flickStart (基準点) の可視化: マージン円 + X字仕切り + 現在位置への線
    if (_visRow && _visRef) {
      const el = $("padCursor");
      if (el) {
        const g = el.getContext("2d");
        const px = _visRef.x * el.width,  py = _visRef.y * el.height;
        const cx = (_enGuuFrozenPos ?? hand.palmPoint).x * el.width;
        const cy = (_enGuuFrozenPos ?? hand.palmPoint).y * el.height;
        const r  = FLICK_DIST * el.width;
        const ready = flickArmed;
        const rimColor = ready ? "#00cc44" : "#ff8800";

        g.save();

        g.strokeStyle = "rgba(255,255,255,0.3)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();

        const ext = r * 2;
        g.strokeStyle = rimColor;
        g.lineWidth = 2;
        g.globalAlpha = 0.4;
        g.beginPath();
        g.moveTo(px - ext, py - ext); g.lineTo(px + ext, py + ext);
        g.moveTo(px + ext, py - ext); g.lineTo(px - ext, py + ext);
        g.stroke();
        g.globalAlpha = 1.0;

        g.strokeStyle = rimColor;
        g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.stroke();

        g.fillStyle = rimColor;
        g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill();

        // 修飾状態バッジ (A) - フリック後の大文字/小文字トグル状態
        if (_modState > 0) {
          g.font = "bold 36px system-ui";
          g.textAlign = "center";
          g.textBaseline = "bottom";
          g.shadowColor = "rgba(0,0,0,0.9)";
          g.shadowBlur = 8;
          g.fillStyle = "#5bff8c";
          g.fillText("A", px, py - r - 4);
          g.shadowBlur = 0;
        }

        // フリック方向の文字ラベルを円周外周に表示 (JP と同様)
        { const chars = ROWS[_visRow];
          const labelR = r * 1.75;
          const adx = (_enGuuFrozenPos ?? hand.palmPoint).x - _visRef.x;
          const ady = (_enGuuFrozenPos ?? hand.palmPoint).y - _visRef.y;
          const activeDir = flickDir(adx, ady);
          const labelPositions = [
            { dx: 0,       dy: 0,       idx: 0 },
            { dx: -labelR, dy: 0,       idx: 1 },
            { dx: 0,       dy: -labelR, idx: 2 },
            { dx: labelR,  dy: 0,       idx: 3 },
            { dx: 0,       dy: labelR,  idx: 4 },
          ];
          g.font = "bold 22px system-ui";
          g.textAlign = "center";
          g.textBaseline = "middle";
          for (const { dx, dy, idx } of labelPositions) {
            const ch = show(chars[idx]);
            if (!ch || ch === "—") continue;
            const tx = px + dx, ty = py + dy;
            const isActive = flickArmed && activeDir === idx && idx !== 0;
            g.lineWidth = 5;
            g.strokeStyle = "rgba(0,0,0,0.85)";
            g.strokeText(ch, tx, ty);
            g.fillStyle = isActive ? "#ffd15b"
              : flickArmed ? "#ffffff" : "rgba(255,255,255,0.55)";
            g.fillText(ch, tx, ty);
          }
        }

        g.restore();
      }
    }
    setGesture(langInfo.fired ? `-> ${langInfo.label}` : "—");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "English", "Extend fingers to pick a row / flick for a letter, fist or flip for center");
    }
  },
};

// =====================================================================
//  設定UI: しきい値スライダ + 運指テーブル表示 (JPと同一構成)
// =====================================================================
export function renderEnglishSettings() {
  const root = $("enRef");
  if (!root) return;
  root.innerHTML = "";

  const mapTitle = document.createElement("div");
  mapTitle.className = "jp-cfg-title"; mapTitle.textContent = "Fingering table";
  root.appendChild(mapTitle);

  const legend = document.createElement("div");
  legend.className = "jp-cfg-legend";
  legend.innerHTML = "<b>T</b>=Thumb &nbsp;<b>I</b>=Index &nbsp;<b>M</b>=Middle &nbsp;<b>R</b>=Ring &nbsp;<b>P</b>=Pinky";
  root.appendChild(legend);

  const table = document.createElement("div");
  table.className = "jp-flick-table";

  const hdr = document.createElement("div");
  hdr.className = "jp-flick-row jp-flick-hdr";
  hdr.innerHTML = `<span>Fingers</span><span>·</span><span>←</span><span>↑</span><span>→</span><span>↓</span>`;
  table.appendChild(hdr);

  for (const r of rowMap) {
    const chars = ROWS[r.row];
    const row = document.createElement("div");
    row.className = "jp-flick-row";
    row.innerHTML =
      `<span class="jp-flick-key">${r.extend.join("+")}</span>` +
      chars.map(c => `<span>${show(c)}</span>`).join("");
    table.appendChild(row);
  }
  root.appendChild(table);

  const thTitle = document.createElement("div");
  thTitle.className = "jp-cfg-title"; thTitle.textContent = "Detection thresholds";
  root.appendChild(thTitle);
  root.appendChild(makeSlider("Flick distance", 0.02, 1.00, 0.01, FLICK_DIST, (v) => { FLICK_DIST = v; }));
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
