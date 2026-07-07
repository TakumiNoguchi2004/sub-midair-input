// 絵文字入力:
//   描く   = 人差し指のみ伸展 (中指/薬指/小指は折れている)
//   検索   = グーパーグー (共通ジェスチャー: confirm)
//   クリア = グーフリップ (共通ジェスチャー: delete)
import { setGesture, setCameraState, drawPadCursor, setFlash,
  getPadCtx, clearPad, searchImage, applyLangCamState,
} from "../core.js";

let penDown = false;

// 人差し指のみ伸展 (中指/薬指/小指は折れている) = 描画。グーは除外。
function classifyDraw(hand) {
  if (hand.isFist) return "neutral";
  if (hand.fingers.index && !hand.fingers.middle && !hand.fingers.ring && !hand.fingers.pinky) {
    return "draw";
  }
  return "neutral";
}

export default {
  id: "emoji",
  label: "絵文字",
  reset() { penDown = false; },
  onFrame(ctx) {
    const { now, langInfo, hand, gesture } = ctx;
    const drawMode = classifyDraw(hand);

    const tip = hand.indexTip;
    drawPadCursor(tip.x, tip.y, drawMode);
    const pctx = getPadCtx();

    // 描画 (連続): 人差し指のみ伸展中
    if (drawMode === "draw" && pctx) {
      if (!penDown) { penDown = true; pctx.beginPath(); pctx.moveTo(tip.x, tip.y); }
      else { pctx.lineTo(tip.x, tip.y); pctx.stroke(); pctx.beginPath(); pctx.moveTo(tip.x, tip.y); }
    } else {
      penDown = false;
    }

    // 共通ジェスチャー: 決定=検索, 削除=クリア
    if (gesture.fired === "confirm") {
      searchImage("camera");
      setFlash("検索", now + 500);
    } else if (gesture.fired === "delete") {
      clearPad();
      setFlash("クリア", now + 500);
    }

    // ジェスチャー表示
    if (langInfo.fired) {
      setGesture(`-> ${langInfo.label}`);
    } else {
      setGesture(drawMode === "draw" ? "描画中" : "待機");
    }

    if (applyLangCamState(langInfo)) {
      // 言語切替優先
    } else if (gesture.fired === "confirm") {
      setCameraState("searching", "検索実行中", "検索結果を待っています");
    } else if (gesture.fired === "delete") {
      setCameraState("detecting", "クリアしました", "次のジェスチャを待っています");
    } else if (drawMode === "draw") {
      setCameraState("drawing", "描画中", "人差し指を折ると描画を止めます");
    } else {
      setCameraState("detecting", "検出中", "人差し指のみ=描画 / グーパーグー=検索 / グーフリップ=クリア");
    }
  },
};
