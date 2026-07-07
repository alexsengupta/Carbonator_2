  // ========================
  // Data table
  // ========================
  // Input columns/display names follow the input mode (emissions vs full ERF)
  function inputsHeaderMap(){
    if (state.inputMode === "emissions"){
      return [
        ["year","Year"],
        ["E_CO2_GtC_yr","CO₂ emissions (GtC/yr)"],
        ["E_CH4_TgCH4_yr","CH₄ emissions (TgCH₄/yr)"],
        ["E_SO2_Tg_yr","Aerosol emissions (Tg SO₂/yr)"],
        ["E_volcAOD_yr","Volcanic aerosol injection (AOD/yr)"],
        ["ERF_solar_rel1850_Wm2","Solar ERF (W/m² rel. 1850)"],
      ];
    }
    return [
      ["year","Year"],
      ["E_CO2_GtC_yr","CO₂ emissions (GtC/yr)"],
      ["E_CH4_TgCH4_yr","CH₄ emissions (TgCH₄/yr)"],
      ["ERF_aerosol_rel1850_Wm2","Aerosol ERF (W/m² rel. 1850)"],
      ["ERF_o3_total_rel1850_Wm2","Ozone ERF (W/m² rel. 1850)"],
      ["ERF_N2O_rel1850_Wm2","N₂O ERF (W/m² rel. 1850)"],
      ["ERF_otherWMGHG_rel1850_Wm2","Other WMGHG ERF (W/m² rel. 1850)"],
      ["ERF_volcanic_rel1850_Wm2","Volcanic ERF (W/m² rel. 1850)"],
      ["ERF_solar_rel1850_Wm2","Solar ERF (W/m² rel. 1850)"],
    ];
  }

  function openDataTable(){
    const rowsAll = buildWorkingRows();
    const y0 = Math.min(state.viewStart ?? 1850, state.viewEnd ?? 2100);
    const y1 = Math.max(state.viewStart ?? 1850, state.viewEnd ?? 2100);
    const rows = rowsAll.filter(r=>r.year>=y0 && r.year<=y1);
    const keyCols = inputsHeaderMap();
    const tableWrap = document.createElement("div");
    tableWrap.className = "table-wrap";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const [,label] of keyCols){
      const th = document.createElement("th");
      th.textContent = label;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const r of rows){
      const tr = document.createElement("tr");
      for (const [k] of keyCols){
        const td = document.createElement("td");
        if (k === "year") td.textContent = r[k];
        else td.textContent = fmt(r[k], 3);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    const wrap = document.createElement("div");
    wrap.appendChild(tableWrap);
    const meta = currentScenarioMeta();
    wrap.insertAdjacentHTML("afterbegin", `<p style="margin-top:0; font-size:13px;">Scenario: <b>${meta.name} (${meta.key})</b></p>`);
    openModal("Input data table", wrap);
  }

  function downloadScenarioInputs(){
    const rows = buildWorkingRows();
    const headerMap = inputsHeaderMap();
    const cols = headerMap.map(d=>d[0]);

    const lines = [];
    lines.push(["scenario", ...headerMap.map(d=>csvAsciiHeader(d[1]))].join(","));
    for (const r of rows){
      lines.push([state.scenario, ...cols.map(c=>r[c])].join(","));
    }
    const filename = promptFilename(`${state.scenario}_inputs.csv`);
    if (!filename) return;
    downloadText(filename, lines.join("\n"), "text/csv");
  }

  function exportOutputCSV(){
    if (!state.lastOutput) return;
    const out = state.lastOutput.out;

    const headerMap = OUTPUT_HEADER_MAP;
    const cols = headerMap.map(d=>d[0]);
    const lines = [];
    lines.push(["scenario", ...headerMap.map(d=>csvAsciiHeader(d[1]))].join(","));

    // Derived series for export
    const C0 = 270; // ppb (approx 1850 / preindustrial)
    const s0 = Math.sqrt(C0);

    for (const r of out){
      const derived = {
        N2O_ppb_implied: (Math.max(s0 + (r.F_n2o/0.12), 0) ** 2),
        OtherWMGHG_ppt_eq_implied: (1000 * r.F_other / 0.32),
      };
      lines.push([
        state.scenario,
        ...cols.map(c=>{
          if (c in derived) return derived[c];
          return r[c];
        })
      ].join(","));
    }

    const filename = promptFilename(`${state.scenario}_outputs.csv`);
    if (!filename) return;
    downloadText(filename, lines.join("\n"), "text/csv");
  }

  // ========================
  // About
  // ========================
  function openAbout(){
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p style="margin-top:0; font-size:13px; line-height:1.35;">
        <b>SSP Carbonator</b> is a lightweight teaching tool that runs in your browser (no server).
        It uses a two-layer energy balance model and simple carbon-cycle / methane models based on the appendix of
        Sherwood et&nbsp;al. (2022, <i>Environmental Research Letters</i> 17 064022).
      </p>
      <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.35;">
        <li>Inputs are from an RCMIP v5.1.0 SSP forcing & emissions dataset (World, 1850–2100), rebased to 1850.</li>
        <li><b>Basic mode</b>: toggle inputs on/off and run the model.</li>
        <li><b>Advanced mode</b>: edit parameters and edit input curves via draggable control points.</li>
        <li>Advanced mode also supports optional stochastic “internal variability” (ENSO-like) via energy-conserving heat exchange.</li>
        <li>Sea level is a simple semi-empirical teaching model (thermal + land ice).</li>
      </ul>
      <p style="font-size:12px; color:#555; line-height:1.35; margin-bottom:0;">
        Tip: turn off aerosols to demonstrate “unmasking”; use the forcing decomposition panel to show what drives temperature.
      </p>
    `;
    openModal("About", wrap);
  }

  // ========================
  // Events
  // ========================
  function bindToggle(id, key){
    el(id).addEventListener("change", () => {
      state.toggles[key] = el(id).checked;
      updateToggleLabels();
      renderInputCharts();
    });
  }
  bindToggle("togCO2","CO2");
  bindToggle("togCH4","CH4");
  bindToggle("togAER","AER");
  bindToggle("togO3","O3");
  bindToggle("togN2O","N2O");
  bindToggle("togOTHER","OTHER");
  bindToggle("togVOLC","VOLC");
  bindToggle("togSOLAR","SOLAR");

  // simple (emissions) vs full (ERF) inputs
  if (el("togFullModel")){
    el("togFullModel").addEventListener("change", ()=>{
      setInputMode(el("togFullModel").checked ? "full" : "emissions");
    });
  }

  // internal variability toggle (energy-conserving; default settings unless edited in Advanced)
  el("togIV").addEventListener("change", ()=>{
    if (!state.params.iv) state.params.iv = {...IV_DEFAULT};
    state.params.iv.enabled = el("togIV").checked;
    updateIVToggle();
    updateEditBadges();
  });

  // New random realisation (Advanced): choose a new seed and (if already run) re-run.
  if (el("btnIVRandom")){
    el("btnIVRandom").addEventListener("click", ()=>{
      if (!state.params.iv) state.params.iv = {...IV_DEFAULT};
      if (!state.params.iv.enabled) return;
      state.params.iv.seed = Math.floor(Math.random()*1e9) + 1;
      updateIVToggle();
      updateEditBadges();

      if (state.mode === "output"){
        const rows = buildWorkingRows();
        state.lastOutput = runModel(rows, {...state.params, inputMode: state.inputMode});
      }
      renderAll();
    });
  }

  // View window sliders (Advanced): zoom display without re-running the model
  function rerenderForViewWindow(){
    if (!state.scenario) return;
    updateViewRangeUI();
    if (state.mode === "edit") renderInputCharts();
    if (state.mode === "output"){ renderMiniInputs(); renderOutputs(); }
  }

  if (el("viewStart")){
    el("viewStart").addEventListener("input", ()=>{
      state.viewStart = Number(el("viewStart").value);
      if (state.viewStart > state.viewEnd){
        state.viewEnd = state.viewStart;
        if (el("viewEnd")) el("viewEnd").value = String(state.viewEnd);
      }
      rerenderForViewWindow();
    });
  }
  if (el("viewEnd")){
    el("viewEnd").addEventListener("input", ()=>{
      state.viewEnd = Number(el("viewEnd").value);
      if (state.viewEnd < state.viewStart){
        state.viewStart = state.viewEnd;
        if (el("viewStart")) el("viewStart").value = String(state.viewStart);
      }
      rerenderForViewWindow();
    });
  }
  if (el("btnViewFull")){
    el("btnViewFull").addEventListener("click", ()=>{
      state.viewStart = 1850;
      state.viewEnd = 2100;
      rerenderForViewWindow();
    });
  }

  // output toggles
  el("outSeaLevel").addEventListener("change", ()=>{ state.outputPanels.sea = el("outSeaLevel").checked; renderAll(); });
  el("outConc").addEventListener("change", ()=>{ state.outputPanels.conc = el("outConc").checked; renderAll(); });
  el("outCarbon").addEventListener("change", ()=>{ state.outputPanels.carbon = el("outCarbon").checked; renderAll(); });
  el("outPH").addEventListener("change", ()=>{ state.outputPanels.ph = el("outPH").checked; renderAll(); });
  el("outF").addEventListener("change", ()=>{ state.outputPanels.f = el("outF").checked; renderAll(); });
  el("outLocal").addEventListener("change", ()=>{ state.outputPanels.local = el("outLocal").checked; renderAll(); });

  // Local pattern-scaling controls (only active if a pattern file is present)
  function setLocalFromInputs(){
    if (!PATTERN) return;
    const lat = parseFloat(el("locLat")?.value);
    const lon = parseFloat(el("locLon")?.value);
    if (Number.isFinite(lat)) state.local.lat = clamp(lat, -90, 90);
    if (Number.isFinite(lon)) state.local.lon = wrapLon180(lon);
  }
  if (el("locLat")) el("locLat").addEventListener("change", ()=>{ setLocalFromInputs(); if (state.mode==="output" && state.outputPanels.local) renderOutputs(); else renderPatternMap(); });
  if (el("locLon")) el("locLon").addEventListener("change", ()=>{ setLocalFromInputs(); if (state.mode==="output" && state.outputPanels.local) renderOutputs(); else renderPatternMap(); });
  if (el("mapVar")) el("mapVar").addEventListener("change", ()=>{ state.local.mapVar = el("mapVar").value; if (state.mode==="output" && state.outputPanels.local) { renderPatternMap(); } });

  if (el("mapCanvas")) el("mapCanvas").addEventListener("click", (ev)=>{
    if (!PATTERN) return;
    const c = el("mapCanvas");
    const rect = c.getBoundingClientRect();
    const fx = clamp((ev.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const fy = clamp((ev.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const lon = -180 + fx*360;
    const lat = 90 - fy*180;
    state.local.lon = wrapLon180(lon);
    state.local.lat = clamp(lat, -90, 90);
    syncLocalInputs();
    if (state.mode==="output" && state.outputPanels.local) renderOutputs();
    else renderPatternMap();
  });


  // compare toggles (Advanced mode)
  if (el("cmpHadCRUT")) el("cmpHadCRUT").addEventListener("change", ()=>{ state.compare.hadcrut = el("cmpHadCRUT").checked; renderAll(); });
  if (el("cmpGISTEMP")) el("cmpGISTEMP").addEventListener("change", ()=>{ state.compare.gistemp = el("cmpGISTEMP").checked; renderAll(); });
  if (el("cmpBerkeley")) el("cmpBerkeley").addEventListener("change", ()=>{ state.compare.berkeley = el("cmpBerkeley").checked; renderAll(); });
  if (el("cmpCMIP")) el("cmpCMIP").addEventListener("change", ()=>{ state.compare.cmip = el("cmpCMIP").checked; renderAll(); });


  // In-panel toggles (only affect plotting)
  function rerenderIfOutput(){
    if (state.mode === "output") renderOutputs();
  }

  ["concCO2","concCH4","concN2O","concOTHER"].forEach(id=>{
    el(id).addEventListener("change", ()=>{
      state.concLines = {
        CO2: el("concCO2").checked,
        CH4: el("concCH4").checked,
        N2O: el("concN2O").checked,
        OTHER: el("concOTHER").checked,
      };
      rerenderIfOutput();
    });
  });

  ["carbAtm","carbVeg","carbSoil","carbUpper","carbDeep"].forEach(id=>{
    el(id).addEventListener("change", ()=>{
      state.carbonLines = {
        atm: el("carbAtm").checked,
        veg: el("carbVeg").checked,
        soil: el("carbSoil").checked,
        upper: el("carbUpper").checked,
        deep: el("carbDeep").checked,
      };
      rerenderIfOutput();
    });
  });

  ["fShowTotal","fShowCO2","fShowCH4","fShowN2O","fShowOther","fShowO3","fShowAER","fShowSolar","fShowVolc"].forEach(id=>{
    el(id).addEventListener("change", ()=>{
      state.forcingLines = {
        total: el("fShowTotal").checked,
        co2: el("fShowCO2").checked,
        ch4: el("fShowCH4").checked,
        n2o: el("fShowN2O").checked,
        other: el("fShowOther").checked,
        o3: el("fShowO3").checked,
        aer: el("fShowAER").checked,
        solar: el("fShowSolar").checked,
        volc: el("fShowVolc").checked,
      };
      rerenderIfOutput();
    });
  });

  // Mode toggle buttons
  el("modeBasic").addEventListener("click", ()=>{
    state.uiMode = "basic";
    renderAll();
  });
  el("modeAdvanced").addEventListener("click", ()=>{
    state.uiMode = "advanced";
    renderAll();
  });

  // Edit curve buttons (delegated). In emissions mode the aerosol/volcanic
  // buttons edit the pseudo-emission series instead of the ERF series.
  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-edit]");
    if (!btn) return;
    let varKey = btn.getAttribute("data-edit");
    if (state.inputMode === "emissions"){
      const mv = INPUT_VARS.find(v => v.col === varKey);
      if (mv && mv.simpleCol) varKey = mv.simpleCol;
    }
    openCurveEditor(varKey);
  });

  // Run / reset
  el("btnRun").addEventListener("click", () => {
    const rows = buildWorkingRows();
    state.lastOutput = runModel(rows, {...state.params, inputMode: state.inputMode});
    state.mode = "output";
    renderAll();
  });

  el("btnContinue").addEventListener("click", () => {
    state.mode = "edit";
    renderAll();
  });

  function resetScenario(){
    state.toggles = {...DEFAULTS.toggles};
    state.params = defaultParams();
    state.outputPanels = {...DEFAULTS.outputPanels};
    state.local = {...DEFAULTS.local};
    state.concLines = {...DEFAULTS.concLines};
    state.carbonLines = {...DEFAULTS.carbonLines};
    state.forcingLines = {...DEFAULTS.forcingLines};
    state.customSeries = {};
    state.curveDetailPerVar = {};
    state.lastOutput = null;
    state.mode = "edit";
    renderAll();
  }
  el("btnReset").addEventListener("click", resetScenario);

  // Home buttons
  el("btnStartDefault").addEventListener("click", ()=>selectScenario("ssp245"));
  el("btnHomeTop").addEventListener("click", ()=>{ state.mode="home"; state.scenario=null; state.lastOutput=null; renderAll(); });
  el("btnAboutTop").addEventListener("click", ()=>openAbout());
  el("btnOpenInputsCSV").addEventListener("click", ()=>downloadText("rcmip_v5.1.0_collated_forcing_emissions_annualfilled_ssp119_ssp126_ssp245_ssp585_World_1850-2100.csv", CSV_DATA_TEXT.trim(), "text/csv"));

  el("btnViewData").addEventListener("click", ()=>openDataTable());

  // Floating display-controls panel: collapse/expand
  if (el("fpCollapse")){
    el("fpCollapse").addEventListener("click", ()=>{
      const body = el("fpBody");
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      el("fpCollapse").textContent = hidden ? "–" : "+";
    });
  }
  el("btnDownloadScenarioCSV").addEventListener("click", ()=>downloadScenarioInputs());
  el("btnExportOutput").addEventListener("click", ()=>exportOutputCSV());
  el("btnParams").addEventListener("click", ()=>openParams());

  // Re-render on resize for crisp charts
  window.addEventListener("resize", ()=>{
    if (state.mode === "edit") renderInputCharts();
    if (state.mode === "output") { renderMiniInputs(); updateOutputVisibility(); renderOutputs(); }
  });

  // Add manual drag handles for resizable chart boxes (works consistently across browsers)
  function initChartResizers(){
    document.querySelectorAll(".chartBox.resizable").forEach(box=>{
      if (box.querySelector(".resizeHandle")) return;

      const handle = document.createElement("div");
      handle.className = "resizeHandle";
      handle.title = "Drag to resize";
      box.appendChild(handle);

      let dragging = false;
      let startY = 0;
      let startH = 0;

      const clamp = (v, lo, hi)=>Math.max(lo, Math.min(hi, v));

      handle.addEventListener("pointerdown", (e)=>{
        dragging = true;
        startY = e.clientY;
        startH = box.getBoundingClientRect().height;
        try{ handle.setPointerCapture(e.pointerId); }catch{}
        e.preventDefault();
      });

      handle.addEventListener("pointermove", (e)=>{
        if (!dragging) return;
        const dy = e.clientY - startY;
        const newH = clamp(startH + dy, 190, 760);
        box.style.height = newH + "px";
        scheduleChartRedraw();
      });

      const end = (e)=>{
        if (!dragging) return;
        dragging = false;
        try{ handle.releasePointerCapture(e.pointerId); }catch{}
      };
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }


  // Redraw when resizable chart boxes change size (e.g. drag the corner handle)
  let _chartResizeRAF = null;
  function scheduleChartRedraw(){
    if (_chartResizeRAF) cancelAnimationFrame(_chartResizeRAF);
    _chartResizeRAF = requestAnimationFrame(()=>{
      _chartResizeRAF = null;
      if (state.mode === "edit") renderInputCharts();
      if (state.mode === "output") { renderMiniInputs(); updateOutputVisibility(); renderOutputs(); }
    });
  }

  if ("ResizeObserver" in window){
    const ro = new ResizeObserver(()=>scheduleChartRedraw());
    document.querySelectorAll(".chartBox.resizable").forEach(box => ro.observe(box));
  }


  // Boot
  renderSidebar();
  renderHome();
  state.mode = "home";
  renderAll();
