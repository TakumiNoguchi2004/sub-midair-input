// 日本語入力 (新方式):
//   行未ロック時: グー / パー = レスト (入力待ち)
//   中間状態 (T/I/M のいずれかを伸展) + orientation(0°/90°) → 行選択
//   フリック(手を動かす) → 方向を即自動確定
//   グー(握る) → あ段を即確定 (濁点サイクルへは繋がらないシンプルな確定)
//   フリップ(指を伸ばしたまま中央で手首をひねる) → あ段を確定 (濁点があれば素の文字を経由せず濁点形から開始)
//   確定直後、同じポーズのままもう一度フリップ → 濁点/半濁点/元 をさらにサイクル
//   フリップ中(ロール角がニュートラルから外れている間)は姿勢判定(グー/パー/行)を凍結し、
//   指の見え方が乱れても誤爆しないようにする
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
  "、": ["　", "、", "。", "？", "！"],
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

// フリップ修飾用マップ (サイクル順: 小文字 → 濁点 → 半濁点 → なし)
const KOGAKI_MAP = Object.fromEntries([
  ["あ","ぁ"],["い","ぃ"],["う","ぅ"],["え","ぇ"],["お","ぉ"],
  ["つ","っ"],
  ["や","ゃ"],["ゆ","ゅ"],["よ","ょ"],
  ["わ","ゎ"],
]);
const DAKUTEN_MAP = Object.fromEntries([
  ["か","が"],["き","ぎ"],["く","ぐ"],["け","げ"],["こ","ご"],
  ["さ","ざ"],["し","じ"],["す","ず"],["せ","ぜ"],["そ","ぞ"],
  ["た","だ"],["ち","ぢ"],["つ","づ"],["て","で"],["と","ど"],
  ["は","ば"],["ひ","び"],["ふ","ぶ"],["へ","べ"],["ほ","ぼ"],
]);
const HANDAKUTEN_MAP = Object.fromEntries([
  ["は","ぱ"],["ひ","ぴ"],["ふ","ぷ"],["へ","ぺ"],["ほ","ぽ"],
]);

// --- 運指テーブル: extend(T/I/M/P の組み合わせ) → 行 ---
export const DEFAULT_ROW_MAP = [
  { row: "あ", extend: ["T"]                },
  { row: "か", extend: ["I"]                },
  { row: "さ", extend: ["T", "I"]           },
  { row: "た", extend: ["I", "M"]           },
  { row: "な", extend: ["T", "I", "M"]      },
  { row: "は", extend: ["T", "P"]           },
  { row: "ま", extend: ["I", "P"]           },
  { row: "や", extend: ["T", "I", "P"]      },
  { row: "ら", extend: ["I", "M", "P"]      },
  { row: "わ", extend: ["T", "I", "M", "P"] },
  { row: "、", extend: ["P"]               },
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
    // 水平↔垂直の切り替え: 優勢比が HYST_RATIO を超えるまで前の方向を維持
    const ratio = rawHoriz
      ? Math.abs(dx) / (Math.abs(dy) || 1e-9)
      : Math.abs(dy) / (Math.abs(dx) || 1e-9);
    if (ratio < HYST_RATIO) return prevDir;
  }
  return rawDir;
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
let _lastDir    = 0;      // 直前に確定したフリック方向 (マージン外連続入力のヒステリシス用)

// --- JP専用削除ステートマシン ---
const DEL_QUICK_MS     = 1000;  // これ以内に戻したら1文字削除
const DEL_HOLD_MS      = 1000;  // これ以上保持したら全削除
const DEL_ROLL_FLIP    = 90;    // roll がこれ以上変化したらフリップ (deg)
const DEL_ROLL_NEUTRAL = 30;    // この範囲内に戻ったら中立 (deg)
let _delCanFire   = false;
let _delFlipAt    = -1;

// --- 変換ステートマシン ---
let _convMode     = false;
let _convSegs     = [];      // [{reading, candidates, sel}]
let _convSegIdx   = 0;
let _convOrigText = "";      // 変換前テキスト (キャンセル用)
let _convLoading  = false;

const CONV_CAND_SHOW = 8;

function _updateConvPanel() {
  const panel = $("convPanel");
  if (!panel) return;
  if (!_convMode) { panel.style.display = "none"; return; }
  panel.style.display = "";

  // セグメントバー: 全セグメントを並べ、アクティブを強調
  const segBar = $("convSegBar");
  if (segBar) {
    segBar.innerHTML = "";
    _convSegs.forEach((s, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "conv-sep"; sep.textContent = "｜";
        segBar.appendChild(sep);
      }
      const el = document.createElement("span");
      el.className = i === _convSegIdx ? "conv-seg active" : "conv-seg";
      el.textContent = s.candidates.length ? s.candidates[s.sel] : s.reading;
      const idx = i;
      el.addEventListener("click", () => { _convSegIdx = idx; _updateConvPanel(); });
      segBar.appendChild(el);
    });
  }

  // 候補リスト: アクティブセグメントの候補を最大 CONV_CAND_SHOW 件表示
  const candList = $("convCandList");
  if (candList) {
    candList.innerHTML = "";
    const seg = _convSegs[_convSegIdx];
    if (seg) {
      seg.candidates.slice(0, CONV_CAND_SHOW).forEach((c, i) => {
        const btn = document.createElement("button");
        btn.className = i === seg.sel ? "conv-cand active" : "conv-cand";
        btn.textContent = c;
        const selIdx = i;
        btn.addEventListener("click", () => {
          seg.sel = selIdx;
          _convDisplay();
          _updateConvPanel();
        });
        candList.appendChild(btn);
      });
    }
  }
}

function _convDisplay() {
  const o = $("jpFlickOutput");
  if (o) o.value = _convSegs.map(s => s.candidates.length ? s.candidates[s.sel] : s.reading).join("");
  _updateConvPanel();
}

async function _startConversion() {
  if (_convLoading) return;
  const o = $("jpFlickOutput");
  if (!o || !o.value) { jpAppend("　"); jpStatus("全角スペース"); return; }
  _convOrigText = o.value;
  _convLoading = true;
  jpStatus("変換中...");
  try {
    const r = await fetch("/api/convert/kanji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: _convOrigText }),
    });
    const d = await r.json();
    _convMode   = true;
    _convSegs   = d.segments.map(s => ({ ...s }));
    _convSegIdx = 0;
    _convDisplay();  // _updateConvPanel も内部で呼ばれる
    const seg = _convSegs[0];
    jpStatus(`変換[1/${_convSegs.length}]: ${seg?.candidates[seg.sel] || "?"} / わフリップ=次 / 、フリップ=前 / グー=確定`);
  } catch (e) {
    jpStatus(`変換エラー: ${e}`);
    _convOrigText = "";
  } finally {
    _convLoading = false;
  }
}

function _convNext() {
  if (!_convMode || !_convSegs.length) return;
  const seg = _convSegs[_convSegIdx];
  if (!seg || !seg.candidates.length) return;
  seg.sel = (seg.sel + 1) % seg.candidates.length;
  _convDisplay();
  jpStatus(`変換[${_convSegIdx+1}/${_convSegs.length}]: ${seg.candidates[seg.sel]}`);
}

function _convPrev() {
  if (!_convMode || !_convSegs.length) return;
  const seg = _convSegs[_convSegIdx];
  if (!seg || !seg.candidates.length) return;
  seg.sel = (seg.sel - 1 + seg.candidates.length) % seg.candidates.length;
  _convDisplay();
  jpStatus(`変換[${_convSegIdx+1}/${_convSegs.length}]: ${seg.candidates[seg.sel]}`);
}

function _convConfirm() {
  if (!_convMode) return;
  _convMode = false; _convSegs = []; _convSegIdx = 0; _convOrigText = "";
  _updateConvPanel();
  jpStatus("変換確定");
}

function _convCancel() {
  const o = $("jpFlickOutput");
  if (_convMode && o) o.value = _convOrigText;
  _convMode = false; _convSegs = []; _convSegIdx = 0; _convOrigText = "";
  _updateConvPanel();
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

// --- 修飾ステートマシン (フリック後の濁点/半濁点サイクル) ---
const MOD_ROLL_FLIP    = 60;
const MOD_ROLL_NEUTRAL = 30;
let _modOrigChar   = null;   // フリック直後の元の文字
let _modState      = 0;      // 0=なし, 1=小文字, 2=濁点, 3=半濁点
let _modBaseRoll   = 0;
let _modIsFlipping = false;

function cycleModifier() {
  if (!_modOrigChar) return;
  const o = $("jpFlickOutput");
  if (!o || !o.value) return;
  if (_modState === 0) {
    if      (KOGAKI_MAP[_modOrigChar])     _modState = 1;
    else if (DAKUTEN_MAP[_modOrigChar])    _modState = 2;
    else if (HANDAKUTEN_MAP[_modOrigChar]) _modState = 3;
    else return;
  } else if (_modState === 1) {
    if      (DAKUTEN_MAP[_modOrigChar])    _modState = 2;
    else if (HANDAKUTEN_MAP[_modOrigChar]) _modState = 3;
    else _modState = 0;
  } else if (_modState === 2) {
    if (HANDAKUTEN_MAP[_modOrigChar]) _modState = 3;
    else _modState = 0;
  } else {
    _modState = 0;
  }
  const newChar = _modState === 0 ? _modOrigChar
                : _modState === 1 ? KOGAKI_MAP[_modOrigChar]
                : _modState === 2 ? DAKUTEN_MAP[_modOrigChar]
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
  leftMargin = false; centerFlipping = false; _lastDir = 0;
  _delCanFire = false; _delFlipAt = -1;
}

function resetFull() {
  resetRowState();
  resetModState();
  _convMode = false; _convSegs = []; _convSegIdx = 0; _convOrigText = "";
}

function updateJapanese(hand, now) {
  const isRest = hand.isFist || hand.isOpen;
  const row    = isRest ? null : extendToRow(hand);

  // ---- ロック中 ----
  if (lockedRow) {
    // フリップ中(手首を大きくひねっている間)は指の見え方が乱れて別の姿勢(グー/パー/別行)に
    // 誤検出されやすいため、その間は姿勢による判定を全て凍結し、ロック中の行のまま扱う
    // (は行などフリップの回転量が大きい行で特に指が隠れやすいための安定化)
    const rollBase = flickArmed ? centerBaseRoll : _modBaseRoll;
    const midFlip  = Math.abs(angleDelta(hand.orientation.roll, rollBase)) > MOD_ROLL_NEUTRAL;

    if (!midFlip) {
      // パー → キャンセル (変換中ならテキスト復元)
      if (hand.isOpen) { _convCancel(); resetFull(); jpStatus("キャンセル"); return; }

      // グー → あ段を確定してロック解除 (即確定。削除ジェスチャーとの衝突を避けるため
      // 濁点サイクルへは繋げない。濁点まで続けたい場合はフリップ方式を使う)
      // ただし、このロック中に既にフリック/フリップで何か確定済み(flickArmed=false)の場合は
      // 「あ段」を二重に追加せず、単に終了(ロック解除)だけ行う
      if (hand.isFist) {
        if (_convMode) { _convConfirm(); resetRowState(); return; }
        if (flickArmed) {
          const kana = ROWS[lockedRow][0];
          jpAppend(kana);
          jpStatus(`${lockedRow}行 中央 → ${kana}`);
        } else {
          jpStatus(`${lockedRow}行 終了`);
        }
        resetRowState();
        return;
      }

      // ポーズが変わった → HOLD_MS で新しい行へ切り替え (レスト不要)
      // flickStart はパーからポーズへの遷移時のみ更新するためここでは変えない
      if (row !== lockedRow) {
        if (!row) { rowPending = null; jpStatus(`${lockedRow}行 (未割り当て)`); return; }
        if (!rowPending || rowPending.row !== row) {
          rowPending = { row, since: now };
        } else if (now - rowPending.since >= HOLD_MS) {
          if (_convMode) _convConfirm();
          lockedRow  = row;
          rowPending = null;
          flickArmed = false;   // 基準点へ戻るまでフリック判定を停止
          jpStatus(`${row}行: マージンに戻ってからフリック / グー or フリップであ段`);
        } else { jpStatus(`${row}行…`); }
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
          if (_convMode) _convConfirm();
          const kana = ROWS[lockedRow][hystDir];
          jpAppend(kana);
          jpStatus(`${lockedRow}行 ${DIR_LABELS[hystDir]} → ${kana}`);
          _modOrigChar = kana; _modState = 0;
          _modBaseRoll = hand.orientation.roll; _modIsFlipping = false;
          _lastDir = hystDir;
        }
      }
      // グー(削除ジェスチャー)とは手の形で区別する: 指を伸ばしたままの捻りのみ濁点サイクルとして扱う
      if (!hand.isFist) updateModifier(hand.orientation.roll);
      // 中央フリップでの確定は手を動かさないため、一度 FLICK_DIST の外に出て
      // 戻ってくるまでは再アームしない (でないと濁点フリップの前に即再アームしてしまう)
      if (leftMargin && d < FLICK_DIST) {
        flickArmed = true; leftMargin = false; resetModState(); _lastDir = 0;
        centerBaseRoll = hand.orientation.roll; centerFlipping = false;
      }
      if (_convMode) {
        const seg = _convSegs[_convSegIdx];
        jpStatus(`変換[${_convSegIdx+1}/${_convSegs.length}]: ${seg?.candidates[seg.sel] || "?"} / わフリップ=次 / 、フリップ=前 / グー=確定`);
      } else {
        const modLabel = _modState === 1 ? " [小]" : _modState === 2 ? " [濁]" : _modState === 3 ? " [半濁]" : "";
        jpStatus(`${lockedRow}行: 基準に戻して次フリック${modLabel} / フリップで濁点`);
      }
      return;
    }

    // フリック受付中: 動かせば方向を即確定
    if (dir !== 0) {
      if (_convMode) _convConfirm();
      const kana = ROWS[lockedRow][dir];
      jpAppend(kana);
      jpStatus(`${lockedRow}行 ${DIR_LABELS[dir]} → ${kana}`);
      _modOrigChar = kana; _modState = 0;
      _modBaseRoll = hand.orientation.roll; _modIsFlipping = false;
      _lastDir = dir;
      flickArmed = false;
      return;
    }

    // 中央 (未フリック): 手首をひねる(フリップ)であ段を確定
    {
      const roll = hand.orientation.roll;
      const rd = angleDelta(roll, centerBaseRoll);
      if (!centerFlipping && Math.abs(rd) > MOD_ROLL_FLIP) {
        centerFlipping = true;
        if (lockedRow === "わ") {
          // わ行フリップ = 変換開始 (normal) / 次候補 (conv中)
          if (_convMode) { _convNext(); }
          else {
            const o = $("jpFlickOutput");
            if (o && o.value) { _startConversion(); }
            else { jpAppend("　"); jpStatus("全角スペース"); }
          }
          flickArmed = false; return;
        }
        if (_convMode && lockedRow === "、") { _convPrev(); flickArmed = false; return; }
        if (_convMode) _convConfirm();
        const base = ROWS[lockedRow][0];
        // 濁点があれば素の文字を経由せず、確定と同時に濁点形から始める
        const hasDaku = !!DAKUTEN_MAP[base];
        const kana = hasDaku ? DAKUTEN_MAP[base] : base;
        jpAppend(kana);
        jpStatus(`${lockedRow}行 中央 → ${kana}`);
        // 確定に使ったこのフリップ自体を「1回目」として消費済み扱いにし、
        // 次にニュートラルへ戻ってからのフリップでさらにサイクルさせる
        _modOrigChar = base; _modState = hasDaku ? 2 : 0;
        _modBaseRoll = centerBaseRoll; _modIsFlipping = true;
        flickArmed = false;
        return;
      } else if (centerFlipping && Math.abs(rd) < MOD_ROLL_NEUTRAL) {
        centerFlipping = false; centerBaseRoll = roll;
      }
    }
    if (_convMode) {
      const seg = _convSegs[_convSegIdx];
      jpStatus(`変換[${_convSegIdx+1}/${_convSegs.length}]: ${seg?.candidates[seg.sel] || "?"} / わフリップ=次 / 、フリップ=前 / グー=確定`);
    } else if (lockedRow === "わ") {
      jpStatus(`わ行: フリックで母音 / グー=スペース / フリップ=変換開始`);
    } else {
      jpStatus(`${lockedRow}行: フリックで母音 / グー or フリップであ段`);
    }
    return;
  }

  // ---- 非ロック ----
  if (isRest) {
    rowPending = null;
    if (hand.isOpen) lastOpenPos = hand.palmPoint;
    jpStatus(hand.fingers.pinky ? "P: は/ま/や/ら/わ/句行" : "あ/か/さ/た/な行");
    return;
  }

  // ---- 中間状態: 行選択 ----
  if (!row) { rowPending = null; jpStatus("未割り当て"); return; }
  if (!rowPending || rowPending.row !== row) {
    rowPending = { row, since: now };
  } else if (now - rowPending.since >= HOLD_MS) {
    if (_convMode) _convConfirm();
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
    // (行ロック中は centerBaseRoll = このセッションの真のニュートラル角度をヒントとして渡す)
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
    { const _pc = $("padCursor");
      drawPadCursor(hand.palmPoint.x * (_pc?.width ?? 1), hand.palmPoint.y * (_pc?.height ?? 1), "point"); }
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
      drawText(octx, `key:${extendedKey(hand)||"–"}`, lx, ly + 42, "#ffff00");

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
          const mark  = _modState === 2 ? "゛" : "゜";
          const color = _modState === 2 ? "#5bff8c" : "#5b8cff";
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
  mapTitle.className = "jp-cfg-title"; mapTitle.textContent = "運指表";
  root.appendChild(mapTitle);

  const legend = document.createElement("div");
  legend.className = "jp-cfg-legend";
  legend.innerHTML = "<b>T</b>=親指 <b>I</b>=人差 <b>M</b>=中 <b>P</b>=小指 &nbsp;／&nbsp; 列: ・(中央) ← ↑ → ↓";
  root.appendChild(legend);

  // グリッド表: 指の組み合わせ | グー | ← | ↑ | → | ↓
  const sk = (k) => (!k ? "—" : (k === " " || k === "　") ? "SP" : k);
  const table = document.createElement("div");
  table.className = "jp-flick-table";

  // ヘッダ行
  const hdr = document.createElement("div");
  hdr.className = "jp-flick-row jp-flick-hdr";
  hdr.innerHTML = `<span>指</span><span>・</span><span>←</span><span>↑</span><span>→</span><span>↓</span>`;
  table.appendChild(hdr);

  for (const r of rowMap) {
    const kana = ROWS[r.row];
    const row = document.createElement("div");
    row.className = "jp-flick-row";
    row.innerHTML =
      `<span class="jp-flick-key">${r.extend.join("+")}</span>` +
      kana.map(k => `<span>${sk(k)}</span>`).join("");
    table.appendChild(row);
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
