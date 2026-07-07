  // ========================
  // Pattern scaling (local projections)
  // ========================
  function b64ToArrayBuffer(b64){
    // Decode base64 -> ArrayBuffer
    const binStr = atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i=0;i<len;i++) bytes[i] = binStr.charCodeAt(i);
    return bytes.buffer;
  }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function wrapLonToRange(lon, lon0){
    // Wrap lon into [lon0, lon0+360)
    let L = lon;
    const hi = lon0 + 360;
    while (L < lon0) L += 360;
    while (L >= hi) L -= 360;
    return L;
  }
  function wrapLon180(lon){
    // Wrap to [-180, 180)
    let L = lon;
    while (L < -180) L += 360;
    while (L >= 180) L -= 360;
    return L;
  }

  const PATTERN = (function(){
    const src = window.PATTERN_1DEG;
    if (!src || !src.meta || !src.meta.grid || !src.b64) return null;
    const g = src.meta.grid;
    const nlat = g.nlat|0, nlon = g.nlon|0;
    const n = nlat*nlon;
    try{
      const buf = b64ToArrayBuffer(src.b64);
      const needFloats = 2*n;
      if (buf.byteLength < needFloats*4) throw new Error("Pattern buffer too small");
      const tasAmp = new Float32Array(buf, 0, n);
      const prPct = new Float32Array(buf, n*4, n);
      return {
        meta: src.meta,
        grid: {nlat, nlon, lat0:g.lat0, lon0:g.lon0, dlat:g.dlat, dlon:g.dlon},
        tasAmp, prPct
      };
    }catch(e){
      console.warn("Failed to load PATTERN_1DEG:", e);
      return null;
    }
  })();

  function patternIndex(lat, lon){
    if (!PATTERN) return 0;
    const g = PATTERN.grid;
    const latMin = g.lat0;
    const latMax = g.lat0 + (g.nlat-1)*g.dlat;
    const ilat = Math.round((clamp(lat, latMin, latMax) - latMin)/g.dlat);
    const L = wrapLonToRange(lon, g.lon0);
    const ilon = Math.round((L - g.lon0)/g.dlon) % g.nlon;
    return ilat*g.nlon + clamp(ilon, 0, g.nlon-1);
  }

  function getPatternAt(lat, lon){
    if (!PATTERN) return {tasAmp: 1.0, prPctPerC: 0.0};
    const idx = patternIndex(lat, lon);
    return {tasAmp: PATTERN.tasAmp[idx], prPctPerC: PATTERN.prPct[idx]};
  }

  function lerp(a,b,t){ return a + (b-a)*t; }
  function rgbToCss(r,g,b,a=255){
    r=Math.round(clamp(r,0,255)); g=Math.round(clamp(g,0,255)); b=Math.round(clamp(b,0,255));
    if (a===255) return `rgb(${r},${g},${b})`;
    return `rgba(${r},${g},${b},${(a/255).toFixed(3)})`;
  }

  // simple sequential and diverging ramps
  function rampSeq(t){
    // light -> blue
    const c0=[255,255,232], c1=[49,130,189];
    return [lerp(c0[0],c1[0],t), lerp(c0[1],c1[1],t), lerp(c0[2],c1[2],t), 255];
  }
  function rampDiv(t){
    // t in [-1,1] : red-white-blue
    const neg=[215,48,39], mid=[255,255,255], pos=[69,117,180];
    if (t<0){
      const u = clamp((t+1),0,1); // -1..0 -> 0..1
      return [lerp(neg[0],mid[0],u), lerp(neg[1],mid[1],u), lerp(neg[2],mid[2],u), 255];
    }else{
      const u = clamp(t,0,1); // 0..1
      return [lerp(mid[0],pos[0],u), lerp(mid[1],pos[1],u), lerp(mid[2],pos[2],u), 255];
    }
  }

  const _mapCache = {tas:null, pr:null};

  function buildMapImage(varKey){
    if (!PATTERN) return null;
    const g = PATTERN.grid;
    const w = g.nlon, h = g.nlat;
    const img = new ImageData(w, h);
    const data = (varKey === "pr") ? PATTERN.prPct : PATTERN.tasAmp;

    let vmin, vmax, diverge=false;
    if (varKey === "pr"){
      diverge = true;
      // symmetric-ish range around 0 for nicer display
      const rawMin = PATTERN.meta.vars.pr_pct_perC.vmin;
      const rawMax = PATTERN.meta.vars.pr_pct_perC.vmax;
      const m = Math.max(Math.abs(rawMin), Math.abs(rawMax));
      vmin = -m; vmax = m;
    }else{
      vmin = PATTERN.meta.vars.tas_amp.vmin;
      vmax = PATTERN.meta.vars.tas_amp.vmax;
    }

    for (let iy=0; iy<h; iy++){
      const ilat = (h-1-iy); // flip so north is at top
      for (let ix=0; ix<w; ix++){
        const idx = ilat*w + ix;
        const v = data[idx];
        let rgba;
        if (diverge){
          const t = clamp((v - 0)/(vmax-0), -1, 1);
          rgba = rampDiv(t);
        }else{
          const t = clamp((v - vmin)/(vmax - vmin), 0, 1);
          rgba = rampSeq(t);
        }
        const p = (iy*w + ix)*4;
        img.data[p+0]=rgba[0];
        img.data[p+1]=rgba[1];
        img.data[p+2]=rgba[2];
        img.data[p+3]=rgba[3];
      }
    }
    return {img, vmin, vmax, diverge};
  }

  function lonLatToCanvasXY(lon, lat, canvas){
    // canvas is 360x180 in its internal coordinate system
    const x = (wrapLon180(lon) + 180) / 360 * canvas.width;
    const y = (90 - clamp(lat, -90, 90)) / 180 * canvas.height;
    return {x, y};
  }

  function renderPatternMap(){
    const canvas = el("mapCanvas");
    if (!canvas) return;

    const legend = el("mapLegend");

    if (!PATTERN){
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = "#f2f4f7";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = "#666";
      ctx.font = "12px sans-serif";
      ctx.fillText("Pattern file missing", 10, 20);
      if (legend) legend.textContent = "";
      return;
    }

    const varKey = (state.local && state.local.mapVar) ? state.local.mapVar : "tas";
    if (!_mapCache[varKey]) _mapCache[varKey] = buildMapImage(varKey);
    const cache = _mapCache[varKey];

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.putImageData(cache.img, 0, 0);

    // Crosshair at selected location
    const lat = state.local.lat ?? 0;
    const lon = state.local.lon ?? 0;
    const xy = lonLatToCanvasXY(lon, lat, canvas);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xy.x-7, xy.y); ctx.lineTo(xy.x+7, xy.y);
    ctx.moveTo(xy.x, xy.y-7); ctx.lineTo(xy.x, xy.y+7);
    ctx.stroke();

    // Legend text
    const pat = getPatternAt(lat, lon);
    if (legend){
      if (varKey === "pr"){
        legend.textContent = `Precip pattern: ${pat.prPctPerC.toFixed(2)} %/°C  (map range ${cache.vmin.toFixed(1)} to ${cache.vmax.toFixed(1)})`;
      }else{
        legend.textContent = `Temp amplification: ${pat.tasAmp.toFixed(2)} °C/°C  (map range ${cache.vmin.toFixed(2)} to ${cache.vmax.toFixed(2)})`;
      }
    }
  }

  // "More info" modal for the Local projections panel: how pattern scaling
  // works (written for a school audience) plus the data provenance, pulled
  // live from the pattern file's own metadata.
  function openPatternInfo(){
    const body = document.createElement("div");
    const src = (PATTERN && PATTERN.meta && PATTERN.meta.source) || "pattern file metadata unavailable";
    const created = (PATTERN && PATTERN.meta && PATTERN.meta.created) ? ` Generated ${PATTERN.meta.created}.` : "";
    body.innerHTML = `
      <p style="margin-top:0;">Carbonator works out <b>one number per year</b>: the average temperature change of the
      whole planet. But warming is not shared out evenly — land warms faster than the ocean, and the Arctic warms
      fastest of all.</p>
      <p>To estimate change <i>where you live</i>, we use a trick called <b>pattern scaling</b>:</p>
      <p style="text-align:center; font-weight:700;">local change &nbsp;=&nbsp; global warming &nbsp;×&nbsp; the map value at your location</p>
      <ul style="padding-left:18px; font-size:13px; line-height:1.5;">
        <li>On the <b>temperature map</b>, a value of 2 means that place warms twice as fast as the global average;
            0.8 means it lags behind (like the oceans around Australia).</li>
        <li>The <b>rainfall map</b> shows the percentage change in precipitation for every degree of global warming —
            blue regions get wetter, brown regions get drier.</li>
      </ul>
      <p><b>Where does the map come from?</b> We compared the end of this century (2071–2100, high-emission scenario)
      with the pre-industrial climate (1850–1900) in twelve of the world's full climate models, divided each model's
      local change by its own global warming, and took the middle value of the twelve at every point on a 1° grid.</p>
      <p style="font-size:12px; color:#666;">${src}.${created}</p>
      <p style="font-size:12px; color:#666; margin-bottom:0;"><b>Keep in mind:</b> this is an approximation. It works
      well for steady greenhouse warming, but real local change also depends on things that don't scale with global
      temperature (like aerosol pollution and shifting ocean currents), and year-to-year variability is not included.</p>
    `;
    openModal("Local projections — how it works", body);
  }

  function syncLocalInputs(){
    if (el("locLat")) el("locLat").value = (state.local.lat ?? 0).toFixed(1);
    if (el("locLon")) el("locLon").value = (state.local.lon ?? 0).toFixed(1);
    if (el("mapVar")) el("mapVar").value = state.local.mapVar || "tas";
  }

  function renderLocalSeries(years, globalTemp){
    if (!PATTERN) return;
    if (!state.outputPanels.local) return;

    const lat = state.local.lat ?? 0;
    const lon = state.local.lon ?? 0;
    const pat = getPatternAt(lat, lon);

    const locTas = globalTemp.map(v=>v*pat.tasAmp);
    const locPr  = globalTemp.map(v=>v*pat.prPctPerC);

    plotLines(el("plotLocalTas"), [
      {label:`Local tas (lat ${lat.toFixed(1)}, lon ${lon.toFixed(1)})`, x:years, y:locTas, color:"#1f77b4", width:2.4},
      {label:`Global (model)`, x:years, y:globalTemp, color:"rgba(0,0,0,0.25)", width:1.4},
    ], {yLabel:"Local temperature anomaly (°C)", yDigits:2});

    plotLines(el("plotLocalPr"), [
      {label:`Local pr change (lat ${lat.toFixed(1)}, lon ${lon.toFixed(1)})`, x:years, y:locPr, color:"#2ca02c", width:2.4},
    ], {yLabel:"Precipitation change (% relative)", yDigits:1});
  }



  // Input variables. In the default simple "emissions" input mode, aerosol and
  // volcanic inputs switch to their pseudo-emission columns (simpleCol) and the
  // minor forcings (simpleHidden) are excluded from the UI and the model.
  const INPUT_VARS = [
    {toggle:"CO2", col:"E_CO2_GtC_yr", canvas:"plotInCO2", mini:"miniCO2", yDigits:1, title:"CO₂", units:"GtC/yr"},
    {toggle:"CH4", col:"E_CH4_TgCH4_yr", canvas:"plotInCH4", mini:"miniCH4", yDigits:0, title:"CH₄", units:"Tg/yr"},
    {toggle:"AER", col:"ERF_aerosol_rel1850_Wm2", canvas:"plotInAER", mini:"miniAER", yDigits:2, title:"Aerosol", units:"W/m²",
      simpleCol:"E_SO2_Tg_yr", simpleTitle:"Aerosol emissions", simpleUnits:"Tg SO₂/yr", simpleDigits:0,
      simpleSub:"Human aerosol (SO₂) emissions. Forcing is proportional to the emission rate (aerosols wash out within days)."},
    {toggle:"O3", col:"ERF_o3_total_rel1850_Wm2", canvas:"plotInO3", mini:"miniO3", yDigits:2, title:"Ozone", units:"W/m²", simpleHidden:true},
    {toggle:"N2O", col:"ERF_N2O_rel1850_Wm2", canvas:"plotInN2O", mini:"miniN2O", yDigits:2, title:"N₂O", units:"W/m²", simpleHidden:true},
    {toggle:"OTHER", col:"ERF_otherWMGHG_rel1850_Wm2", canvas:"plotInOTHER", mini:"miniOTHER", yDigits:2, title:"Other WMGHG", units:"W/m²", simpleHidden:true},
    {toggle:"VOLC", col:"ERF_volcanic_rel1850_Wm2", canvas:"plotInVOLC", mini:"miniVOLC", yDigits:2, title:"Volcanic", units:"W/m²",
      simpleCol:"E_volcAOD_yr", simpleTitle:"Volcanic aerosol injection", simpleUnits:"AOD/yr", simpleDigits:3,
      simpleSub:"Volcanic aerosol injected into the stratosphere (optical depth per year); it decays with a ~1.2-year lifetime."},
    {toggle:"SOLAR", col:"ERF_solar_rel1850_Wm2", canvas:"plotInSOLAR", mini:"miniSOLAR", yDigits:2, title:"Solar", units:"W/m²"},
  ];

  // Mode-aware accessors (state is defined later; these are called at render time)
  function inputVarActive(v){ return !(state.inputMode === "emissions" && v.simpleHidden); }
  function inputVarCol(v){ return (state.inputMode === "emissions" && v.simpleCol) ? v.simpleCol : v.col; }
  function inputVarTitle(v){ return (state.inputMode === "emissions" && v.simpleTitle) ? v.simpleTitle : v.title; }
  function inputVarUnits(v){ return (state.inputMode === "emissions" && v.simpleUnits) ? v.simpleUnits : v.units; }
  function inputVarDigits(v){ return (state.inputMode === "emissions" && v.simpleDigits != null) ? v.simpleDigits : v.yDigits; }

  const TOGGLE_DOM = {
    CO2: {cb:"togCO2", st:"stateCO2"},
    CH4: {cb:"togCH4", st:"stateCH4"},
    AER: {cb:"togAER", st:"stateAER"},
    O3: {cb:"togO3", st:"stateO3"},
    N2O: {cb:"togN2O", st:"stateN2O"},
    OTHER: {cb:"togOTHER", st:"stateOTHER"},
    VOLC: {cb:"togVOLC", st:"stateVOLC"},
    SOLAR: {cb:"togSOLAR", st:"stateSOLAR"},
  };

