// 英語入力 (未実装スタブ)。
// 決定論的なジェスチャ→文字入力 (フリック / エアタイプ等) にするならフロント完結で実装できる。
// その場合は onFrame に運指→アルファベットの写像を足す (japanese.js を参照実装に)。
import { setGesture, setCameraState, clearPadCursor, applyLangCamState } from "../core.js";

export default {
  id: "english",
  label: "英語",
  reset() {},
  onFrame(ctx) {
    const { langInfo } = ctx;
    clearPadCursor();
    setGesture(langInfo.fired ? `🔁 ${langInfo.label}` : "英語入力");
    if (!applyLangCamState(langInfo)) {
      setCameraState("detecting", "英語入力モード", "動作は未実装です");
    }
  },
};
