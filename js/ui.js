  // ========================
  // DOM helpers
  // ========================
  const el = (id) => document.getElementById(id);

  function show(view){
    el("viewHome").style.display = (view==="home") ? "" : "none";
    el("viewScenario").style.display = (view==="scenario") ? "" : "none";
    const cmp = el("viewCompare");
    if (cmp) cmp.style.display = (view==="compare") ? "" : "none";
  }

  function promptFilename(defaultName){
    let name = window.prompt("Save file as:", defaultName);
    if (name === null) return null;
    name = name.trim();
    if (!name) return null;
    if (!/\.csv$/i.test(name)) name += ".csv";
    return name;
  }

  function setModeButtons(){
    el("modeBasic").classList.toggle("active", state.uiMode==="basic");
    el("modeAdvanced").classList.toggle("active", state.uiMode==="advanced");
    document.querySelectorAll(".advOnly").forEach(n=>{
      // NOTE: .advOnly is hidden by default in CSS. In Advanced mode we need to
      // explicitly restore a sensible display value.
      if (state.uiMode !== "advanced"){
        n.style.display = "none";
        return;
      }
      if (n.classList.contains("toggle-row")){
        n.style.display = "flex";
      } else if (n.classList.contains("btn") || n.tagName === "BUTTON"){
        n.style.display = "inline-flex";
      } else {
        n.style.display = "block";
      }
    });
    el("modeBadge").textContent = (state.uiMode==="advanced") ? "ADVANCED MODE" : "BASIC MODE";
    el("controlsHint").textContent = "Toggle inputs on/off, then run the model.";
  }

  function setActiveSidebar(){
    document.querySelectorAll(".sideitem").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.scenario === state.scenario);
    });
    const cmp = el("btnCompareSidebar");
    if (cmp) cmp.classList.toggle("active", state.mode === "compare");
  }

  // ========================
  // Modal
  // ========================
  function openModal(title, bodyNode){
    el("modalTitle").textContent = title;
    const body = el("modalBody");
    body.innerHTML = "";
    body.appendChild(bodyNode);
    const overlay = el("modalOverlay");
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
  }
  function closeModal(){
    const overlay = el("modalOverlay");
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
  }
  el("modalClose").addEventListener("click", closeModal);
  el("modalOverlay").addEventListener("click", (e)=>{ if(e.target===el("modalOverlay")) closeModal(); });

  // ========================
  // Downloads
  // ========================
  // ASCII-safe CSV header names: Excel often decodes CSV as windows-1252, turning
  // CO₂/°C/W-m² into mojibake ("CO‚ÇÇ"). Headers are written ASCII-only, and CSVs
  // get a UTF-8 BOM (below) so any remaining unicode decodes correctly too.
  function csvAsciiHeader(s){
    return String(s)
      .replace(/₂/g, "2").replace(/₃/g, "3").replace(/₄/g, "4")
      .replace(/²/g, "2").replace(/³/g, "3")
      .replace(/°C/g, "degC").replace(/°/g, "deg")
      .replace(/[–—]/g, "-");
  }

  function downloadText(filename, text, mime="text/plain"){
    const payload = (mime === "text/csv" && !text.startsWith("\uFEFF")) ? "\uFEFF" + text : text;
    const blob = new Blob([payload], {type: mime});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 500);
  }

  // ========================
  // State helpers
  // ========================
  function currentScenarioMeta(){
    return SCENARIOS.find(s => s.key === state.scenario);
  }

  function getScenarioRows(key){
    const rows = BY_SCENARIO.get(key);
    if (!rows) return [];
    return rows;
  }

  function hasAnyEdits(){
    return Object.keys(state.customSeries).length > 0 ||
           (state.params && (Object.keys(state.params.carbonOverrides||{}).length>0 ||
                             Object.keys(state.params.methaneOverrides||{}).length>0 ||
                             Object.keys(state.params.seaOverrides||{}).length>0 ||
                             state.params.carbonConfig !== DEFAULTS.params.carbonConfig ||
                             state.params.S !== DEFAULTS.params.S ||
                             state.params.cu !== DEFAULTS.params.cu ||
                             state.params.cl !== DEFAULTS.params.cl ||
                             state.params.gamma !== DEFAULTS.params.gamma ||
                             (state.params.iv && (
                               state.params.iv.enabled !== IV_DEFAULT.enabled ||
                               state.params.iv.amp !== IV_DEFAULT.amp ||
                               state.params.iv.period !== IV_DEFAULT.period ||
                               state.params.iv.tau !== IV_DEFAULT.tau ||
                               state.params.iv.seed !== IV_DEFAULT.seed
                             ))));
  }

  function updateEditBadges(){
    // per-variable edited badges
    document.querySelectorAll('[id^="badge_"]').forEach(span=>{ span.style.display="none"; });
    for (const k of Object.keys(state.customSeries)){
      const b = el("badge_"+k);
      if (b) b.style.display = "";
    }
    el("editBadge").innerHTML = hasAnyEdits() ? '<span class="badge">CUSTOM</span>' : '';
  }

  function getSeriesValues(rows, col){
    const base = rows.map(r=>r[col]);
    const custom = state.customSeries[col];
    if (custom && custom.length === base.length) return custom.slice();
    return base;
  }

  function buildWorkingRows(){
    const baseRows = getScenarioRows(state.scenario);
    return baseRows.map((r, idx) => {
      const o = {...r};

      // apply custom series overrides
      for (const meta of INPUT_VARS){
        const col = meta.col;
        const custom = state.customSeries[col];
        if (custom && custom.length === baseRows.length){
          o[col] = custom[idx];
        }
      }

      // apply toggles: zero out disabled inputs
      if (!state.toggles.CO2) o.E_CO2_GtC_yr = 0;
      if (!state.toggles.CH4) o.E_CH4_TgCH4_yr = 0;
      if (!state.toggles.AER) o.ERF_aerosol_rel1850_Wm2 = 0;
      if (!state.toggles.O3) o.ERF_o3_total_rel1850_Wm2 = 0;
      if (!state.toggles.N2O) o.ERF_N2O_rel1850_Wm2 = 0;
      if (!state.toggles.OTHER) o.ERF_otherWMGHG_rel1850_Wm2 = 0;
      if (!state.toggles.VOLC) o.ERF_volcanic_rel1850_Wm2 = 0;
      if (!state.toggles.SOLAR) o.ERF_solar_rel1850_Wm2 = 0;

      return o;
    });
  }

  // ========================
  // Rendering
  // ========================
  const SCENARIO_GROUPS = [
    {id:"ssp", title:"Default Scenarios"},
    {id:"teaching", title:"Teaching experiments"},
    {id:"user", title:"User scenarios"}
  ];

  // Sidebar concertina state (in-memory; teaching starts collapsed for space)
  const sidebarCollapsed = { ssp:false, teaching:true, user:false };

  function deleteUserScenario(key){
    const i = SCENARIOS.findIndex(s => s.key === key);
    if (i >= 0) SCENARIOS.splice(i, 1);
    BY_SCENARIO.delete(key);
    const j = USER_SCENARIOS.indexOf(key);
    if (j >= 0) USER_SCENARIOS.splice(j, 1);
    if (state.scenario === key){
      state.mode = "home";
      state.scenario = null;
      state.lastOutput = null;
    }
    renderSidebar();
    renderAll();
  }

  function renderHome(){
    const grid = el("homeScenarioGrid");
    grid.innerHTML = "";
    for (const g of SCENARIO_GROUPS){
      const members = SCENARIOS.filter(s => (s.group || "ssp") === g.id);
      if (!members.length) continue;
      const heading = document.createElement("div");
      heading.className = "home-group-title";
      heading.textContent = g.title;
      grid.appendChild(heading);
      for (const s of members){
        const card = document.createElement("div");
        card.className = "scenario-card";
        card.innerHTML = `
          <div class="thumb" aria-hidden="true"></div>
          <div style="flex:1; min-width:0;">
            <h3>${s.name}${g.id === "ssp" ? ` (${s.key})` : ""}</h3>
            <p>${s.desc}</p>
            <div class="card-actions">
              <button class="btn orange" data-start="${s.key}">Start</button>
            </div>
          </div>
        `;
        const img = s.img || (g.id === "user" ? "assets/img/scenarios/custom.png" : null);
        if (img) card.querySelector(".thumb").style.backgroundImage = `url('${img}')`;
        card.querySelector("[data-start]").addEventListener("click", ()=>selectScenario(s.key));
        grid.appendChild(card);
      }
    }
  }

  function renderSidebar(){
    const list = el("sidebarList");
    list.innerHTML = "";
    for (const g of SCENARIO_GROUPS){
      const members = SCENARIOS.filter(s => (s.group || "ssp") === g.id);
      // "User scenarios" group is always shown (it hosts the Load button)
      if (!members.length && g.id !== "user") continue;

      const collapsed = !!sidebarCollapsed[g.id];
      const label = document.createElement("button");
      label.className = "sidegroup sidegroup-toggle";
      label.innerHTML = `<span class="tri">${collapsed ? "▸" : "▾"}</span> ${g.title}` +
                        (members.length ? ` <span class="cnt">(${members.length})</span>` : "");
      label.addEventListener("click", ()=>{
        sidebarCollapsed[g.id] = !sidebarCollapsed[g.id];
        renderSidebar();
        setActiveSidebar();
      });
      list.appendChild(label);
      if (collapsed) continue;

      for (const s of members){
        const btn = document.createElement("button");
        btn.className = "sideitem";
        btn.dataset.scenario = s.key;
        const sub = g.id === "ssp" ? s.key : (g.id === "user" ? "loaded" : "experiment");
        btn.innerHTML = `${s.name}<small>${sub}</small>`;
        btn.addEventListener("click", ()=>selectScenario(s.key));
        if (g.id === "user"){
          const del = document.createElement("span");
          del.className = "side-del";
          del.title = "Remove this scenario from the list";
          del.textContent = "×";
          del.addEventListener("click", (ev)=>{
            ev.stopPropagation();
            deleteUserScenario(s.key);
          });
          btn.appendChild(del);
        }
        list.appendChild(btn);
      }

      if (g.id === "user"){
        const load = document.createElement("button");
        load.className = "sideload";
        load.id = "btnLoadScenarioSidebar";
        load.title = "Load a scenario from a CSV file (a previously saved inputs file, or a sparse file with values at selected years — interpolated automatically).";
        load.textContent = "+ Load scenario (CSV)…";
        list.appendChild(load);
      }
    }
  }

  function updateToggleLabels(){
    for (const k of Object.keys(TOGGLE_DOM)){
      const on = !!state.toggles[k];
      el(TOGGLE_DOM[k].cb).checked = on;
      el(TOGGLE_DOM[k].st).textContent = on ? "ON" : "OFF";
    }
  }

  function updateIVToggle(){
    const cb = el("togIV");
    if (!cb) return;
    const enabled = !!(state.params && state.params.iv && state.params.iv.enabled);
    cb.checked = enabled;
    const st = el("stateIV");
    if (st) st.textContent = enabled ? "ON" : "OFF";

    const seedVal = el("ivSeedVal");
    if (seedVal && state.params && state.params.iv){
      seedVal.textContent = String(state.params.iv.seed ?? IV_DEFAULT.seed);
    }
    const btn = el("btnIVRandom");
    if (btn){
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? "1" : "0.6";
    }
  }

  function updateViewRangeUI(){
    const yMin = 1850;
    const yMax = 2100;

    // Clamp & order
    state.viewStart = clamp(Math.round(Number(state.viewStart ?? yMin)), yMin, yMax);
    state.viewEnd = clamp(Math.round(Number(state.viewEnd ?? yMax)), yMin, yMax);
    if (state.viewStart > state.viewEnd){
      const t = state.viewStart;
      state.viewStart = state.viewEnd;
      state.viewEnd = t;
    }

    const s = el("viewStart");
    const e = el("viewEnd");
    if (s) s.value = String(state.viewStart);
    if (e) e.value = String(state.viewEnd);

    const sv = el("viewStartVal");
    const ev = el("viewEndVal");
    if (sv) sv.textContent = String(state.viewStart);
    if (ev) ev.textContent = String(state.viewEnd);

    const lbl = el("viewRangeLabel");
    if (lbl) lbl.textContent = `${state.viewStart}–${state.viewEnd}`;

    const sr = el("scenarioRange");
    if (sr) sr.textContent = `View: ${state.viewStart} – ${state.viewEnd}`;
  }

  function viewIndices(years){
    const y0 = Math.min(state.viewStart ?? years[0], state.viewEnd ?? years[years.length-1]);
    const y1 = Math.max(state.viewStart ?? years[0], state.viewEnd ?? years[years.length-1]);
    const idx = [];
    for (let i=0; i<years.length; i++){
      const y = years[i];
      if (y >= y0 && y <= y1) idx.push(i);
    }
    return idx;
  }
  function pickByIdx(arr, idx){ return idx.map(i=>arr[i]); }


  function renderScenarioHeader(){
    const meta = currentScenarioMeta();
    el("scenarioBar").textContent = meta ? `${meta.name} (${meta.key})` : "";
    el("scenarioName").textContent = meta ? `${meta.name} (${meta.key})` : "";
    el("scenarioBlurb").textContent = meta ? meta.desc : "";
    const thumb = document.querySelector("#viewScenario .scenario-header .thumb");
    if (thumb){
      const img = meta && (meta.img || (meta.group === "user" ? "assets/img/scenarios/custom.png" : null));
      thumb.style.backgroundImage = img ? `url('${img}')` : "";
      thumb.style.backgroundSize = "cover";
      thumb.style.backgroundPosition = "center";
    }
  }

  function renderInputCharts(){
    const rows = getScenarioRows(state.scenario);
    const yearsAll = rows.map(r=>r.year);
    const working = buildWorkingRows();
    const idx = viewIndices(yearsAll);
    const years = pickByIdx(yearsAll, idx);

    for (const meta of INPUT_VARS){
      const baseAll = rows.map(r=>r[meta.col]);
      const effAll = working.map(r=>r[meta.col]);
      const base = pickByIdx(baseAll, idx);
      const eff = pickByIdx(effAll, idx);
      const enabled = !!state.toggles[meta.toggle];

      plotLines(el(meta.canvas), [
        {x: years, y: base, label:"SSP", color:"rgba(0,0,0,0.25)", width:1.5},
        {x: years, y: eff, label: enabled ? "used" : "disabled", color: enabled ? "#4d8bff" : "rgba(0,0,0,0.22)", width:2}
      ], {yLabel: meta.units, yDigits: meta.yDigits, vline:2020, legend:false});
    }
  }

  
  function renderMiniInputs(){
    const rows = getScenarioRows(state.scenario);
    const yearsAll = rows.map(r=>r.year);
    const working = buildWorkingRows();
    const idx = viewIndices(yearsAll);
    const years = pickByIdx(yearsAll, idx);

    const mk = (vals, enabled) => ({
      x: years, y: pickByIdx(vals, idx),
      label: "",
      color: enabled ? "#4d8bff" : "rgba(0,0,0,0.22)",
      width: 2
    });

    for (const meta of INPUT_VARS){
      plotLines(el(meta.mini), [
        mk(working.map(r=>r[meta.col]), !!state.toggles[meta.toggle])
      ], {yLabel: meta.units, yDigits: meta.yDigits, vline:2020, legend:false, xTicks:4, yTicks:4});
    }
  }

  
  function updateOutputVisibility(){
    el("blockLocal").style.display = state.outputPanels.local ? "" : "none";
    el("blockSeaLevel").style.display = state.outputPanels.sea ? "" : "none";
    el("blockConc").style.display = state.outputPanels.conc ? "" : "none";
    el("blockCarbon").style.display = state.outputPanels.carbon ? "" : "none";
    el("blockPH").style.display = state.outputPanels.ph ? "" : "none";
    el("blockF").style.display = state.outputPanels.f ? "" : "none";
  }

  function renderOutputs(){
    if (!state.lastOutput) return;
    const outAll = state.lastOutput.out;
    const y0 = Math.min(state.viewStart ?? 1850, state.viewEnd ?? 2100);
    const y1 = Math.max(state.viewStart ?? 1850, state.viewEnd ?? 2100);
    const out = outAll.filter(r=>r.year>=y0 && r.year<=y1);
    const years = out.map(r=>r.year);

    // Temperature always
    // For consistent comparison, show anomalies relative to 1850–1900.
    const baseWin = outAll.filter(r=>r.year>=1850 && r.year<=1900);
    const baseT = baseWin.reduce((a,b)=>a+(b.T||0),0)/Math.max(1,baseWin.length);
    const baseTl = baseWin.reduce((a,b)=>a+(b.Tl||0),0)/Math.max(1,baseWin.length);

    const tempSeries = [];
    const tempBands = [];

    // Optional comparison overlays (Advanced mode)
    if (state.uiMode === "advanced"){
      const ylo = y0, yhi = y1;

      function sliceSeries(yearsArr, valsArr){
        const xs=[], ys=[];
        for (let i=0;i<yearsArr.length;i++){
          const yy = yearsArr[i];
          if (yy<ylo || yy>yhi) continue;
          xs.push(yy);
          ys.push(valsArr[i]);
        }
        return {xs, ys};
      }

      // Observations
      if (state.compare.hadcrut){
        const s = COMPARE_DATA.obs.hadcrut5;
        const cut = sliceSeries(s.years, s.values);
        tempSeries.push({label:"HadCRUT5 (obs)", x:cut.xs, y:cut.ys, color:"#000000", width:1.6});
      }
      if (state.compare.gistemp){
        const s = COMPARE_DATA.obs.gistemp;
        const cut = sliceSeries(s.years, s.values);
        tempSeries.push({label:"GISTEMP (obs)", x:cut.xs, y:cut.ys, color:"#2ca02c", width:1.6});
      }
      if (state.compare.berkeley){
        const s = COMPARE_DATA.obs.berkeley;
        const cut = sliceSeries(s.years, s.values);
        tempSeries.push({label:"Berkeley (obs)", x:cut.xs, y:cut.ys, color:"#ff7f0e", width:1.6});
      }

      // CMIP6
      const scenKey = (state.scenario||"ssp245").toLowerCase();
      const cm = COMPARE_DATA.cmip6[scenKey];
      if (cm && state.compare.cmip){
        const lo = sliceSeries(cm.years, cm.p05);
        const hi = sliceSeries(cm.years, cm.p95);
        const mid = sliceSeries(cm.years, cm.mean);

        // Translucent uncertainty band (5–95%) + multi-model mean line
        if (mid.xs.length){
          // Use mid.xs as the shared x array (years are identical across these series)
          tempBands.push({label:"CMIP6 5–95%", x: mid.xs, y0: lo.ys, y1: hi.ys, color:"rgba(148,103,189,0.18)"});
          tempSeries.push({label:"CMIP6 mean", x:mid.xs, y:mid.ys, color:"#9467bd", width:1.8});
        }
      }
    }

    // Model output (on top)
    tempSeries.push({label:"Surface (model)", x:years, y: out.map(r=>r.T-baseT), color:"#1f77b4", width:2.4});
    tempSeries.push({label:"Deep ocean (model)", x:years, y: out.map(r=>r.Tl-baseTl), color:"#555555", width:2.1});

    plotLines(el("plotOutTemp"), tempSeries, {yLabel:"Temperature anomaly (°C rel. 1850–1900)", yDigits:2, bands: tempBands});

    if (state.outputPanels.local){
      syncLocalInputs();
      renderPatternMap();
      renderLocalSeries(years, out.map(r=>((r.T||0)-baseT)));
    }

    if (state.outputPanels.sea){
      plotStackedPositive(el("plotOutSL"), years, [
        {label:"Thermal", y: out.map(r=>r.SL_therm_m), color:"#4d8bff"},
        {label:"Land ice", y: out.map(r=>r.SL_ice_m), color:"#f0a23a"},
      ], {yLabel:"Sea level rise (m rel. 1850)", yDigits:3});
    }

    if (state.outputPanels.conc){
      const series = [];
      if (state.concLines.CO2){
        series.push({label:"CO₂ (ppm)", x:years, y: out.map(r=>r.CO2_ppm), color:"#4d8bff"});
      }
      if (state.concLines.CH4){
        series.push({label:"CH₄ (ppb)", x:years, y: out.map(r=>r.CH4_ppb), color:"#111111"});
      }
      if (state.concLines.N2O){
        const C0 = 270; // ppb (approx 1850 / preindustrial)
        const s0 = Math.sqrt(C0);
        const yN2O = out.map(r=>{
          const s = s0 + (r.F_n2o/0.12);
          const Ct = Math.max(s, 0) ** 2;
          return Ct;
        });
        series.push({label:"N₂O (ppb, implied)", x:years, y: yN2O, color:"#7a4ddc"});
      }
      if (state.concLines.OTHER){
        const yO = out.map(r=> (1000 * r.F_other / 0.32)); // ppt-equivalent
        series.push({label:"Other WMGHG (ppt-eq, implied)", x:years, y: yO, color:"#f0a23a"});
      }

      // If all are unchecked, draw an empty frame.
      if (series.length === 0){
        series.push({label:"(no series selected)", x:years, y: years.map(()=>NaN), color:"#999999"});
      }

      plotLines(el("plotOutConc"), series, {yLabel:"Concentration (ppm / ppb / ppt-eq)", yDigits:2});
    }

    if (state.outputPanels.carbon){
      const series = [];
      if (state.carbonLines.atm){
        series.push({label:"Atmosphere (GtC)", x:years, y: out.map(r=>r.Ca_GtC), color:"#4d8bff"});
      }
      if (state.carbonLines.veg){
        series.push({label:"Vegetation (GtC)", x:years, y: out.map(r=>r.Cv_GtC), color:"#2aa876"});
      }
      if (state.carbonLines.soil){
        series.push({label:"Soil (GtC)", x:years, y: out.map(r=>r.Cs_GtC), color:"#f0a23a"});
      }
      if (state.carbonLines.upper){
        series.push({label:"Upper ocean (GtC)", x:years, y: out.map(r=>r.Cu_GtC), color:"#2b3a42"});
      }
      if (state.carbonLines.deep){
        series.push({label:"Deep ocean (GtC)", x:years, y: out.map(r=>r.Cl_GtC), color:"#7a4ddc"});
      }

      if (series.length === 0){
        series.push({label:"(no pools selected)", x:years, y: years.map(()=>NaN), color:"#999999"});
      }

      plotLines(el("plotOutCarbon"), series, {yLabel:"Carbon stock (GtC)", yDigits:1});
    }

    if (state.outputPanels.ph){
      plotLines(el("plotOutPH"), [
        {label:"pH", x:years, y: out.map(r=>r.pH), color:"#2b3a42"},
      ], {yLabel:"Surface ocean pH", yDigits:3});
    }

    if (state.outputPanels.f){
      const series = [];
      if (state.forcingLines.total){
        series.push({label:"Total", x:years, y: out.map(r=>r.F_total), color:"#111111"});
      }
      if (state.forcingLines.co2){
        series.push({label:"CO₂", x:years, y: out.map(r=>r.F_co2), color:"#4d8bff"});
      }
      if (state.forcingLines.ch4){
        series.push({label:"CH₄", x:years, y: out.map(r=>r.F_ch4), color:"#2aa876"});
      }
      if (state.forcingLines.n2o){
        series.push({label:"N₂O", x:years, y: out.map(r=>r.F_n2o), color:"#7a4ddc"});
      }
      if (state.forcingLines.other){
        series.push({label:"Other WMGHG", x:years, y: out.map(r=>r.F_other), color:"#f0a23a"});
      }
      if (state.forcingLines.o3){
        series.push({label:"Ozone", x:years, y: out.map(r=>r.F_o3), color:"#d14b7a"});
      }
      if (state.forcingLines.aer){
        series.push({label:"Aerosol", x:years, y: out.map(r=>r.F_aer), color:"#6b7c93"});
      }
      if (state.forcingLines.solar){
        series.push({label:"Solar", x:years, y: out.map(r=>r.F_solar), color:"#c23b22"});
      }
      if (state.forcingLines.volc){
        series.push({label:"Volcanic", x:years, y: out.map(r=>r.F_volc), color:"#444444"});
      }

      if (series.length === 0){
        series.push({label:"(no components selected)", x:years, y: years.map(()=>NaN), color:"#999999"});
      }

      plotLines(el("plotOutF"), series, {yLabel:"Effective radiative forcing (W/m²)", yDigits:2});
    }
  }

  function updateFloatPanel(){
    const panel = el("floatPanel");
    if (!panel) return;
    const inScenario = (state.mode === "edit" || state.mode === "output");
    panel.style.display = inScenario ? "" : "none";
    if (!inScenario) return;
    const isOutput = (state.mode === "output");
    const outBlock = el("fpOutputs");
    if (outBlock) outBlock.style.display = isOutput ? "" : "none";
    const addCmp = el("fpAddCompare");
    if (addCmp) addCmp.style.display = (isOutput && state.lastOutput) ? "" : "none";
  }

  function renderAll(){
    setModeButtons();
    updateEditBadges();
    updateFloatPanel();

    if (state.mode === "home"){
      show("home");
      state.lastOutput = null;
      renderHome();
      setActiveSidebar();
      return;
    }

    if (state.mode === "compare"){
      show("compare");
      setActiveSidebar();
      if (typeof renderCompare === "function") renderCompare();
      return;
    }

    // scenario view
    show("scenario");
    setActiveSidebar();
    renderScenarioHeader();
    updateToggleLabels();
    updateIVToggle();
    updateViewRangeUI();

    const isOutput = (state.mode === "output");

    // Internal variability toggle is only intended to be changed before a run.
    if (el("togIV")) el("togIV").disabled = isOutput;

    // Header buttons
    el("btnRun").style.display = isOutput ? "none" : "";
    el("btnContinue").style.display = isOutput ? "" : "none";

    // Export outputs button (in controls panel)
    if (el("btnExportOutput")){
      el("btnExportOutput").disabled = !(isOutput && state.lastOutput);
    }

    el("editMode").style.display = isOutput ? "none" : "";
    el("editInfoBar").style.display = isOutput ? "none" : "";
    el("outputMode").style.display = isOutput ? "" : "none";

    if (!isOutput){
      renderInputCharts();
    } else {
      // sync output toggle checkboxes
      el("outSeaLevel").checked = state.outputPanels.sea;
      el("outConc").checked = state.outputPanels.conc;
      el("outCarbon").checked = state.outputPanels.carbon;
      el("outPH").checked = state.outputPanels.ph;
      el("outF").checked = state.outputPanels.f;
      el("outLocal").checked = state.outputPanels.local;
      el("outLocal").disabled = !PATTERN;
      if (!PATTERN){ state.outputPanels.local = false; el("outLocal").checked = false; }

      // sync compare checkboxes (Advanced mode)
      if (el("cmpHadCRUT")) el("cmpHadCRUT").checked = state.compare.hadcrut;
      if (el("cmpGISTEMP")) el("cmpGISTEMP").checked = state.compare.gistemp;
      if (el("cmpBerkeley")) el("cmpBerkeley").checked = state.compare.berkeley;
      if (el("cmpCMIP")) el("cmpCMIP").checked = state.compare.cmip;


      // sync in-panel toggles
      el("concCO2").checked = state.concLines.CO2;
      el("concCH4").checked = state.concLines.CH4;
      el("concN2O").checked = state.concLines.N2O;
      el("concOTHER").checked = state.concLines.OTHER;

      el("carbAtm").checked = state.carbonLines.atm;
      el("carbVeg").checked = state.carbonLines.veg;
      el("carbSoil").checked = state.carbonLines.soil;
      el("carbUpper").checked = state.carbonLines.upper;
      el("carbDeep").checked = state.carbonLines.deep;

      el("fShowTotal").checked = state.forcingLines.total;
      el("fShowCO2").checked = state.forcingLines.co2;
      el("fShowCH4").checked = state.forcingLines.ch4;
      el("fShowN2O").checked = state.forcingLines.n2o;
      el("fShowOther").checked = state.forcingLines.other;
      el("fShowO3").checked = state.forcingLines.o3;
      el("fShowAER").checked = state.forcingLines.aer;
      el("fShowSolar").checked = state.forcingLines.solar;
      el("fShowVolc").checked = state.forcingLines.volc;

      updateOutputVisibility();
      renderMiniInputs();
      renderOutputs();
    }

    // Ensure resizable chart handles exist (output charts)
    initChartResizers();
  }

  // ========================
  // Scenario selection
  // ========================
  function selectScenario(key){
    state.scenario = key;
    state.mode = "edit";
    state.toggles = {...DEFAULTS.toggles};
    state.params = JSON.parse(JSON.stringify(DEFAULTS.params));
    state.outputPanels = {...DEFAULTS.outputPanels};
    state.local = {...DEFAULTS.local};
    state.concLines = {...DEFAULTS.concLines};
    state.carbonLines = {...DEFAULTS.carbonLines};
    state.forcingLines = {...DEFAULTS.forcingLines};
    state.customSeries = {};
    state.curveDetailPerVar = {};
    state.lastOutput = null;
    renderAll();
  }

