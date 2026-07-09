// 寿司打風タイピングゲーム本体。
//   core.js の setInputMode / startCam / onLangMethodChange を直接 import して使う
//   (core.js / modes/*.js には一切手を加えない)。
//   #jpFlickOutput の値を rAF でポーリングして進捗を追うのは test.js の入力テスト機能と同じ手法。
//
// 判定方式 (寿司打などの一般的なタイピングゲームと同じ):
//   お題の何文字目まで「順番通りに」正しく打てたか (progress) だけを追跡する。
//   誤入力があってもリセットはせず、単に無視してその位置を埋めない (ミスとして記録するだけ)。
//   #jpFlickOutput はフリック入力エンジンが直接追記/削除する実体で、見た目には出さない。
//   代わりに #gameTypedDisplay に「打った文字全部」を、正解に寄与した文字と外れた文字を
//   色分けして表示し、#gameTarget 側もどこまで進んだかを色分けする。
import { pickRandomWord } from "./wordlists.js";
import { setInputMode, startCam } from "../core.js";
import { setLang } from "../i18n.js";

// このゲームは留学生など日本語話者以外も遊ぶ前提のため、共有の言語設定(localStorage、
// メインページの EN トグルと共通)に関わらずカメラ状態表示等を常に英語で出す。
// (フリック運指ガイド文 #jpFlickStatus は japanese.js 内にハードコードされた日本語文字列で、
//  共有エンジンを書き換えない方針のため対象外)
setLang("en");

const $ = (id) => document.getElementById(id);
const chars = (s) => Array.from(s || "");   // 絵文字・サロゲートペア対策 (お題側は非使用だが念のため統一)
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- 設定 (スタート画面で選択) ---
let mode = "japanese";     // "japanese" | "english" | "both"
let duration = 30;         // 秒

// --- 実行時状態 ---
let running = false;
let rafId = 0;
let startAt = 0, endAt = 0;
let currentWord = null;    // { text, hint, lang }
let lastValue = "";        // #jpFlickOutput の直近値 (差分検出用)
let judgements = [];       // 現在の入力文字列(=lastValueの各文字)ごとの true(進捗に寄与)/false(ミス)
let progress = 0;          // お題の何文字目まで正しく入力できたか (= judgements 内の true の数)
let stats = { words: 0, miss: 0, inputs: 0 };   // inputs = 打った文字数(正誤問わず) = "Characters Typed"
let comboTimer = 0;

// プレイ中かどうかだけを唯一の真実として body に反映する。
// カメラ側のオーバーレイ(#targetBar/#inputBar と #idleOverlay)・右パネル(#startScreen と
// #gameScreen)はどちらも CSS 側で body.playing の有無だけを見て排他的に表示するため、
// 「前の状態が消えずに残る」ような中間状態が構造的に起こらない。
function setPlaying(isPlaying) {
  document.body.classList.toggle("playing", isPlaying);
}

// --- モード/時間選択 UI ---
document.querySelectorAll("button[data-mode]").forEach((b) => {
  b.addEventListener("click", () => {
    mode = b.dataset.mode;
    document.querySelectorAll("button[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
  });
});
document.querySelectorAll("button[data-dur]").forEach((b) => {
  b.addEventListener("click", () => {
    duration = parseInt(b.dataset.dur, 10);
    document.querySelectorAll("button[data-dur]").forEach((x) => x.classList.toggle("active", x === b));
  });
});

function pickLang() {
  if (mode === "both") return Math.random() < 0.5 ? "japanese" : "english";
  return mode;
}

function flashCombo(text) {
  const el = $("comboFlash");
  if (!el) return;
  el.textContent = text;
  comboTimer = performance.now() + 900;
}

function nextWord() {
  const lang = pickLang();
  const w = pickRandomWord(lang, currentWord?.text ?? null);
  currentWord = { ...w, lang };
  setInputMode(lang);   // そのモードの運指エンジン内部状態もリセットされる
  const o = $("jpFlickOutput");
  if (o) o.value = "";
  lastValue = "";
  judgements = [];
  progress = 0;
  renderTarget();
  renderTyped();
}

// お題の何文字目まで進んだか (progress) を1文字ずつ判定する。
// 一致すれば進捗を1つ進める(true)。不一致ならミスとして記録するだけで進捗は動かさない(false)。
function judgeChar(ch, targetChars) {
  stats.inputs++;
  if (progress < targetChars.length && ch === targetChars[progress]) {
    judgements.push(true);
    progress++;
    return;
  }
  judgements.push(false);
  stats.miss++;
}

function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// 差分を進捗へ反映する。フリック入力は「末尾への追記」「削除ジェスチャーでの末尾巻き戻し」
// 「濁点/大文字化トグルでの末尾置換」のいずれかしか起こさないため、旧値との共通接頭辞より
// 後ろだけを 巻き戻し→再判定 すれば全パターンに対応できる。
function applyDiff(oldStr, curStr) {
  const targetChars = chars(currentWord.text);
  const a = chars(oldStr), b = chars(curStr);
  const common = commonPrefixLen(a, b);
  for (let p = a.length - 1; p >= common; p--) {
    const wasHit = judgements.pop();
    if (wasHit) progress--;
  }
  for (let p = common; p < b.length; p++) judgeChar(b[p], targetChars);
}

function renderTarget() {
  const el = $("gameTarget");
  if (!el || !currentWord) return;
  const t = chars(currentWord.text);
  el.innerHTML = t.map((c, i) =>
    `<span class="${i < progress ? "tgt-done" : "tgt-pending"}">${escapeHtml(c)}</span>`).join("");
  const hint = $("gameTargetHint");
  if (hint) hint.innerHTML = currentWord.hint ? `(${escapeHtml(currentWord.hint)})` : "&nbsp;";
}

function renderTyped() {
  const el = $("gameTypedDisplay");
  if (!el) return;
  const cur = chars(($("jpFlickOutput") || {}).value || "");
  if (!cur.length) { el.innerHTML = "&nbsp;"; return; }
  el.innerHTML = cur.map((c, i) =>
    `<span class="${judgements[i] ? "hit" : "miss"}">${escapeHtml(c)}</span>`).join("");
}

const TIMER_WARN_SEC = 10;   // 残りこの秒数以下になったらタイマーを赤く点滅させる

function updateTimerUI(remainMs) {
  const remain = Math.max(0, remainMs / 1000);
  const label = $("gameTimerLabel"); if (label) label.textContent = remain.toFixed(1);
  const bar = $("gameTimerBar");
  if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, remainMs / (duration * 1000))) * 100)}%`;
  const badge = $("timerBadge");
  if (badge) badge.classList.toggle("warn", remain > 0 && remain <= TIMER_WARN_SEC);
}

function updateStatsUI() {
  const w = $("statWords"), m = $("statMiss"), c = $("statChars");
  if (w) w.textContent = String(stats.words);
  if (m) m.textContent = String(stats.miss);
  if (c) c.textContent = String(stats.inputs);
  const flash = $("comboFlash");
  if (flash && comboTimer && performance.now() > comboTimer) { flash.textContent = ""; comboTimer = 0; }
}

function onWordComplete() {
  stats.words++;
  flashCombo(`✓ ${currentWord.text}`);
  nextWord();
}

function tick() {
  if (!running) return;
  const o = $("jpFlickOutput");
  const cur = o ? o.value : "";
  if (cur !== lastValue) {
    applyDiff(lastValue, cur);
    lastValue = cur;
    renderTarget();
    renderTyped();
  }
  if (currentWord && progress >= chars(currentWord.text).length) onWordComplete();

  const remainMs = endAt - performance.now();
  updateTimerUI(remainMs);
  updateStatsUI();
  if (remainMs <= 0) { finishGame(); return; }
  rafId = requestAnimationFrame(tick);
}

function startGame() {
  stats = { words: 0, miss: 0, inputs: 0 };
  running = true;
  startAt = performance.now();
  endAt = startAt + duration * 1000;
  startCam();
  setPlaying(true);
  nextWord();
  if (rafId) cancelAnimationFrame(rafId);
  tick();
}

function finishGame() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  const elapsedSec = Math.max(0.001, (performance.now() - startAt) / 1000);
  const acc = stats.inputs ? Math.max(0, Math.round((100 * (stats.inputs - stats.miss)) / stats.inputs)) : 100;
  const rw = $("resultWords"), rc = $("resultChars"), rm = $("resultMiss"), ra = $("resultAcc"), rp = $("resultCps");
  if (rw) rw.textContent = String(stats.words);
  if (rc) rc.textContent = String(stats.inputs);
  if (rm) rm.textContent = String(stats.miss);
  if (ra) ra.textContent = `${acc}%`;
  if (rp) rp.textContent = (stats.inputs / elapsedSec).toFixed(1);
  setPlaying(false);
  $("idlePrompt")?.classList.add("hidden");
  $("idleResult")?.classList.remove("hidden");
}

$("startBtn")?.addEventListener("click", startGame);
$("quitBtn")?.addEventListener("click", finishGame);

setPlaying(false);
