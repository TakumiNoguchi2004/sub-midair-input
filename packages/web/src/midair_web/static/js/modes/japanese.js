// 日本語入力 (新方式):
//   行未ロック時: グー / パー = レスト (入力待ち)
//   中間状態 (T/I/M のいずれかを伸展) + orientation(0°/90°) → 行選択
//   フリック(手を動かす) → 方向を即自動確定
//   グー(握る) → あ段を即確定 (濁点サイクルへは繋がらないシンプルな確定)
//   フリップ(指を伸ばしたまま中央で手首をひねる) → あ段を確定
//   確定直後、同じポーズのままもう一度フリップ → 濁点/半濁点サイクル
//   CommonGestures delete (グーを握ってひねる) → 1文字削除 / 全削除
import { LM } from "../config.js";
import {
  dist, fingerUp, $, clearPadCursor, drawPadCursor, setGesture, setCameraState, applyLangCamState,
} from "../core.js";

// --- 調整用しきい値 ---
let HOLD_MS    = 150;   // 行選択ポーズをこの ms 保持でロック
let FLICK_DIST = 0.07;  // 基準点からこの距離を超えたらフリック検知 / 戻り判定も同じ距離

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

// フリップ修飾用: 濁音・半濁音のみ (小文字変形は含めない)
const DAKUTEN_MAP = Object.fromEntries([
  ["か","が"],["き","ぎ"],["く","ぐ"],["け","げ"],["こ","ご"],
  ["さ","ざ"],["し","じ"],["す","ず"],["せ","ぜ"],["そ","ぞ"],
  ["た","だ"],["ち","ぢ"],["つ","づ"],["て","で"],["と","ど"],
  ["は","ば"],["ひ","び"],["ふ","ぶ"],["へ","べ"],["ほ","ぼ"],
]);
const HANDAKUTEN_MAP = Object.fromEntries([
  ["は","ぱ"],["ひ","ぴ"],["ふ","ぷ"],["へ","ぺ"],["ほ","ぽ"],
]);

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

// 小指折れ → 0グループ (あ/か/さ/た/な行)
// 小指伸び → 90グループ (は/ま/や/ら/わ行)
function orientGroup(hand) {
  return hand.fingers.pinky ? 90 : 0;
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
  resetFull();
  jpStatus("クリアしました");
}

// --- 状態機械 ---
let lockedRow   = null;   // ロック中の行名 (null = 未ロック)
let rowPending  = null;   // { row, since } 行選択のデバウンス候補
let flickStart  = null;   // フリック基準座標 (最後のパー位置 or ロック時位置)
let flickArmed  = true;   // true=フリック受付中, false=検知済み・基準に戻るまで待機
let lastOpenPos = null;   // 最後に isOpen だったときの palmPoint
let leftMargin  = false;  // 現在の確定サイクル中に一度でも FLICK_DIST 外に出たか (中央フリップ確定は移動しないため、これが true にならない限り再アームしない)
let centerBaseRoll = 0;   // あ段確定用フリップのロール基準 (中央保持中に追従)
let centerFlipping = false; // あ段確定用フリップの検出中フラグ

// --- JP専用削除ステートマシン ---
const DEL_QUICK_MS     = 1000;  // これ以内に戻したら1文字削除
const DEL_HOLD_MS      = 1000;  // これ以上保持したら全削除
const DEL_ROLL_FLIP    = 60;    // グー握った時点から roll がこれ以上変化したらフリップ (deg)
const DEL_ROLL_NEUTRAL = 30;    // この範囲内に戻ったら中立 (deg)
let _delCanFire   = false;
let _delFlipAt    = -1;
let _delBaseRoll  = 0;          // グー握った瞬間の roll ベースライン

function rollDelta(roll) {
  let d = roll - _delBaseRoll;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// 2つの角度(deg)の差を -180..180 に正規化して返す
function angleDelta(a, b) {
  let d = a - b;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function updateDelete(hand, now) {
  const roll = hand.orientation.roll;
  const delta = rollDelta(roll);
  const ret = (action, extra = {}) =>
    ({ action, phase: "idle", progress: 0, flippedMs: 0, isFlipped: Math.abs(delta) > DEL_ROLL_FLIP, ...extra });

  if (!hand.isFist) {
    _delCanFire = false; _delFlipAt = -1;
    return ret(null, { phase: "idle" });
  }

  // グーを握った直後にベースラインを記録
  if (!_delCanFire) {
    _delBaseRoll = roll;
    _delCanFire = true;
  }

  const isFlipped = Math.abs(delta) > DEL_ROLL_FLIP;
  const isNeutral = Math.abs(delta) < DEL_ROLL_NEUTRAL;

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

  return ret(null, { phase: _delCanFire ? "armed" : "idle" });
}

// --- 修飾ステートマシン (フリック後の濁点/半濁点サイクル) ---
const MOD_ROLL_FLIP    = 60;
const MOD_ROLL_NEUTRAL = 30;
let _modOrigChar   = null;   // フリック直後の元の文字
let _modState      = 0;      // 0=なし, 1=濁点, 2=半濁点
let _modBaseRoll   = 0;
let _modIsFlipping = false;

function cycleModifier() {
  if (!_modOrigChar) return;
  const o = $("jpFlickOutput");
  if (!o || !o.value) return;
  if      (_modState === 0 && DAKUTEN_MAP[_modOrigChar])    _modState = 1;
  else if (_modState === 1 && HANDAKUTEN_MAP[_modOrigChar]) _modState = 2;
  else _modState = 0;
  const newChar = _modState === 0 ? _modOrigChar
                : _modState === 1 ? DAKUTEN_MAP[_modOrigChar]
                : HANDAKUTEN_MAP[_modOrigChar];
  o.value = o.value.slice(0, -1) + newChar;
}

function updateModifier(roll) {
  if (!_modOrigChar) return;
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
  leftMargin = false; centerFlipping = false;
  _delCanFire = false; _delFlipAt = -1; _delBaseRoll = 0;
}

function resetFull() {
  resetRowState();
  resetModState();
}

function updateJapanese(hand, now) {
  const isRest = hand.isFist || hand.isOpen;
  const row    = isRest ? null : extendToRow(hand);

  // ---- ロック中 ----
  if (lockedRow) {
    // パー → キャンセル
    if (hand.isOpen) { resetFull(); jpStatus("キャンセル"); return; }

    // グー → あ段を確定してロック解除 (即確定。削除ジェスチャーとの衝突を避けるため
    // 濁点サイクルへは繋げない。濁点まで続けたい場合はフリップ方式を使う)
    if (hand.isFist) {
      const kana = ROWS[lockedRow][0];
      jpAppend(kana);
      jpStatus(`${lockedRow}行 中央 → ${kana}`);
      resetRowState();
      return;
    }

    // フリップ中(手首を大きくひねっている間)は指の見え方が乱れて誤った行に見えやすいため、
    // その間は行の再判定を凍結し、ロック中の行のまま扱う
    const rollBase = flickArmed ? centerBaseRoll : _modBaseRoll;
    const midFlip  = Math.abs(angleDelta(hand.orientation.roll, rollBase)) > MOD_ROLL_NEUTRAL;

    // ポーズが変わった → HOLD_MS で新しい行へ切り替え (レスト不要)
    // flickStart はパーからポーズへの遷移時のみ更新するためここでは変えない
    if (!midFlip && row !== lockedRow) {
      if (!row) { rowPending = null; jpStatus(`${lockedRow}行 (未割り当て)`); return; }
      if (!rowPending || rowPending.row !== row) {
        rowPending = { row, since: now };
      } else if (now - rowPending.since >= HOLD_MS) {
        lockedRow  = row;
        rowPending = null;
        flickArmed = false;   // 基準点へ戻るまでフリック判定を停止
        jpStatus(`${row}行: マージンに戻ってからフリック / グー or フリップであ段`);
      } else { jpStatus(`${row}行…`); }
      return;
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
      // グー(削除ジェスチャー)とは手の形で区別する: 指を伸ばしたままの捻りのみ濁点サイクルとして扱う
      if (!hand.isFist) updateModifier(hand.orientation.roll);
      // 中央フリップでの確定は手を動かさないため、一度 FLICK_DIST の外に出て
      // 戻ってくるまでは再アームしない (でないと濁点フリップの前に即再アームしてしまう)
      if (leftMargin && d < FLICK_DIST) {
        flickArmed = true; leftMargin = false; resetModState();
        centerBaseRoll = hand.orientation.roll; centerFlipping = false;
      }
      const modLabel = _modState === 1 ? " [濁]" : _modState === 2 ? " [半濁]" : "";
      jpStatus(`${lockedRow}行: 基準に戻して次フリック${modLabel} / フリップで濁点`);
      return;
    }

    // フリック受付中: 動かせば方向を即確定
    if (dir !== 0) {
      const kana = ROWS[lockedRow][dir];
      jpAppend(kana);
      jpStatus(`${lockedRow}行 ${DIR_LABELS[dir]} → ${kana}`);
      _modOrigChar = kana; _modState = 0;
      _modBaseRoll = hand.orientation.roll; _modIsFlipping = false;
      flickArmed = false;
      return;
    }

    // 中央 (未フリック): 手首をひねる(フリップ)であ段を確定
    {
      const roll = hand.orientation.roll;
      const rd = angleDelta(roll, centerBaseRoll);
      if (!centerFlipping && Math.abs(rd) > MOD_ROLL_FLIP) {
        centerFlipping = true;
        const kana = ROWS[lockedRow][0];
        jpAppend(kana);
        jpStatus(`${lockedRow}行 中央 → ${kana}`);
        // 確定に使ったこのフリップ自体を「1回目」として消費済み扱いにし、
        // 次にニュートラルへ戻ってからのフリップで濁点化させる
        _modOrigChar = kana; _modState = 0;
        _modBaseRoll = centerBaseRoll; _modIsFlipping = true;
        flickArmed = false;
        return;
      } else if (centerFlipping && Math.abs(rd) < MOD_ROLL_NEUTRAL) {
        centerFlipping = false; centerBaseRoll = roll;
      }
    }
    jpStatus(`${lockedRow}行: フリックで母音 / グー or フリップであ段`);
    return;
  }

  // ---- 非ロック ----
  if (isRest) {
    rowPending = null;
    if (hand.isOpen) lastOpenPos = hand.palmPoint;
    jpStatus(orientGroup(hand) === 90 ? "90°: は/ま/や/ら/わ行" : "0°: あ/か/さ/た/な行");
    return;
  }

  // ---- 中間状態: 行選択 ----
  if (!row) { rowPending = null; jpStatus("未割り当て"); return; }
  if (!rowPending || rowPending.row !== row) {
    rowPending = { row, since: now };
  } else if (now - rowPending.since >= HOLD_MS) {
    lockedRow  = row;
    flickStart = lastOpenPos ?? hand.palmPoint;
    rowPending = null; flickArmed = true; leftMargin = false;
    resetModState();
    centerBaseRoll = hand.orientation.roll; centerFlipping = false;
    jpStatus(`${row}行: フリックで母音 / グー or フリップであ段`);
  } else { jpStatus(`${row}行…`); }
}

export default {
  id: "japanese",
  label: "日本語",
  reset() { resetFull(); const dbg = $("orientDebug"); if (dbg) dbg.style.display = "none"; },
  onFrame(ctx) {
    const { now, langInfo, orient, hand, gesture, octx } = ctx;
    // JP専用削除: フリップ即戻し→1文字, 保持→全削除
    const del = updateDelete(hand, now);
    if (del.action === "delete1")        { jpFlickBackspace(); jpStatus("1文字削除"); }
    else if (del.action === "deleteAll") { jpFlickClear(); }
    if (hand.isFist) {
      if (del.isFlipped && octx) {
        octx.save();
        octx.fillStyle = "rgba(255,60,60,0.30)";
        octx.fillRect(0, 0, octx.canvas.width, octx.canvas.height);
        octx.restore();
      }
      const roll = hand.orientation.roll;
      if (del.phase === "flipped") {
        const remaining = Math.max(0, Math.round(DEL_QUICK_MS - del.flippedMs));
        jpStatus(`roll:${roll.toFixed(0)}° フリップ検出 / 戻す→1文字(${remaining}ms) / 保持→全削除(${Math.round(del.progress * 100)}%)`);
      } else if (del.phase === "armed") {
        jpStatus(`roll:${roll.toFixed(0)}° グー検出 / 傾けて削除`);
      } else {
        jpStatus(`roll:${roll.toFixed(0)}° グー`);
      }
    }
    drawPadCursor(hand.indexTip.x, hand.indexTip.y, "point");
    // デバッグ: 手に追従するローカル座標軸をoverlayに描画
    if (octx) {
      const lm = hand.lm;
      const o  = hand.orientation;
      const W  = octx.canvas.width, H = octx.canvas.height;

      // 手のひら中心 (canvas座標)
      const cx = (lm[LM.WRIST].x + lm[LM.INDEX_MCP].x + lm[LM.PINKY_MCP].x) / 3 * W;
      const cy = (lm[LM.WRIST].y + lm[LM.INDEX_MCP].y + lm[LM.PINKY_MCP].y) / 3 * H;

      // hand-state.js で計算済みのボディ固定フレームを再利用
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

      // 参照ランドマークを色付き点で表示
      const dot = (g, idx, color) => {
        const x = lm[idx].x * W, y = lm[idx].y * H;
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2);
        g.fillStyle = color; g.fill();
        g.strokeStyle = "#000"; g.lineWidth = 1.5; g.stroke();
      };
      octx.save();
      // fz (Z軸=青): WRIST → MIDDLE_MCP
      dot(octx, LM.WRIST,      "#4488ff");
      dot(octx, LM.MIDDLE_MCP, "#4488ff");
      // fx (X軸=赤): INDEX_MCP ↔ PINKY_MCP
      dot(octx, LM.INDEX_MCP,  "#ff4444");
      dot(octx, LM.PINKY_MCP,  "#ff4444");

      // 3Dベクトルをcanvas 2Dに投影 (x,yのみ使用、orthographic)
      // 赤: X軸 (横方向)
      drawArrow(octx, cx, cy, cx + fx[0]*L, cy + fx[1]*L, "#ff4444");
      drawText(octx, "X", cx + fx[0]*L, cy + fx[1]*L - 8, "#ff6666");
      // 緑: Y軸 (手のひら法線)
      drawArrow(octx, cx, cy, cx + fy[0]*L, cy + fy[1]*L, "#00ff44");
      drawText(octx, "Y", cx + fy[0]*L, cy + fy[1]*L - 8, "#00ff44");
      // 青: Z軸 (指方向)
      drawArrow(octx, cx, cy, cx + fz[0]*L, cy + fz[1]*L, "#4488ff");
      drawText(octx, "Z", cx + fz[0]*L, cy + fz[1]*L - 8, "#88aaff");

      // 角度値をpalm下に縦並び (色 = 対応する回転軸の色)
      // Roll=Z軸(青)周り, Pitch=X軸(赤)周り, Yaw=Y軸(緑)周り
      const lx = cx, ly = cy + L + 16;
      drawText(octx, `R:${o.roll.toFixed(0)}°`,   lx, ly,      "#4488ff"); // Z=青
      drawText(octx, `P:${o.pitch.toFixed(0)}°`,  lx, ly + 14, "#ff4444"); // X=赤
      drawText(octx, `Y:${o.yaw.toFixed(0)}°`,    lx, ly + 28, "#00ff44"); // Y=緑
      drawText(octx, `grp:${orientGroup(hand)}°`, lx, ly + 42, "#ffff00");

      octx.restore();
    }
    updateJapanese(hand, now);
    // flickStart (基準点) の可視化: マージン円 + X字仕切り + 現在位置への線
    if (lockedRow && flickStart) {
      const el = $("padCursor");
      if (el) {
        const g = el.getContext("2d");
        const px = flickStart.x * el.width,  py = flickStart.y * el.height;
        const cx = hand.palmPoint.x * el.width, cy = hand.palmPoint.y * el.height;
        const r  = FLICK_DIST * el.width;
        const ready = flickArmed;
        const rimColor = ready ? "#00cc44" : "#ff8800";

        g.save();

        // 現在位置 → 基準点への線
        g.strokeStyle = "rgba(255,255,255,0.3)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();

        // X字仕切り (マージン外まで伸ばす)
        const ext = r * 2;
        g.strokeStyle = rimColor;
        g.lineWidth = 1;
        g.globalAlpha = 0.4;
        g.beginPath();
        g.moveTo(px - ext, py - ext); g.lineTo(px + ext, py + ext);
        g.moveTo(px + ext, py - ext); g.lineTo(px - ext, py + ext);
        g.stroke();
        g.globalAlpha = 1.0;

        // マージン円
        g.strokeStyle = rimColor;
        g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.stroke();

        // 基準点ドット
        g.fillStyle = rimColor;
        g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill();

        // 修飾状態バッジ (゛/゜) - フリック後のモディファイア状態
        if (_modState > 0) {
          const mark  = _modState === 1 ? "゛" : "゜";
          const color = _modState === 1 ? "#5bff8c" : "#5b8cff";
          g.font = "bold 36px system-ui";
          g.textAlign = "center";
          g.textBaseline = "bottom";
          g.shadowColor = "rgba(0,0,0,0.9)";
          g.shadowBlur = 8;
          g.fillStyle = color;
          g.fillText(mark, px, py - r - 4);
          g.shadowBlur = 0;
        }

        g.restore();
      }
    }
    setGesture(langInfo.fired ? `-> ${langInfo.label}` : "日本語");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "日本語入力モード", "指を伸ばして行選択 / フリックで方向 or グー or フリップであ段");
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

  const legend = document.createElement("div");
  legend.className = "jp-cfg-legend";
  legend.innerHTML = "<b>T</b>=親指 / <b>I</b>=人差し指 / <b>M</b>=中指 / <b>P</b>=小指";
  root.appendChild(legend);

  const table = document.createElement("div");
  table.className = "jp-cfg-table";
  for (const r of rowMap) {
    const fingers = [...r.extend, ...(r.orient === 90 ? ["P"] : [])];
    const item = document.createElement("div");
    item.className = "jp-cfg-pair";
    item.innerHTML = `<b>${r.row}行</b><span>${fingers.join(" + ")}</span>`;
    table.appendChild(item);
  }
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
