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

// ボディ固定フレームをカメラ座標で計算
// fz: 手首→中指MCP (指方向)
// fx: 小指→人差し指 方向をfzに直交化 (左手は符号反転)
// fy: fz × fx (手のひら法線)
export function computeBodyFrame(lm, handedLabel) {
  const w = lm[LM.WRIST], m = lm[LM.MIDDLE_MCP];
  const ip = lm[LM.INDEX_MCP], pp = lm[LM.PINKY_MCP];
  const norm3 = v => { const l = Math.hypot(...v) || 1e-9; return v.map(x => x / l); };
  const dot3  = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const fz = norm3([m.x-w.x, m.y-w.y, (m.z??0)-(w.z??0)]);
  let fx = [ip.x-pp.x, ip.y-pp.y, (ip.z??0)-(pp.z??0)];
  if (handedLabel === "Left") fx = fx.map(x => -x);
  const d = dot3(fx, fz);
  fx = norm3([fx[0]-d*fz[0], fx[1]-d*fz[1], fx[2]-d*fz[2]]);
  const fy = norm3(cross3(fz, fx));
  return { fx, fy, fz };
}

// 基準姿勢からの相対回転を ZXY オイラー角で抽出
// 基準姿勢: 指上向き(fz=[0,-1,0]), 手のひらカメラ向き(fy=[0,0,+1]), fx=[+1,0,0]
// R_ref^T の作用: v_rel = [v[0], v[2], -v[1]]
// → 基準姿勢で roll=pitch=yaw=0、特異点は基準から約90°離れた特殊姿勢のみ
function computeOrientationFromFrame({ fx, fy, fz }) {
  const norm  = deg => { let d = deg % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
  const clamp = x => Math.max(-1, Math.min(1, x));
  const pitch = Math.asin(clamp(fy[1])) * RAD2DEG;
  const roll  = norm(Math.atan2(-fy[0], fy[2]) * RAD2DEG);
  const yaw   = norm(Math.atan2(-fx[1], -fz[1]) * RAD2DEG);
  return { roll, pitch, yaw };
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

    // Layer 1 + 2: ボディ固定フレームとそこから抽出したオイラー角
    this.bodyFrame = computeBodyFrame(lm, handedLabel);
    const { roll, pitch, yaw } = computeOrientationFromFrame(this.bodyFrame);
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

  // palm/back判定用: 手のひら法線fyのカメラz成分で実際の向きを検出
  // -fy[2] > 0 → palmがカメラ向き("palm"), < 0 → 背面向き("back")
  // pitch < 30° (手が倒れている) なら不感帯にして誤検知を防ぐ
  sinRoll() {
    const { pitch } = this.orientation;
    // 基準姿勢(pitch=0)付近でフル有効、大きく傾くと不感帯 (|pitch|>60° でゼロ)
    const gate = Math.max(0, Math.min(1, 1 - Math.abs(pitch) / 60));
    return -this.bodyFrame.fy[2] * gate;
  }
}
