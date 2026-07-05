// 入力テスト: サンプル例文 (ひらがな + 英字 + 絵文字) を入力して練習する。
// 入力結果 (#jpFlickOutput) をお題と比較する (空白は緩く正規化)。表示切替は core.toggleView。
import { $ } from "./core.js";

const SAMPLES = [
  "ねこ cat 🐱",
  "はな flower 🌸",
  "こんにちは hello 👋",
  "すし sushi 🍣",
  "ありがとう thanks 🎉",
  "みず water 💧",
];
let idx = 0;

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

export function refreshTest() {
  const t = $("testTarget"); if (t) t.textContent = SAMPLES[idx];
  const p = $("testProgress"); if (p) p.textContent = `${idx + 1} / ${SAMPLES.length}`;
  const r = $("testResult"); if (r) { r.textContent = ""; r.className = "test-result"; }
}

export function testNext() { idx = (idx + 1) % SAMPLES.length; refreshTest(); }

export function testCheck() {
  const your = $("jpFlickOutput") ? $("jpFlickOutput").value : "";
  const ok = norm(your) === norm(SAMPLES[idx]);
  const r = $("testResult");
  if (r) { r.textContent = ok ? "✅ 正解！ 「次のお題」へ進めます" : "❌ お題と一致しません"; r.className = "test-result " + (ok ? "ok" : "ng"); }
}

export function initTest() { refreshTest(); }
