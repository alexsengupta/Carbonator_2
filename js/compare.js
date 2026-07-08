  // ========================
  // Compare runs
  // ========================
  // Collects model runs — added directly after a run, or loaded from
  // "Export outputs CSV" files — and overlays any output variable.
  // Runs live in memory for the session; each can be removed individually.

  const COMPARE_RUNS = []; // {id, label, source, color, rows:[{year,...}]}
  const CMP_COLORS = ["#c0392b","#2980b9","#27ae60","#8e44ad","#e67e22","#16a085","#34495e","#c2185b"];
  let cmpRunCounter = 0;

  // Variables offered in the floating panel; multiple can be shown at once.
  const CMP_VARS = [
    {col:"T", label:"Surface temperature"},
    {col:"Tl", label:"Deep ocean temperature"},
    {col:"CO2_ppm", label:"CO₂ concentration"},
    {col:"CH4_ppb", label:"CH₄ concentration"},
    {col:"pH", label:"Ocean pH"},
    {col:"F_total", label:"Total forcing"},
    {col:"SL_total_m", label:"Sea level rise"},
  ];
  const cmpVarsOn = new Set(["T"]);

  function cmpUniqueLabel(base){
    let label = base, n = 2;
    while (COMPARE_RUNS.some(r => r.label === label)) label = `${base} #${n++}`;
    return label;
  }

  function cmpAddRun(label, source, rows){
    cmpRunCounter++;
    COMPARE_RUNS.push({
      id: "run" + cmpRunCounter,
      label: cmpUniqueLabel(label),
      source,
      color: CMP_COLORS[(cmpRunCounter - 1) % CMP_COLORS.length],
      rows
    });
  }

  function cmpRemoveRun(id){
    const i = COMPARE_RUNS.findIndex(r => r.id === id);
    if (i >= 0) COMPARE_RUNS.splice(i, 1);
    renderCompare();
  }

  // Add the run currently on screen (with derived columns, as Export outputs writes them)
  function addCurrentRunToCompare(){
    if (!state.lastOutput) return false;
    const s0 = Math.sqrt(270);
    const rows = state.lastOutput.out.map(r => ({
      ...r,
      N2O_ppb_implied: (Math.max(s0 + (r.F_n2o / 0.12), 0) ** 2),
      OtherWMGHG_ppt_eq_implied: (1000 * r.F_other / 0.32)
    }));
    const meta = currentScenarioMeta() || {name: state.scenario};
    const label = meta.name + (hasAnyEdits() ? " (edited)" : "");
    cmpAddRun(label, "current session", rows);
    return true;
  }

  // Parse an "Export outputs CSV" file (headers matched by display name or raw key)
  function cmpParseOutputsCSV(text, filename){
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim() !== "");
    if (lines.length < 2) throw new Error(`${filename}: no data rows.`);

    const norm = loaderNormalize;
    const byNorm = new Map();
    for (const [col, disp] of OUTPUT_HEADER_MAP){
      byNorm.set(norm(col), col);
      byNorm.set(norm(disp), col);
      byNorm.set(norm(csvAsciiHeader(disp)), col); // headers are written ASCII-safe
    }

    const header = loaderSplitLine(lines[0]);
    const colOf = header.map(h => {
      const n = norm(h);
      if (n === "scenario" || n === "name") return "scenario";
      return byNorm.get(n) || null;
    });
    const yearIdx = colOf.indexOf("year");
    if (yearIdx === -1) throw new Error(`${filename}: no "Year" column found — is this an outputs file?`);
    const scenIdx = colOf.indexOf("scenario");

    let scenName = null;
    const rows = [];
    for (let li = 1; li < lines.length; li++){
      const cells = loaderSplitLine(lines[li]);
      const y = Number(cells[yearIdx]);
      if (!Number.isFinite(y)) continue;
      if (scenIdx !== -1 && scenName === null && (cells[scenIdx] || "").trim() !== ""){
        scenName = cells[scenIdx].trim();
      }
      const row = {year: y};
      for (let ci = 0; ci < colOf.length; ci++){
        const col = colOf[ci];
        if (!col || col === "year" || col === "scenario") continue;
        const v = Number(cells[ci]);
        if (Number.isFinite(v)) row[col] = v;
      }
      rows.push(row);
    }
    if (rows.length < 2) throw new Error(`${filename}: no usable data rows.`);

    const base = String(filename).replace(/\.csv$/i, "");
    const label = scenName && !base.toLowerCase().includes(scenName.toLowerCase()) ? `${base} (${scenName})` : base;
    cmpAddRun(label, "loaded file", rows);
  }

  function cmpVarLabel(col){
    const e = OUTPUT_HEADER_MAP.find(d => d[0] === col);
    return e ? e[1] : col;
  }

  function renderCompare(){
    const list = el("cmpRunList");
    if (!list) return;

    // floating-panel variable checkboxes (built once)
    const varBox = el("fpCmpVars");
    if (varBox && !varBox.childElementCount){
      for (const v of CMP_VARS){
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" data-cmpvar="${v.col}" ${cmpVarsOn.has(v.col) ? "checked" : ""}/> ${v.label}`;
        label.querySelector("input").addEventListener("change", (e)=>{
          if (e.target.checked) cmpVarsOn.add(v.col); else cmpVarsOn.delete(v.col);
          renderCompare();
        });
        varBox.appendChild(label);
      }
    }

    // back-to-run button: only when there is a run to return to
    const back = el("btnCmpBack");
    if (back) back.style.display = (state.scenario && state.lastOutput) ? "" : "none";

    // runs list
    list.innerHTML = "";
    for (const r of COMPARE_RUNS){
      const item = document.createElement("div");
      item.className = "cmp-run";
      item.innerHTML = `<span class="chip" style="background:${r.color}"></span>` +
                       `<span class="lbl">${r.label}</span><small>${r.source}</small>`;
      const del = document.createElement("button");
      del.className = "cmp-del";
      del.title = "Remove this run";
      del.textContent = "×";
      del.addEventListener("click", ()=>cmpRemoveRun(r.id));
      item.appendChild(del);
      list.appendChild(item);
    }

    const empty = el("cmpEmpty");
    const plotWrap = el("cmpPlotWrap");
    const has = COMPARE_RUNS.length > 0;
    empty.style.display = has ? "none" : "";
    plotWrap.style.display = has ? "" : "none";
    if (!has) return;

    // one chart per selected variable, all runs overlaid
    const plots = el("cmpPlots");
    plots.innerHTML = "";
    const wanted = CMP_VARS.filter(v => cmpVarsOn.has(v.col));
    if (!wanted.length){
      plots.innerHTML = '<div class="footnote">Select at least one variable in the Display controls panel.</div>';
      return;
    }
    for (const v of wanted){
      const panel = document.createElement("div");
      panel.className = "cmp-plot-panel";
      panel.style.marginBottom = "14px";
      const canvas = document.createElement("canvas");
      canvas.dataset.height = wanted.length > 1 ? "260" : "420";
      panel.appendChild(canvas);
      plots.appendChild(panel);

      const series = COMPARE_RUNS
        .map(r => ({
          label: r.label,
          color: r.color,
          x: r.rows.map(q => q.year),
          y: r.rows.map(q => (v.col in q && Number.isFinite(q[v.col])) ? q[v.col] : NaN)
        }))
        .filter(sr => sr.y.some(val => Number.isFinite(val)));
      if (!series.length){
        series.push({label:"(variable not present in these runs)", x:[1850,2100], y:[NaN,NaN], color:"#999"});
      }
      plotLines(canvas, series, {yLabel: cmpVarLabel(v.col), yDigits: 2, legend: true});
    }
  }

  (function initCompare(){
    const view = el("viewCompare");
    if (!view) return;

    el("btnCompareSidebar").addEventListener("click", ()=>{
      state.mode = "compare";
      renderAll();
    });

    if (el("btnCmpBack")){
      el("btnCmpBack").addEventListener("click", ()=>{
        if (!state.scenario || !state.lastOutput) return;
        state.mode = "output";
        renderAll();
      });
    }

    el("btnCmpAddCurrent").addEventListener("click", ()=>{
      if (!addCurrentRunToCompare()){
        alert("No run available yet — select a scenario and press Run scenario first.");
        return;
      }
      renderCompare();
    });

    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".csv,text/csv";
    picker.multiple = true;
    picker.style.display = "none";
    document.body.appendChild(picker);

    el("btnCmpLoad").addEventListener("click", ()=>{ picker.value = ""; picker.click(); });
    picker.addEventListener("change", ()=>{
      const files = [...(picker.files || [])];
      if (!files.length) return;
      let pending = files.length;
      const errors = [];
      for (const f of files){
        const reader = new FileReader();
        reader.onload = ()=>{
          try { cmpParseOutputsCSV(String(reader.result), f.name); }
          catch(err){ errors.push(err.message); }
          if (--pending === 0){
            renderCompare();
            if (errors.length) alert("Some files could not be loaded:\n" + errors.join("\n"));
          }
        };
        reader.readAsText(f);
      }
    });

    // "Add to compare" shortcut in the floating panel (visible after a run)
    const fp = el("fpAddCompare");
    if (fp){
      fp.addEventListener("click", ()=>{
        if (!addCurrentRunToCompare()) return;
        state.mode = "compare";
        renderAll();
      });
    }
  })();
