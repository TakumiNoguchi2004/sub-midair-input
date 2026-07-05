// 折り曲げ運指の設定UI (しきい値スライダ + 運指エディタ)。日本語/英語で共有。
import { th, canonFold, FINGER_ORDER, FINGER_LABEL } from "./foldcore.js";

const FINGER_CB = FINGER_ORDER.map((k) => [k, FINGER_LABEL[k]]);

function makeSlider(label, min, max, step, value, onInput) {
  const row = document.createElement("div");
  row.className = "jp-cfg-th";
  const lab = document.createElement("span"); lab.className = "jp-cfg-thlab"; lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  const val = document.createElement("span"); val.className = "jp-cfg-thval"; val.textContent = value;
  inp.addEventListener("input", () => { val.textContent = inp.value; onInput(parseFloat(inp.value)); });
  row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
  return row;
}

// entry の運指エディタ行。foldMap[entry] を直接編集する。allEntries は重複検証用。labelFn(entry)→表示名。
function makeRowEditor(entry, foldMap, allEntries, labelFn) {
  const el = document.createElement("div");
  el.className = "jp-cfg-row";
  const label = document.createElement("span");
  label.className = "jp-cfg-rowlabel"; label.textContent = labelFn(entry);
  el.appendChild(label);

  const disp = document.createElement("span"); disp.className = "jp-cfg-disp";
  function renderDisp() {
    disp.innerHTML = "";
    const set = new Set(foldMap[entry]);
    for (const [key, lbl] of FINGER_CB) {
      const s = document.createElement("span");
      s.className = set.has(key) ? "jp-cfg-on" : "jp-cfg-off";
      s.textContent = set.has(key) ? `✅${lbl}` : lbl;
      disp.appendChild(s);
    }
  }
  renderDisp();
  el.appendChild(disp);

  const edit = document.createElement("span");
  edit.className = "jp-cfg-edit"; edit.style.display = "none";
  const boxes = {};
  for (const [key, lbl] of FINGER_CB) {
    const w = document.createElement("label"); w.className = "jp-cfg-cb";
    const cb = document.createElement("input"); cb.type = "checkbox";
    w.appendChild(cb); w.appendChild(document.createTextNode(lbl));
    edit.appendChild(w); boxes[key] = cb;
  }
  el.appendChild(edit);

  const btn = document.createElement("button");
  btn.className = "jp-cfg-btn"; btn.textContent = "運指変更";
  const msg = document.createElement("span"); msg.className = "jp-cfg-msg";
  btn.addEventListener("click", () => {
    if (btn.dataset.editing !== "1") {
      const set = new Set(foldMap[entry]);
      for (const [key] of FINGER_CB) boxes[key].checked = set.has(key);
      disp.style.display = "none"; edit.style.display = "";
      btn.dataset.editing = "1"; btn.textContent = "保存"; msg.textContent = "";
      return;
    }
    const chosen = FINGER_ORDER.filter((k) => boxes[k].checked);
    const key = canonFold(chosen);
    if (!key) { msg.textContent = "1本以上選択してください"; return; }
    const others = allEntries.filter((e) => e !== entry).map((e) => canonFold(foldMap[e]));
    if (others.includes(key)) { msg.textContent = "他の運指と重複"; return; }
    foldMap[entry] = chosen;
    renderDisp();
    disp.style.display = ""; edit.style.display = "none";
    btn.dataset.editing = ""; btn.textContent = "運指変更"; msg.textContent = "保存しました";
  });
  el.appendChild(btn); el.appendChild(msg);
  return el;
}

// 設定一式を root に描画。opts = { thresholds:bool, foldMap, order, labelFn, mapTitle }
export function renderFoldConfig(root, opts) {
  if (!root) return;
  root.innerHTML = "";
  if (opts.thresholds) {
    const t = document.createElement("div");
    t.className = "jp-cfg-title"; t.textContent = "検出しきい値 (デモ調整・日本語/英語 共通)";
    root.appendChild(t);
    root.appendChild(makeSlider("行ロック(ms)", 60, 600, 10, th.HOLD_MS, (v) => { th.HOLD_MS = v; }));
    root.appendChild(makeSlider("フリック距離", 0.02, 1.00, 0.01, th.FLICK_DIST, (v) => { th.FLICK_DIST = v; }));
    root.appendChild(makeSlider("親指折りしきい", 0.40, 1.10, 0.02, th.THUMB_FOLD, (v) => { th.THUMB_FOLD = v; }));
  }
  const mt = document.createElement("div");
  mt.className = "jp-cfg-title"; mt.textContent = opts.mapTitle || "運指 (行/操作 → 折り曲げる指)";
  root.appendChild(mt);
  for (const e of opts.order) root.appendChild(makeRowEditor(e, opts.foldMap, opts.order, opts.labelFn));
}
