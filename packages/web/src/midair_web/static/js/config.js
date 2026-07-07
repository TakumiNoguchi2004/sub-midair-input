// 設定 (コア): 各言語に依存しない共通の定数・しきい値。
// 言語ごとの運指テーブルや固有しきい値は modes/<lang>.js 側に置く。

export const MP_ASSET = "/assets/vendor/mediapipe";

// MediaPipe Hand Landmarker の 21 点インデックス
export const LM = {
  WRIST: 0, THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12, RING_PIP: 14, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20,
};

// --- 絵文字ジェスチャ / 共通しきい値 (手の大きさで正規化済み。環境により要微調整) ---
export const EMA = 0.5;          // 座標平滑化 (0=動かない,1=生値)
export const EDGE_MARGIN = 0.1;  // 画角の端(各辺10%)は使わず内側にリマップ (端は手検出が不安定なため)
export const HOLD_MS = 500;      // 単発(検索/クリア)の確定キープ時間
export const COOLDOWN_MS = 1000; // 単発の連発防止
export const POINTER_STYLE = "laser"; // 手書き窓のポインタ: "laser" | "crosshair"
export const DEFAULT_TOP_K = 30;      // 検索結果の既定件数

// --- 🔁 言語切替モーションのしきい値 ---
export const BACK_HOLD_MS = 500;      // 手の甲キープで確定する時間
export const LANG_COOLDOWN_MS = 400;  // 言語切替の最小デバウンス (連続切替を許容)
export const FLIP_WINDOW_MS = 1500;   // 手のひら→甲を「裏返し」とみなす猶予
export const ORIENT_DEADZONE = 0.12;  // 手のひら/甲を分ける不感帯 (sin(挟み角) 基準)
export const SWITCH_INPUT_COOLDOWN = 600;  // 言語切替直後にこの ms は入力を止める (回転→入力の遷移での誤入力防止)

// --- 入力モード一覧 (表示名/ガイドは i18n.js の DICT を参照) ---
export const INPUT_MODES = [
  { id: "japanese", buttonId: "modeJapanese" },
  { id: "english", buttonId: "modeEnglish" },
  { id: "emoji", buttonId: "modeEmoji" },
];
