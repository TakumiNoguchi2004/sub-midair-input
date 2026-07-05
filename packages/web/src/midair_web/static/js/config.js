// 設定 (コア): 各言語に依存しない共通の定数・しきい値。
// 言語ごとの運指テーブルや固有しきい値は modes/<lang>.js 側に置く。

export const MP_ASSET = "/assets/vendor/mediapipe";

// MediaPipe Hand Landmarker の 21 点インデックス
export const LM = {
  WRIST: 0, THUMB_IP: 3, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12, RING_PIP: 14, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20,
};

// --- 絵文字ジェスチャ / 共通しきい値 (手の大きさで正規化済み。環境により要微調整) ---
export const PINCH_ON = 0.55;    // 3本ピンチ(親+人+中)の許容距離: これ未満でペンダウン
export const PINCH_OFF = 0.80;   // これ超でペンアップ (ヒステリシス)
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

// --- 入力モード一覧 & モード別の入力方法ガイド ---
export const INPUT_MODES = [
  { id: "japanese", label: "日本語", buttonId: "modeJapanese" },
  { id: "english", label: "英語", buttonId: "modeEnglish" },
  { id: "emoji", label: "絵文字", buttonId: "modeEmoji" },
];
export const MODE_GUIDE = {
  japanese: "日本語(折り曲げ式): 指を折って行を選び(2進数運指: あ=親,か=人,さ=親人,た=中…)→手をフリック→パーで確定(無フリック=あ段)。中+薬=濁点/半濁点/小。設定パネルで運指/しきい値を調整可。",
  english: "英語(折り曲げ式): 指を折って行(1-11)を選び→フリックで文字→パーで確定。中+薬=大小トグル / 中+薬+小=削除。下の運指参照表を見ながら操作。",
  emoji: "絵文字: テキスト / 手書きで検索し、下の候補をクリックで入力。カメラは 3本ピンチで描く / ピースで検索 / 指差しでクリア。",
};
