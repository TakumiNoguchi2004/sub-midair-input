// 絵文字入力: 指の運指で 描く/検索/クリア/削除 を判定。読み取りはフロント、
// 「描いた絵/テキスト → 絵文字候補」の検索だけ backend(emoji-search) に投げる。
//   ✏️ 描く   = 親指+人差し+中指の3本ピンチ (連続)
//   ✌️ 検索   = ピース(人差し+中指) を HOLD_MS キープ (単発)
//   ☝️ クリア = 人差し指のみ立てる(親+中+薬+小を折る) を HOLD_MS キープ (単発, キャンバスを消す)
//   ⌫ 削除   = 親+人を立てる(中+薬+小を折る) を HOLD_MS キープ (単発, 入力欄の1文字削除。他モードと同運指)
import { LM, PINCH_ON, PINCH_OFF, HOLD_MS, COOLDOWN_MS } from "../config.js";
import {
  dist, fingerUp, $, setGesture, setCameraState, drawPadCursor, setFlash,
  getPadCtx, clearPad, searchImage, applyLangCamState,
} from "../core.js";
import { foldedSet } from "../foldcore.js";

let penDown = false;                                   // 描画(連続)の状態
let held = null, holdStart = 0, armed = true, lastFire = 0;  // 単発の状態機械

// 手の姿勢を1つに分類: 'draw' | 'submit' | 'clear' | 'neutral'
function classify(lm) {
  const scale = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6;
  const idxUp = fingerUp(lm, LM.INDEX_TIP, LM.INDEX_PIP);
  const midUp = fingerUp(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP);
  const rngUp = fingerUp(lm, LM.RING_TIP, LM.RING_PIP);
  const pnkUp = fingerUp(lm, LM.PINKY_TIP, LM.PINKY_PIP);
  const dTI = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / scale;
  const dTM = dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_TIP]) / scale;
  const pinch3 = Math.max(dTI, dTM);
  const drawThresh = penDown ? PINCH_OFF : PINCH_ON;   // ヒステリシス
  if (pinch3 < drawThresh) return "draw";
  const fs = foldedSet(lm);
  if (fs === "MRP") return "delete";    // 親+人 立て / 中+薬+小 折り = 入力欄の1文字削除 (他モードと同運指)
  if (fs === "TMRP") return "clear";    // 人差し指のみ立て(親も折る) = キャンバスをクリア
  if (idxUp && midUp && !rngUp && !pnkUp) return "submit";
  return "neutral";
}

export default {
  id: "emoji",
  label: "絵文字",
  reset() { penDown = false; held = null; armed = true; },
  onFrame(ctx) {
    const { lm, cursor, now, langInfo } = ctx;
    // 言語切替は手が開いている時だけ(core側でゲート)なので、絵文字ジェスチャは常時処理する。
    let mode = classify(lm);

    drawPadCursor(cursor.x, cursor.y, mode);
    const pctx = getPadCtx();

    // ✏️ 描画 (連続): 3本ピンチの間だけペンを下ろす
    if (mode === "draw") {
      if (!penDown) { penDown = true; pctx.beginPath(); pctx.moveTo(cursor.x, cursor.y); }
      else { pctx.lineTo(cursor.x, cursor.y); pctx.stroke(); pctx.beginPath(); pctx.moveTo(cursor.x, cursor.y); }
    } else {
      penDown = false;
    }

    // ✌️ 検索 / ☝️ クリア (単発): 同じ姿勢を HOLD_MS キープで確定
    let charge = 0, fired = null;
    if (mode === "clear" || mode === "submit" || mode === "delete") {
      if (held !== mode) { held = mode; holdStart = now; }
      if (armed && now - lastFire > COOLDOWN_MS) {
        charge = Math.min(1, (now - holdStart) / HOLD_MS);
        if (charge >= 1) {
          armed = false; lastFire = now; held = null; charge = 0;
          if (mode === "clear") { clearPad(); setFlash("🧹 クリア", now + 500); fired = "clear"; }
          else if (mode === "delete") { const o = $("jpFlickOutput"); if (o) o.value = o.value.slice(0, -1); setFlash("⌫ 削除", now + 500); fired = "delete"; }
          else { searchImage("camera"); setFlash("🔍 検索", now + 500); fired = "submit"; }
        }
      }
    } else {
      held = null; armed = true;   // ニュートラル/描画で再武装
    }

    setGesture(
      mode === "draw" ? "✏️ 描画中" :
      mode === "clear" ? "☝️ クリア構え (キープ)" :
      mode === "submit" ? "✌️ 検索構え (キープ)" :
      mode === "delete" ? "⌫ 削除構え (キープ)" : "🖐 待機");
    if (langInfo.fired) setGesture(`🔁 ${langInfo.label}`);
    else if (langInfo.charge > 0) setGesture(`🔁 手の甲キープ ${Math.round(langInfo.charge * 100)}%`);

    if (applyLangCamState(langInfo)) {
      // 言語切替の発火/保持を優先表示
    } else if (fired === "clear") {
      setCameraState("detecting", "クリアしました", "次のジェスチャを待っています");
    } else if (fired === "delete") {
      setCameraState("detecting", "1文字削除しました", "次のジェスチャを待っています");
    } else if (fired === "submit") {
      setCameraState("searching", "検索実行中", "検索結果を待っています");
    } else if (mode === "draw") {
      setCameraState("drawing", "描画中", "3本ピンチを離すと描画を止めます");
    } else if (mode === "clear") {
      setCameraState("holding", "クリア保持中", `${Math.round(charge * 100)}%`, charge);
    } else if (mode === "delete") {
      setCameraState("holding", "削除保持中", `${Math.round(charge * 100)}%`, charge);
    } else if (mode === "submit") {
      setCameraState("holding", "検索保持中", `${Math.round(charge * 100)}%`, charge);
    } else {
      setCameraState("detecting", "検出中", "次のジェスチャを待っています");
    }
  },
};
