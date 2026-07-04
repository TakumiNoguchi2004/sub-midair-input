// HandState: 1フレームの手ランドマークから手の状態を計算する。
//
// 座標系: 右手系, x+=右, y+=上, z+=カメラ手前
// 基準ポーズ: 腕をカメラ方向へ伸ばす(前腕軸=+z),
//            手のひらを床に向ける(palm normal=-y), 指を伸ばす(roll=0)
//
// 2層構造:
//   Layer 1: 連続値 — orientation.{roll,pitch,yaw}, fingers.*, cursor, palmPoint
//   Layer 2: 離散値 — orientation.{rollQ,pitchQ,yawQ}(90°量子化), isFist, isOpen
import { LM, EMA, EDGE_MARGIN } from "../config.js";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const quantize90 = (deg) => Math.round(deg / 90) * 90;

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 指先が PIP より手首から遠ければ「伸びている」
function fingerExtended(lm, tip, pip) {
  return dist(lm[tip], lm[LM.WRIST]) > dist(lm[pip], lm[LM.WRIST]) * 1.05;
}

// 親指: 先端が中指付け根から遠ければ「伸びている」(threshold は正規化距離)
function thumbExtended(lm, threshold = 0.6) {
  const scale = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6;
  return dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_MCP]) / scale >= threshold;
}

// roll: 手のひら向き。基準=手のひら下(0°), 手のひらカメラ向き=+90°/-90°, 手のひら上≈±90°
// 手首→人差し付け根 と 手首→小指付け根 の2D外積から符号付きsin値→度変換。
function computeRoll(lm, handedLabel) {
  const w = lm[LM.WRIST], i = lm[LM.INDEX_MCP], p = lm[LM.PINKY_MCP];
  const v1x = i.x - w.x, v1y = i.y - w.y;
  const v2x = p.x - w.x, v2y = p.y - w.y;
  const cross = v1x * v2y - v1y * v2x;
  const norm = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) + 1e-9;
  let s = -cross / norm;
  if (handedLabel === "Left") s = -s;
  return Math.asin(Math.max(-1, Math.min(1, s))) * RAD2DEG;
}

// pitch: 手首→中指付け根ベクトルの仰角 (上向き=正)
// 画像y軸(下正)を反転してワールドy+(上)に揃える。
function computePitch(lm) {
  const w = lm[LM.WRIST], m = lm[LM.MIDDLE_MCP];
  const dy = -(m.y - w.y);
  const dx = m.x - w.x;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return 0;
  return Math.asin(Math.max(-1, Math.min(1, dy / len))) * RAD2DEG;
}

// yaw: 手首→中指付け根ベクトルの左右偏向 (右向き=正)
function computeYaw(lm) {
  const w = lm[LM.WRIST], m = lm[LM.MIDDLE_MCP];
  const dx = m.x - w.x;
  const dy = -(m.y - w.y);
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return 0;
  return Math.asin(Math.max(-1, Math.min(1, dx / len))) * RAD2DEG;
}

// 画角端のリマップ: 端(EDGE_MARGIN)を除いた内側を [0,1] にリマップしてクランプ
function remapEdge(v) {
  const t = (v - EDGE_MARGIN) / (1 - 2 * EDGE_MARGIN);
  return Math.max(0, Math.min(1, t));
}

// EMA平滑化済みペン先座標 (人差し+中指の中点, selfie左右反転, canvas px 単位)
export function computeCursor(lm, prev, width, height) {
  const ix = (lm[LM.INDEX_TIP].x + lm[LM.MIDDLE_TIP].x) / 2;
  const iy = (lm[LM.INDEX_TIP].y + lm[LM.MIDDLE_TIP].y) / 2;
  const cx = (1 - remapEdge(ix)) * width;
  const cy = remapEdge(iy) * height;
  if (!prev) return { x: cx, y: cy };
  return { x: prev.x + (cx - prev.x) * EMA, y: prev.y + (cy - prev.y) * EMA };
}

// 手のひら代表点: 手首+人差し/小指付け根の重心 (selfie: x方向反転済み)
export function computePalmPoint(lm) {
  const w = lm[LM.WRIST], i = lm[LM.INDEX_MCP], p = lm[LM.PINKY_MCP];
  return { x: 1 - (w.x + i.x + p.x) / 3, y: (w.y + i.y + p.y) / 3 };
}

export class HandState {
  /**
   * @param {Array}       lm          MediaPipe 21点ランドマーク
   * @param {string}      handedLabel "Left"|"Right"
   * @param {object|null} prevCursor  前フレームのカーソル {x,y} (EMA用, null=初回)
   * @param {number}      canvasWidth  pad 幅 (px)
   * @param {number}      canvasHeight pad 高さ (px)
   */
  constructor(lm, handedLabel, prevCursor, canvasWidth, canvasHeight) {
    this.lm = lm;

    // Layer 1: 指の伸展 (bool)
    this.fingers = {
      thumb:  thumbExtended(lm),
      index:  fingerExtended(lm, LM.INDEX_TIP,    LM.INDEX_PIP),
      middle: fingerExtended(lm, LM.MIDDLE_TIP,   LM.MIDDLE_PIP),
      ring:   fingerExtended(lm, LM.RING_TIP,     LM.RING_PIP),
      pinky:  fingerExtended(lm, LM.PINKY_TIP,    LM.PINKY_PIP),
    };

    // Layer 1: 位置 (px / 正規化座標)
    this.cursor    = computeCursor(lm, prevCursor, canvasWidth, canvasHeight);
    this.palmPoint = computePalmPoint(lm);
    // 人差し指先端のcanvas座標 (EMAなし。単指描画用)
    this.indexTip  = {
      x: (1 - remapEdge(lm[LM.INDEX_TIP].x)) * canvasWidth,
      y: remapEdge(lm[LM.INDEX_TIP].y) * canvasHeight,
    };

    // Layer 1 + 2: 姿勢角 (degrees) と 90°量子化
    const roll  = computeRoll(lm, handedLabel);
    const pitch = computePitch(lm);
    const yaw   = computeYaw(lm);
    this.orientation = {
      roll,  pitch,  yaw,
      rollQ:  quantize90(roll),
      pitchQ: quantize90(pitch),
      yawQ:   quantize90(yaw),
    };

    // Layer 2: 複合判定
    const f = this.fingers;
    this.isFist = !f.thumb && !f.index && !f.middle && !f.ring && !f.pinky;
    this.isOpen = f.index && f.middle && f.ring && f.pinky;  // 4本伸展 (親指は問わない)
  }

  /** ランドマーク2点間の2D距離 */
  dist(aIdx, bIdx) { return dist(this.lm[aIdx], this.lm[bIdx]); }

  // roll を sin 空間に戻す (既存 ORIENT_DEADZONE との比較に使う)
  sinRoll() { return Math.sin(this.orientation.roll * DEG2RAD); }
}
