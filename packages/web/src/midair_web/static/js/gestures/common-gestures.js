// 全モード共通の named gesture 検出
//
// 決定 (confirm):  グーパーグー — isFist→isOpen→isFist の往復
// 削除 (delete):   グーフリップ — isFist 中に palm→back フリップ
// 言語切り替え:    パーフリップ — isOpen 中に palm→back フリップ (core.js で管理)
//
// グーフリップとパーフリップは手の開閉状態だけで完全に分離される。
// 削除を先に評価することで、グーフリップ後に手を開いても confirm が発火しない。

export const CONFIRM_PHASE_MS      = 1000;  // 各フェーズ(グー→パー, パー→グー)の猶予
export const DELETE_FLIP_WINDOW_MS = 1500;  // グー中に palm を見てから back までの猶予
export const GESTURE_COOLDOWN_MS   = 700;   // 各ジェスチャーの連発防止

export class CommonGestures {
  constructor() {
    // confirm (グーパーグー): 3フェーズのステートマシン
    this._cPhase       = "idle";  // "idle" | "fist1" | "open"
    this._cPhaseAt     = 0;       // 現フェーズに入った時刻
    this._confirmFiredAt = 0;

    // delete (グーフリップ)
    this._sawFistPalmAt = -1;     // グー中に手のひらを見た時刻 (-1=未観測)
    this._deleteArmed   = true;
    this._deleteFiredAt = 0;
  }

  reset() {
    this._cPhase        = "idle";
    this._cPhaseAt      = 0;
    this._sawFistPalmAt = -1;
    this._deleteArmed   = true;
  }

  /**
   * 毎フレーム呼び出す。
   * @param {import("./hand-state.js").HandState} hand
   * @param {"palm"|"back"|"unknown"} orient  core.js が計算した手のひら向き
   * @param {number} now  performance.now()
   * @returns {{ fired: "confirm"|"delete"|null }}
   */
  update(hand, orient, now) {
    let fired = null;

    // ── 削除優先: グーフリップ ───────────────────────────────────────────
    if (hand.isFist) {
      if (orient === "palm") {
        this._sawFistPalmAt = now;
        this._deleteArmed   = true;
      }
      if (orient === "back" &&
          this._deleteArmed &&
          now - this._deleteFiredAt > GESTURE_COOLDOWN_MS &&
          this._sawFistPalmAt > 0 &&
          now - this._sawFistPalmAt < DELETE_FLIP_WINDOW_MS) {
        fired               = "delete";
        this._deleteFiredAt = now;
        this._deleteArmed   = false;
        this._sawFistPalmAt = -1;
        this._cPhase        = "idle";  // confirm ステートマシンをリセット
      }
    } else {
      this._sawFistPalmAt = -1;
      this._deleteArmed   = true;
    }

    // ── 決定: グーパーグー (delete が発火した場合はスキップ) ─────────────
    if (fired === null) {
      const elapsed = now - this._cPhaseAt;

      switch (this._cPhase) {
        case "idle":
          if (hand.isFist) { this._cPhase = "fist1"; this._cPhaseAt = now; }
          break;

        case "fist1":
          if (elapsed > CONFIRM_PHASE_MS) {
            this._cPhase = "idle";
          } else if (hand.isOpen) {
            // グー→パー成功、次フェーズへ
            this._cPhase = "open"; this._cPhaseAt = now;
          }
          // 中間状態 (遷移中) はタイムアウトまで待つ
          break;

        case "open":
          if (elapsed > CONFIRM_PHASE_MS) {
            this._cPhase = "idle";
          } else if (hand.isFist) {
            // グーパーグー完成
            if (now - this._confirmFiredAt > GESTURE_COOLDOWN_MS) {
              fired                = "confirm";
              this._confirmFiredAt = now;
            }
            this._cPhase = "idle";
          }
          // 中間状態 (遷移中) はタイムアウトまで待つ
          break;
      }
    }

    return { fired };
  }
}
