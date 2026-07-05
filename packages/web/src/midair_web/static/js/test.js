// 入力テスト: サンプル例文 (ひらがな + 英字 + 絵文字) を入力して計測する。
// 「入力開始」で計測+カメラ起動 → お題を入力 → 「終了」で停止+結果表示。
// 入力欄 (#jpFlickOutput) の値変化を rAF でポーリングして集計する。
import { $, startCam } from "./core.js";

const SAMPLES = [
  "ねこ cat 🐱",
  "はな flower 🌸",
  "こんにちは hello 👋",
  "すし sushi 🍣",
  "ありがとう thanks 🎉",
  "みず water 💧",
];
let idx = 0;

let measuring = false, startT = 0, lastVal = "", rafId = 0;
let inputs = 0, mistypes = 0, targetChars = [];

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const chars = (s) => Array.from(s || "");           // 絵文字を1文字として扱う
const setStat = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const setBtn = (t) => { const b = $("testStartBtn"); if (b) b.textContent = t; };

export function refreshTest() {
  measuring = false;
  if (rafId) cancelAnimationFrame(rafId);
  startT = 0; lastVal = ""; inputs = 0; mistypes = 0;
  targetChars = chars(SAMPLES[idx]);
  const t = $("testTarget"); if (t) t.textContent = SAMPLES[idx];
  const p = $("testProgress"); if (p) p.textContent = `${idx + 1} / ${SAMPLES.length}`;
  setStat("statTime", "0.0"); setStat("statInputs", "0"); setStat("statMiss", "0"); setStat("statAcc", "0"); setStat("statAvg", "0.0");
  const r = $("testResult"); if (r) { r.textContent = ""; r.className = "test-result"; }
  setBtn("入力開始");
}

// お題との一致率 (先頭から位置ごとに一致した数 / お題の長さ)
function accuracy(cur) {
  const c = chars(cur);
  let ok = 0;
  for (let p = 0; p < targetChars.length; p++) if (c[p] === targetChars[p]) ok++;
  return targetChars.length ? Math.round((100 * ok) / targetChars.length) : 0;
}

// 値の差分を集計: 追加/変更 = 入力(お題と不一致ならミス)。削除はカウントしない。
function applyDiff(oldStr, curStr) {
  const a = chars(oldStr), b = chars(curStr);
  if (b.length > a.length) {
    for (let p = a.length; p < b.length; p++) { inputs++; if (b[p] !== targetChars[p]) mistypes++; }
  } else if (b.length === a.length) {
    for (let p = 0; p < b.length; p++) if (a[p] !== b[p]) { inputs++; if (b[p] !== targetChars[p]) mistypes++; }
  }
}

function liveStats(cur) {
  if (startT) setStat("statTime", ((performance.now() - startT) / 1000).toFixed(1));
  setStat("statInputs", String(inputs));
  setStat("statMiss", String(mistypes));
  setStat("statAcc", String(accuracy(cur)));
  // 平均入力回数 = お題1文字あたりの入力回数 (理想 1.0、修正が多いほど大きい)
  setStat("statAvg", targetChars.length ? (inputs / targetChars.length).toFixed(1) : "0.0");
}

function tick() {
  if (!measuring) return;
  const cur = $("jpFlickOutput") ? $("jpFlickOutput").value : "";
  if (cur !== lastVal) { applyDiff(lastVal, cur); lastVal = cur; }
  liveStats(cur);
  rafId = requestAnimationFrame(tick);
}

function testStart() {
  const o = $("jpFlickOutput"); if (o) o.value = "";
  targetChars = chars(SAMPLES[idx]);
  measuring = true; startT = performance.now(); lastVal = ""; inputs = 0; mistypes = 0;
  startCam();   // カメラ起動 (未起動なら)
  const r = $("testResult"); if (r) { r.textContent = "計測中… お題を入力してください"; r.className = "test-result"; }
  setBtn("終了");
  if (rafId) cancelAnimationFrame(rafId);
  tick();
}

function testStop() {
  const cur = $("jpFlickOutput") ? $("jpFlickOutput").value : "";
  measuring = false;
  if (rafId) cancelAnimationFrame(rafId);
  targetChars = chars(SAMPLES[idx]);
  liveStats(cur);   // 最終値で固定
  const ok = norm(cur) === norm(SAMPLES[idx]);
  const r = $("testResult");
  if (r) { r.textContent = ok ? "✅ 正解！ 「次のお題」へ" : "終了。お題と一致しません"; r.className = "test-result " + (ok ? "ok" : "ng"); }
  setBtn("入力開始");
}

export function testToggle() { if (measuring) testStop(); else testStart(); }
export function testNext() { idx = (idx + 1) % SAMPLES.length; refreshTest(); }
export function initTest() { refreshTest(); }
