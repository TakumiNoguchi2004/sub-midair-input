// 折り曲げ運指の設定UI (しきい値スライダ + 運指エディタ)。日本語/英語で共有。
import { th, canonFold, FINGER_ORDER } from "./foldcore.js";
import { t } from "./i18n.js";

// 指ラベルは描画時に t() で解決する (言語トグルで再描画されると新言語になる)
const fingerLabel = (k) => t("finger." + k);

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
    for (const key of FINGER_ORDER) {
      const lbl = fingerLabel(key);
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
  for (const key of FINGER_ORDER) {
    const w = document.createElement("label"); w.className = "jp-cfg-cb";
    const cb = document.createElement("input"); cb.type = "checkbox";
    w.appendChild(cb); w.appendChild(document.createTextNode(fingerLabel(key)));
    edit.appendChild(w); boxes[key] = cb;
  }
  el.appendChild(edit);

  const btn = document.createElement("button");
  btn.className = "jp-cfg-btn"; btn.textContent = t("btn.editFold");
  const msg = document.createElement("span"); msg.className = "jp-cfg-msg";
  btn.addEventListener("click", () => {
    if (btn.dataset.editing !== "1") {
      const set = new Set(foldMap[entry]);
      for (const key of FINGER_ORDER) boxes[key].checked = set.has(key);
      disp.style.display = "none"; edit.style.display = "";
      btn.dataset.editing = "1"; btn.textContent = t("btn.save"); msg.textContent = "";
      return;
    }
    const chosen = FINGER_ORDER.filter((k) => boxes[k].checked);
    const key = canonFold(chosen);
    if (!key) { msg.textContent = t("fe.needOne"); return; }
    const others = allEntries.filter((e) => e !== entry).map((e) => canonFold(foldMap[e]));
    if (others.includes(key)) { msg.textContent = t("fe.dup"); return; }
    foldMap[entry] = chosen;
    renderDisp();
    disp.style.display = ""; edit.style.display = "none";
    btn.dataset.editing = ""; btn.textContent = t("btn.editFold"); msg.textContent = t("fe.saved");
  });
  el.appendChild(btn); el.appendChild(msg);
  return el;
}

// 設定一式を root に描画。opts = { thresholds:bool, foldMap, order, labelFn, mapTitle }
export function renderFoldConfig(root, opts) {
  if (!root) return;
  root.innerHTML = "";
  if (opts.thresholds) {
    const title = document.createElement("div");
    title.className = "jp-cfg-title"; title.textContent = t("fe.thTitle");
    root.appendChild(title);
    root.appendChild(makeSlider(t("fe.thHold"), 60, 600, 10, th.HOLD_MS, (v) => { th.HOLD_MS = v; }));
    root.appendChild(makeSlider(t("fe.thFlick"), 0.02, 1.00, 0.01, th.FLICK_DIST, (v) => { th.FLICK_DIST = v; }));
    root.appendChild(makeSlider(t("fe.thThumb"), 0.20, 0.90, 0.05, th.THUMB_FOLD, (v) => { th.THUMB_FOLD = v; }));
  }
  const mt = document.createElement("div");
  mt.className = "jp-cfg-title"; mt.textContent = opts.mapTitle || t("fe.mapTitle");
  root.appendChild(mt);
  for (const e of opts.order) root.appendChild(makeRowEditor(e, opts.foldMap, opts.order, opts.labelFn));
}
