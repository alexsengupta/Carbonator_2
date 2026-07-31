  // ========================
  // Curve editor (Advanced)
  // ========================
  function openCurveEditor(varKey){
    if (state.uiMode !== "advanced") return;

    const rows = getScenarioRows(state.scenario);
    const years = rows.map(r=>r.year);
    const baseVals = rows.map(r=>r[varKey]);
    const currentVals = (state.customSeries[varKey] && state.customSeries[varKey].length===years.length)
      ? state.customSeries[varKey].slice()
      : baseVals.slice();

    const mv = INPUT_VARS.find(v => v.col === varKey || v.simpleCol === varKey);
    const metaInfo = mv
      ? (mv.simpleCol === varKey
          ? {label: mv.simpleTitle || mv.title, units: mv.simpleUnits || mv.units}
          : {label: mv.title, units: mv.units})
      : {label: varKey, units: ""};
    const title = metaInfo.label + (metaInfo.units ? ` (${metaInfo.units})` : ``);
    const level0 = state.curveDetailPerVar[varKey] ?? DEFAULTS.curveDetailLevel;
    const spacingOpts = [25,10,5,1];

    function ctrlYearsFromLevel(level){
      const step = spacingOpts[clamp(level,0,3)];
      const y0 = years[0], yN = years[years.length-1];
      const pts = [];
      for (let y=y0; y<=yN; y+=step) pts.push(y);
      if (pts[pts.length-1] !== yN) pts.push(yN);
      return pts;
    }

    let detailLevel = level0;
    let ctrlX = ctrlYearsFromLevel(detailLevel);
    let ctrlY = ctrlX.map(y=>currentVals[y-years[0]]);

    function evalCurveAt(year){
      const spline = makeMonotoneSpline(ctrlX, ctrlY);
      return spline.evalAt(year);
    }

    function resampleToNewLevel(newLevel){
      const newX = ctrlYearsFromLevel(newLevel);
      const spline = makeMonotoneSpline(ctrlX, ctrlY);
      const newY = newX.map(y=>spline.evalAt(y));
      ctrlX = newX; ctrlY = newY;
      detailLevel = newLevel;
      draw();
    }

    // Build modal UI
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div style="display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div style="flex: 1 1 520px; min-width: 520px;">
          <div style="font-size:12px; color:#333; margin-bottom:8px; line-height:1.35;">
            Drag the <b>control points</b> up/down to edit the curve. Use <b>Detail</b> to add more points (fine control for short spikes).
          </div>
          <div style="border:1px solid var(--border); background:#fff; padding:10px;">
            <canvas id="curveEditCanvas" data-height="320"></canvas>
            <div style="display:flex; gap:12px; align-items:center; margin-top:10px; flex-wrap:wrap;">
              <div style="font-size:12px; font-weight:700;">Detail</div>
              <input type="range" id="detailSlider" min="0" max="3" step="1" value="${detailLevel}" />
              <div style="font-size:12px; color:#666;" id="detailLabel"></div>
            </div>
          </div>
        </div>
        <div style="flex: 0 0 320px; min-width: 280px;">
          <div style="border:1px solid var(--border); background:#f7f8f9; padding:10px;">
            <div style="font-weight:700; font-size:12px; margin-bottom:6px;">Actions</div>
            <div style="font-size:11px; color:#666; line-height:1.35; margin-bottom:10px;">
              Grey line = original SSP. Blue line = edited curve used by the model.
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <button class="btn orange" id="applyCurve">Apply curve</button>
              <button class="btn" id="resetCurve">Reset to SSP</button>
              <button class="btn" id="cancelCurve">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const canvas = wrap.querySelector("#curveEditCanvas");
    const detailSlider = wrap.querySelector("#detailSlider");
    const detailLabel = wrap.querySelector("#detailLabel");

    function setDetailLabel(){
      const step = spacingOpts[detailLevel];
      detailLabel.textContent = `${step}-year control points`;
    }

    // drawing
    function draw(){
      setDetailLabel();
      const dpr = window.devicePixelRatio || 1;
      const h = (Number(canvas.dataset.height) || 320) * dpr;
      const w = canvas.clientWidth * dpr;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0,0,w,h);

      const pad = {l:55, r:12, t:12, b:30};
      const xMin = years[0], xMax = years[years.length-1];

      // sample curve at annual resolution for drawing
      const spline = makeMonotoneSpline(ctrlX, ctrlY);
      const yEdited = years.map(y=>spline.evalAt(y));

      const allY = baseVals.concat(yEdited).concat(ctrlY).filter(v=>Number.isFinite(v));
      let yMin = Math.min(...allY);
      let yMax = Math.max(...allY);
      if (yMin === yMax){ yMin -= 1; yMax += 1; }
      const yPad = (yMax-yMin)*0.10;
      yMin -= yPad; yMax += yPad;

      const xScale = x => pad.l*dpr + (x-xMin)/(xMax-xMin) * (w - (pad.l+pad.r)*dpr);
      const yScale = y => h - pad.b*dpr - (y-yMin)/(yMax-yMin) * (h - (pad.t+pad.b)*dpr);

      // axes
      ctx.strokeStyle = "#9aa8b3";
      ctx.lineWidth = 1*dpr;
      ctx.beginPath();
      ctx.moveTo(pad.l*dpr, pad.t*dpr);
      ctx.lineTo(pad.l*dpr, h-pad.b*dpr);
      ctx.lineTo(w-pad.r*dpr, h-pad.b*dpr);
      ctx.stroke();

      // grid
      ctx.strokeStyle = "#e0e7ed";
      const xTicks = 5, yTicks = 5;
      for (let i=0; i<=yTicks; i++){
        const yy = pad.t*dpr + (h-(pad.t+pad.b)*dpr)*i/yTicks;
        ctx.beginPath();
        ctx.moveTo(pad.l*dpr, yy);
        ctx.lineTo(w-pad.r*dpr, yy);
        ctx.stroke();
      }
      for (let i=0; i<=xTicks; i++){
        const xx = pad.l*dpr + (w-(pad.l+pad.r)*dpr)*i/xTicks;
        ctx.beginPath();
        ctx.moveTo(xx, pad.t*dpr);
        ctx.lineTo(xx, h-pad.b*dpr);
        ctx.stroke();
      }

      // labels
      ctx.fillStyle = "#444";
      ctx.font = `${11*dpr}px Arial`;

      ctx.textAlign = "right";
      for (let j=0; j<=yTicks; j++){
        const yv = yMin + (yMax-yMin)*j/yTicks;
        ctx.fillText(yv.toFixed(2), (pad.l-6)*dpr, yScale(yv)+4*dpr);
      }

      ctx.textAlign = "center";
      const xTickY = h - pad.b*dpr + 16*dpr;
      for (let i=0; i<=xTicks; i++){
        const xv = xMin + (xMax-xMin)*i/xTicks;
        ctx.fillText(Math.round(xv).toString(), xScale(xv), xTickY);
      }
      ctx.textAlign = "left";

      // axis labels (units)
      ctx.fillStyle = "#333";
      ctx.font = `${11*dpr}px Arial`;
      if (metaInfo.units){
        ctx.save();
        ctx.translate(12*dpr, (h - (pad.t+pad.b)*dpr)/2 + pad.t*dpr);
        ctx.rotate(-Math.PI/2);
        ctx.textAlign = "center";
        ctx.fillText(metaInfo.units, 0, 0);
        ctx.restore();
        ctx.textAlign = "left";
      }
      ctx.textAlign = "center";
      ctx.fillText("Year", (pad.l*dpr + (w-pad.r*dpr))/2, h-2*dpr);
      ctx.textAlign = "left";

      // base line
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1.5*dpr;
      ctx.beginPath();
      for (let i=0; i<years.length; i++){
        const xx = xScale(years[i]);
        const yy = yScale(baseVals[i]);
        if (i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
      }
      ctx.stroke();

      // edited line
      ctx.strokeStyle = "#4d8bff";
      ctx.lineWidth = 2.2*dpr;
      ctx.beginPath();
      for (let i=0; i<years.length; i++){
        const xx = xScale(years[i]);
        const yy = yScale(yEdited[i]);
        if (i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
      }
      ctx.stroke();

      // control points
      for (let i=0; i<ctrlX.length; i++){
        const xx = xScale(ctrlX[i]);
        const yy = yScale(ctrlY[i]);
        ctx.fillStyle = "#4d8bff";
        ctx.beginPath();
        ctx.arc(xx, yy, 5*dpr, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2*dpr;
        ctx.stroke();
      }

      // store scales for interaction
      draw._xScale = xScale;
      draw._yScale = yScale;
      draw._invY = (py) => {
        const yv = yMin + ( (h - pad.b*dpr - py) / (h - (pad.t+pad.b)*dpr) ) * (yMax - yMin);
        return yv;
      };
      draw._dpr = dpr;
    }

    let dragIndex = null;

    function findNearestPoint(px, py){
      const dpr = draw._dpr || 1;
      const thresh = 10*dpr;
      let best = {i:null, dist:1e18};
      for (let i=0; i<ctrlX.length; i++){
        const xx = draw._xScale(ctrlX[i]);
        const yy = draw._yScale(ctrlY[i]);
        const dx = px-xx, dy = py-yy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < best.dist){
          best = {i, dist};
        }
      }
      if (best.dist <= thresh) return best.i;
      return null;
    }

    canvas.addEventListener("pointerdown", (e)=>{
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = (e.clientX - rect.left) * dpr;
      const py = (e.clientY - rect.top) * dpr;
      const idx = findNearestPoint(px, py);
      if (idx !== null){
        dragIndex = idx;
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener("pointermove", (e)=>{
      if (dragIndex === null) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const py = (e.clientY - rect.top) * dpr;
      const newY = draw._invY(py);
      ctrlY[dragIndex] = newY;
      draw();
    });
    canvas.addEventListener("pointerup", ()=>{
      dragIndex = null;
    });
    canvas.addEventListener("pointercancel", ()=>{
      dragIndex = null;
    });

    detailSlider.addEventListener("input", ()=>{
      const newLevel = Number(detailSlider.value);
      resampleToNewLevel(newLevel);
    });

    wrap.querySelector("#cancelCurve").addEventListener("click", ()=>{
      closeModal();
    });

    wrap.querySelector("#resetCurve").addEventListener("click", ()=>{
      // clear custom series
      delete state.customSeries[varKey];
      updateEditBadges();
      updateIVToggle();
      closeModal();
      renderInputCharts();
    });

    wrap.querySelector("#applyCurve").addEventListener("click", ()=>{
      // compute annual values from spline
      const spline = makeMonotoneSpline(ctrlX, ctrlY);
      const newVals = years.map(y=>spline.evalAt(y));
      // if essentially equal to base, clear
      let maxDiff = 0;
      for (let i=0; i<years.length; i++){
        const d = Math.abs(newVals[i] - baseVals[i]);
        if (d > maxDiff) maxDiff = d;
      }
      if (maxDiff < 1e-10){
        delete state.customSeries[varKey];
      } else {
        state.customSeries[varKey] = newVals;
        state.curveDetailPerVar[varKey] = detailLevel;
      }
      updateEditBadges();
      updateIVToggle();
      closeModal();
      renderInputCharts();
    });

    openModal("Edit input curve", wrap);
    // ensure canvas is visible before drawing
    setTimeout(()=>draw(), 0);
  }

  // ========================
  // Parameter editor (Advanced)
  // ========================
  function openParams(){
    if (state.uiMode !== "advanced") return;

    // Work on a local copy; only commit to `state.params` on Apply.
    const tmp = {
      S: state.params.S,
      cu: state.params.cu,
      cl: state.params.cl,
      gamma: state.params.gamma,
      carbonConfig: state.params.carbonConfig,
      carbonOverrides: {...(state.params.carbonOverrides||{})},
      methaneOverrides: {...(state.params.methaneOverrides||{})},
      seaOverrides: {...(state.params.seaOverrides||{})},
      gasOverrides: {...(state.params.gasOverrides||{})},
      iv: {...((state.params.iv)||IV_DEFAULT)}
    };

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="paramViewSwitch">
        <button type="button" class="btn orange" id="pvDiagram">Diagram</button>
        <button type="button" class="btn" id="pvTable">Table</button>
        <span class="tiny" style="color:#5b5b5b; font-size:11.5px;">
          The diagram shows each value on the part of the model it controls.
        </span>
      </div>

      <div id="paramDiagramHost"></div>

      <div id="paramTableHost" style="display:none;">
      <p style="margin-top:0; font-size:13px; line-height:1.35;">
        Advanced mode: adjust parameters and re-run the scenario. “Plausible” ranges are indicative; you can explore beyond them.
      </p>

      <div class="param-section">
        <h3>Climate / Energy balance model</h3>
        <div class="param-grid" id="gridClimate"></div>
      </div>

      <div class="param-section">
        <h3>Carbon cycle</h3>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:6px;">
          <div style="font-size:12px; font-weight:700; display:flex; align-items:center; gap:6px;">
            Configuration
            <button type="button" class="infoBtn" id="carbonCfgInfo" title="What do these configs mean?">i</button>
          </div>
          <select id="carbonCfgSelect" style="width:160px;">
            <option value="1">Config 1</option>
            <option value="2">Config 2</option>
            <option value="3">Config 3</option>
            <option value="4">Config 4</option>
          </select>
          <span style="font-size:11px; color:#666;">Changing the configuration resets carbon parameters to that configuration.</span>
        </div>
        <div id="carbonCfgHelp" style="display:none; font-size:12px; line-height:1.35; color:#444; background:#f7f7f7; border:1px solid #d9e1e8; padding:8px; border-radius:6px; margin-bottom:10px;">
          <b>Configs 1–4</b> are the four carbon-cycle parameter sets reported in Sherwood et&nbsp;al. (2022, Table&nbsp;1). They were selected to match historical CO₂ and to span a range of carbon-cycle behaviour seen in more complex models (e.g. different CO₂ drawdown rates after emissions stop). In Advanced mode you can override any parameter; use the dropdown to reset back to one of the published configurations.
        </div>
        <div class="param-grid" id="gridCarbon"></div>
      </div>

      <div class="param-section">
        <h3>Methane lifetime model</h3>
        <div class="param-grid" id="gridMethane"></div>
      </div>

      <div class="param-section">
        <h3>Sea level model</h3>
        <div class="param-grid" id="gridSea"></div>
      </div>

      <div class="param-section">
        <h3>Internal variability (stochastic)</h3>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:6px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700;">
            <input type="checkbox" id="ivEnable" />
            Ocean mixing (ENSO-like)
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700;">
            <input type="checkbox" id="ivCloudEnable" />
            Clouds &amp; sun (radiative)
          </label>
          <button class="btn" type="button" id="ivNewSeed" title="Choose a new random seed for the variability realisation">New seed</button>
          <span style="font-size:11px; color:#666;">Energy-conserving heat exchange between upper &amp; deep ocean (damped oscillator; ENSO-like).</span>
        </div>
        <div class="param-grid" id="gridIV"></div>
      </div>

      </div>

      <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; align-items:center;">
        <button class="btn orange" id="applyParams">Apply</button>
        <button class="btn" id="resetParams">Reset to defaults</button>
        <span id="paramEditedNote" class="tiny" style="color:#8a5a12; font-size:11.5px;"></span>
      </div>
    `;

    const gridClimate = wrap.querySelector("#gridClimate");
    const gridCarbon = wrap.querySelector("#gridCarbon");
    const gridMethane = wrap.querySelector("#gridMethane");
    const gridSea = wrap.querySelector("#gridSea");
    const gridIV = wrap.querySelector("#gridIV");

    function addSliderBox(parent, {key,label,min,max,step,help,plausible}){
      const box = document.createElement("div");
      box.className = "param";
      const val = tmp[key];
      box.innerHTML = `
        <div class="pname">${label}</div>
        <div class="phelp">${help}</div>
        <div class="prow">
          <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${key}" />
          <input type="number" step="${step}" value="${val}" data-n="${key}" />
        </div>
        <div class="range">${plausible || ""}</div>
      `;
      const r = box.querySelector('input[type="range"]');
      const n = box.querySelector('input[type="number"]');
      r.addEventListener("input", ()=>{ n.value = r.value; });
      // Let users type outside slider bounds; the slider just tracks within its own range.
      n.addEventListener("input", ()=>{ if (n.value !== "") r.value = clamp(Number(n.value), Number(min), Number(max)); });
      parent.appendChild(box);
    }

    addSliderBox(gridClimate, {
      key:"S",
      label:"Climate sensitivity (S, °C per doubling)",
      min:0.5, max:10.0, step:0.1,
      help:"Higher S produces larger long-term warming for the same forcing.",
      plausible:"Plausible (teaching): 1.5–6"
    });
    addSliderBox(gridClimate, {
      key:"gamma",
      label:"Ocean heat exchange (γ, W m⁻² K⁻¹)",
      min:0.0, max:5.0, step:0.05,
      help:"Heat transfer from upper to deep ocean (affects transient warming).",
      plausible:"Plausible (teaching): ~0.3–1.5"
    });
    addSliderBox(gridClimate, {
      key:"cu",
      label:"Upper-ocean heat capacity (cᵤ, W·yr m⁻² K⁻¹)",
      min:0.1, max:40.0, step:0.5,
      help:"Larger cᵤ slows year-to-year temperature changes.",
      plausible:"Plausible (teaching): ~4–15"
    });
    addSliderBox(gridClimate, {
      key:"cl",
      label:"Deep-ocean heat capacity (cₗ, W·yr m⁻² K⁻¹)",
      min:10, max:500, step:5,
      help:"Larger cₗ slows deep-ocean warming and heat uptake.",
      plausible:"Plausible (teaching): ~70–200"
    });

    // Carbon config selector (local)
    const carbonCfgSelect = wrap.querySelector("#carbonCfgSelect");
    carbonCfgSelect.value = String(tmp.carbonConfig);

    const carbonCfgInfo = wrap.querySelector("#carbonCfgInfo");
    const carbonCfgHelp = wrap.querySelector("#carbonCfgHelp");
    if (carbonCfgInfo && carbonCfgHelp){
      carbonCfgInfo.addEventListener("click", ()=>{
        carbonCfgHelp.style.display = (carbonCfgHelp.style.display === "none") ? "" : "none";
      });
    }

    const carbonFields = [
      {key:"m", label:"m", step:"0.001", help:"Vegetation turnover rate (yr⁻¹)."},
      {key:"delta", label:"δ", step:"0.001", help:"Soil turnover rate (yr⁻¹)."},
      {key:"a2_per_1e3Gt", label:"a₂ (per 1000 GtC)", step:"0.001", help:"Carbon–climate feedback scaling."},
      {key:"ka", label:"kₐ", step:"0.001", help:"Air–ocean exchange rate (yr⁻¹)."},
      {key:"kd", label:"k_d", step:"0.001", help:"Upper-to-deep ocean mixing rate (yr⁻¹)."},
      {key:"eps", label:"ε", step:"0.01", help:"Fraction of plant carbon entering soil."},
      {key:"d", label:"d", step:"0.1", help:"Deep ocean scaling parameter."},
      {key:"A", label:"A", step:"0.1", help:"Carbonate chemistry scaling."},
      {key:"Alk", label:"Alk", step:"1", help:"Alkalinity parameter (constant in configs)."},
      {key:"k1", label:"k₁", step:"1e-8", help:"Carbonate chemistry constant."},
      {key:"k2", label:"k₂", step:"1e-11", help:"Carbonate chemistry constant."},
      {key:"Cu0", label:"Cu₀", step:"1", help:"Initial upper-ocean carbon (GtC)."},
      {key:"Cl0_1e3Gt", label:"Cl₀ (×1000 GtC)", step:"0.01", help:"Initial deep-ocean carbon (thousand GtC)."},
      {key:"Cv0_1e3Gt", label:"Cv₀ (×1000 GtC)", step:"0.01", help:"Initial vegetation carbon (thousand GtC)."},
      {key:"Cs0_1e3Gt", label:"Cs₀ (×1000 GtC)", step:"0.01", help:"Initial soil carbon (thousand GtC)."},
      {key:"Pv0", label:"Pᵥ₀", step:"1", help:"Baseline net primary production (GtC/yr)."},
    ];

    function carbonValue(k){
      const base = CARBON_CONFIGS[tmp.carbonConfig][k];
      const ov = (tmp.carbonOverrides||{})[k];
      return (ov === undefined) ? base : ov;
    }

    function renderCarbonGrid(){
      gridCarbon.innerHTML = "";
      for (const f of carbonFields){
        const base = CARBON_CONFIGS[tmp.carbonConfig][f.key];
        const v = carbonValue(f.key);
        const lo = base*0.75;
        const hi = base*1.25;
        const box = document.createElement("div");
        box.className = "param";
        box.innerHTML = `
          <div class="pname">${f.label}</div>
          <div class="phelp">${f.help}</div>
          <div class="prow">
            <input type="number" step="${f.step}" value="${v}" data-carbon="${f.key}" />
          </div>
          <div class="range">Config ${tmp.carbonConfig} value: <b>${fmt(base,6)}</b> (±25%: ${fmt(lo,6)} to ${fmt(hi,6)})</div>
        `;
        gridCarbon.appendChild(box);
      }
    }

    carbonCfgSelect.addEventListener("change", ()=>{
      tmp.carbonConfig = Number(carbonCfgSelect.value);
      tmp.carbonOverrides = {};
      renderCarbonGrid();
    });

    renderCarbonGrid();

    // Methane inputs
    function methValue(k){
      const base = METHANE_DEFAULT[k];
      const ov = (tmp.methaneOverrides||{})[k];
      return (ov === undefined) ? base : ov;
    }
    function renderMethaneGrid(){
      gridMethane.innerHTML = "";
      const fields = [
        {key:"tau0", label:"τ₀ (years)", step:"0.01", help:"Baseline CH₄ lifetime."},
        {key:"alpha", label:"α", step:"0.001", help:"Lifetime dependence on CH₄ burden."},
        {key:"M0", label:"M₀ (ppb)", step:"1", help:"Baseline CH₄ burden (preindustrial)."},
      ];
      for (const f of fields){
        const base = METHANE_DEFAULT[f.key];
        const v = methValue(f.key);
        const box = document.createElement("div");
        box.className = "param";
        box.innerHTML = `
          <div class="pname">${f.label}</div>
          <div class="phelp">${f.help}</div>
          <div class="prow">
            <input type="number" step="${f.step}" value="${v}" data-meth="${f.key}" />
          </div>
          <div class="range">Default: <b>${fmt(base,6)}</b></div>
        `;
        gridMethane.appendChild(box);
      }
    }
    renderMethaneGrid();

    // Sea level inputs
    function seaValue(k){
      const base = SEA_DEFAULT[k];
      const ov = (tmp.seaOverrides||{})[k];
      return (ov === undefined) ? base : ov;
    }
    function renderSeaGrid(){
      gridSea.innerHTML = "";
      const fields = [
        {key:"aTh", label:"Thermal sensitivity aₜₕ", step:"0.00001", help:"Thermal component sensitivity (m per °C per year).", plausible:"Typical: ~0.0003–0.0015"},
        {key:"tauTh", label:"Thermal timescale τₜₕ", step:"10", help:"Thermal response timescale (years). Larger = slower response.", plausible:"Typical: ~50–300"},
        {key:"T0Th", label:"Thermal reference T₀ₜₕ", step:"0.01", help:"Effective reference temperature (°C rel. 1850) for thermal expansion.", plausible:"Typical: ~-1.5–0"},
        {key:"aIce", label:"Land-ice sensitivity aᵢ", step:"0.00001", help:"Land-ice component sensitivity (m per °C per year).", plausible:"Typical: ~0.0003–0.0015"},
        {key:"tauIce", label:"Land-ice timescale τᵢ", step:"10", help:"Land-ice response timescale (years). Larger = slower response.", plausible:"Typical: ~200–2000"},
        {key:"T0Ice", label:"Land-ice reference T₀ᵢ", step:"0.01", help:"Effective reference temperature (°C rel. 1850) for land-ice loss.", plausible:"Typical: ~-2–0"},
      ];
      for (const f of fields){
        const base = SEA_DEFAULT[f.key];
        const v = seaValue(f.key);
        const box = document.createElement("div");
        box.className = "param";
        box.innerHTML = `
          <div class="pname">${f.label}</div>
          <div class="phelp">${f.help}</div>
          <div class="prow">
            <input type="number" step="${f.step}" value="${v}" data-sea="${f.key}" />
          </div>
          <div class="range">Default: <b>${fmt(base,6)}</b> · ${f.plausible}</div>
        `;
        gridSea.appendChild(box);
      }
    }
    renderSeaGrid();

    // Internal variability inputs (energy-conserving heat exchange q(t))
    const ivEnable = wrap.querySelector("#ivEnable");
    const ivCloudEnable = wrap.querySelector("#ivCloudEnable");
    const ivNewSeed = wrap.querySelector("#ivNewSeed");
    if (ivEnable) ivEnable.checked = !!(tmp.iv && tmp.iv.mixEnabled);
    if (ivCloudEnable) ivCloudEnable.checked = !!(tmp.iv && tmp.iv.cloudEnabled);

    function ivValue(k){
      const base = IV_DEFAULT[k];
      const v = (tmp.iv||{})[k];
      return (v === undefined) ? base : v;
    }

    function renderIVGrid(){
      if (!gridIV) return;
      gridIV.innerHTML = "";
      const fields = [
        {key:"amp", label:"Mixing amplitude σq (W/m²)", step:"0.01", help:"Standard deviation of the stochastic heat flux q(t) exchanged between upper and deep ocean (ocean mixing / ENSO-like source).", plausible:"Typical: 0–2"},
        {key:"period", label:"Mixing oscillation period (years)", step:"0.1", help:"Dominant period of the damped oscillator (ENSO-like variability is ~2–7 years).", plausible:"Typical: 2–7"},
        {key:"tau", label:"Mixing damping time (years)", step:"0.1", help:"Envelope damping timescale (higher = more persistent oscillations).", plausible:"Typical: 2–10"},
        {key:"cloudAmp", label:"Cloud/solar amplitude (W/m²)", step:"0.01", help:"Standard deviation of the radiative noise from random cloudiness and solar fluctuations. Satellite (CERES) interannual variability is ~0.4–0.6 W/m².", plausible:"Typical: 0–1"},
        {key:"cloudTau", label:"Cloud/solar decorrelation (years)", step:"0.1", help:"Persistence of the radiative noise (red-noise decorrelation time).", plausible:"Typical: 0.5–3"},
        {key:"seed", label:"Random seed", step:"1", help:"Seed for reproducible runs. Change to generate a different variability realisation.", plausible:"Integer"},
      ];
      for (const f of fields){
        const base = IV_DEFAULT[f.key];
        const v = ivValue(f.key);
        const box = document.createElement("div");
        box.className = "param";
        box.innerHTML = `
          <div class="pname">${f.label}</div>
          <div class="phelp">${f.help}</div>
          <div class="prow">
            <input type="number" step="${f.step}" value="${v}" data-iv="${f.key}" />
          </div>
          <div class="range">Default: <b>${fmt(base,6)}</b> · ${f.plausible}</div>
        `;
        gridIV.appendChild(box);
      }
    }

    function setIVEnabledUI(){
      const on = !!((ivEnable && ivEnable.checked) || (ivCloudEnable && ivCloudEnable.checked));
      if (!gridIV) return;
      gridIV.querySelectorAll("input[data-iv]").forEach(inp=>{
        inp.disabled = !on;
        inp.style.opacity = on ? "1" : "0.6";
      });
    }

    renderIVGrid();
    setIVEnabledUI();

    if (ivEnable){
      ivEnable.addEventListener("change", ()=>{
        tmp.iv = {...(tmp.iv||IV_DEFAULT), mixEnabled: ivEnable.checked};
        setIVEnabledUI();
      });
    }
    if (ivCloudEnable){
      ivCloudEnable.addEventListener("change", ()=>{
        tmp.iv = {...(tmp.iv||IV_DEFAULT), cloudEnabled: ivCloudEnable.checked};
        setIVEnabledUI();
      });
    }
    if (ivNewSeed){
      ivNewSeed.addEventListener("click", ()=>{
        const seedInp = wrap.querySelector('input[data-iv="seed"]');
        if (!seedInp) return;
        const newSeed = Math.floor(Math.random()*1e9) + 1;
        seedInp.value = String(newSeed);
      });
    }

    // ---- schematic view -------------------------------------------------
    const diagramHost = wrap.querySelector("#paramDiagramHost");
    const tableHost = wrap.querySelector("#paramTableHost");
    const editedNote = wrap.querySelector("#paramEditedNote");

    function countEdits(){
      let n = Object.keys(tmp.carbonOverrides||{}).length
            + Object.keys(tmp.methaneOverrides||{}).length
            + Object.keys(tmp.seaOverrides||{}).length
            + Object.keys(tmp.gasOverrides||{}).length;
      if (tmp.S !== defaultS()) n++;
      if (tmp.cu !== DEFAULTS.params.cu) n++;
      if (tmp.cl !== DEFAULTS.params.cl) n++;
      if (tmp.gamma !== DEFAULTS.params.gamma) n++;
      if (tmp.carbonConfig !== DEFAULTS.params.carbonConfig) n++;
      for (const k of ["amp","period","tau","cloudAmp","cloudTau"]){
        if ((tmp.iv||{})[k] !== undefined && tmp.iv[k] !== IV_DEFAULT[k]) n++;
      }
      return n;
    }
    function noteEdits(){
      const n = countEdits();
      editedNote.textContent = n ? `${n} value${n===1?"":"s"} changed — press Apply to use them` : "";
    }

    const schematic = buildParamSchematic(tmp, ()=>{ noteEdits(); syncTableFromTmp(); });
    diagramHost.appendChild(schematic);
    noteEdits();

    // Keep the table inputs in step when the diagram changes a value
    function syncTableFromTmp(){
      // climate sliders are one-off boxes keyed by data-k / data-n
      for (const k of ["S","gamma","cu","cl"]){
        const r = wrap.querySelector(`input[type="range"][data-k="${k}"]`);
        const n = wrap.querySelector(`input[type="number"][data-n="${k}"]`);
        if (r) r.value = tmp[k];
        if (n) n.value = tmp[k];
      }
      renderCarbonGrid();
      renderMethaneGrid();
      renderSeaGrid();
      if (typeof renderIVGrid === "function") renderIVGrid();
      if (carbonCfgSelect) carbonCfgSelect.value = String(tmp.carbonConfig);
    }

    wrap.querySelector("#pvDiagram").addEventListener("click", ()=>{
      diagramHost.style.display = "";
      tableHost.style.display = "none";
      wrap.querySelector("#pvDiagram").classList.add("orange");
      wrap.querySelector("#pvTable").classList.remove("orange");
      if (schematic.refreshAll) schematic.refreshAll();
    });
    wrap.querySelector("#pvTable").addEventListener("click", ()=>{
      diagramHost.style.display = "none";
      tableHost.style.display = "";
      wrap.querySelector("#pvTable").classList.add("orange");
      wrap.querySelector("#pvDiagram").classList.remove("orange");
      syncTableFromTmp();
    });

    wrap.querySelector("#applyParams").addEventListener("click", ()=>{
      // climate
      ["S","gamma","cu","cl"].forEach(k=>{
        const n = wrap.querySelector(`input[type="number"][data-n="${k}"]`);
        tmp[k] = Number(n.value);
      });

      // carbon (overrides relative to selected config)
      const newCarbon = {};
      for (const f of carbonFields){
        const k = f.key;
        const v = Number(wrap.querySelector(`input[data-carbon="${k}"]`).value);
        const base = CARBON_CONFIGS[tmp.carbonConfig][k];
        if (Number.isFinite(v) && Math.abs(v - base) > 1e-12) newCarbon[k] = v;
      }
      tmp.carbonOverrides = newCarbon;

      // methane
      const newMeth = {};
      for (const k of ["tau0","alpha","M0"]){
        const v = Number(wrap.querySelector(`input[data-meth="${k}"]`).value);
        const base = METHANE_DEFAULT[k];
        if (Number.isFinite(v) && Math.abs(v - base) > 1e-12) newMeth[k] = v;
      }
      tmp.methaneOverrides = newMeth;

      // sea
      const newSea = {};
      for (const k of ["aTh","tauTh","T0Th","aIce","tauIce","T0Ice"]){
        const v = Number(wrap.querySelector(`input[data-sea="${k}"]`).value);
        const base = SEA_DEFAULT[k];
        if (Number.isFinite(v) && Math.abs(v - base) > 1e-12) newSea[k] = v;
      }
      tmp.seaOverrides = newSea;

      // internal variability
      const newIV = {
        mixEnabled: !!(wrap.querySelector("#ivEnable") && wrap.querySelector("#ivEnable").checked),
        cloudEnabled: !!(wrap.querySelector("#ivCloudEnable") && wrap.querySelector("#ivCloudEnable").checked),
        amp: Number(wrap.querySelector('input[data-iv="amp"]')?.value ?? IV_DEFAULT.amp),
        period: Number(wrap.querySelector('input[data-iv="period"]')?.value ?? IV_DEFAULT.period),
        tau: Number(wrap.querySelector('input[data-iv="tau"]')?.value ?? IV_DEFAULT.tau),
        cloudAmp: Number(wrap.querySelector('input[data-iv="cloudAmp"]')?.value ?? IV_DEFAULT.cloudAmp),
        cloudTau: Number(wrap.querySelector('input[data-iv="cloudTau"]')?.value ?? IV_DEFAULT.cloudTau),
        seed: Math.floor(Number(wrap.querySelector('input[data-iv="seed"]')?.value ?? IV_DEFAULT.seed)) || IV_DEFAULT.seed
      };
      tmp.iv = newIV;

      // commit
      state.params = {
        S: tmp.S, cu: tmp.cu, cl: tmp.cl, gamma: tmp.gamma,
        carbonConfig: tmp.carbonConfig,
        carbonOverrides: tmp.carbonOverrides,
        methaneOverrides: tmp.methaneOverrides,
        seaOverrides: tmp.seaOverrides,
        gasOverrides: tmp.gasOverrides,
        iv: tmp.iv
      };

      updateEditBadges();
      updateIVToggle();
      closeModal();
    });

    wrap.querySelector("#resetParams").addEventListener("click", ()=>{
      state.params = defaultParams();
      updateEditBadges();
      updateIVToggle();
      closeModal();
      renderAll();
    });

    openModal("Model parameters", wrap);
  }


