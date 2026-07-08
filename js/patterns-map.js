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
      const names = (src.meta.layout && src.meta.layout.arrays) || ["tas_amp", "pr_pct_perC"];
      if (buf.byteLength < names.length*n*4) throw new Error("Pattern buffer too small");
      const fields = {};
      names.forEach((name, i) => { fields[name] = new Float32Array(buf, i*n*4, n); });
      return {
        meta: src.meta,
        grid: {nlat, nlon, lat0:g.lat0, lon0:g.lon0, dlat:g.dlat, dlon:g.dlon},
        tasAmp: fields.tas_amp,
        prPct: fields.pr_pct_perC,
        slr: fields.slr_cm_perC || null   // cm/°C departure; NaN over land
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
    if (!PATTERN) return {tasAmp: 1.0, prPctPerC: 0.0, slrCmPerC: null};
    const idx = patternIndex(lat, lon);
    return {
      tasAmp: PATTERN.tasAmp[idx],
      prPctPerC: PATTERN.prPct[idx],
      slrCmPerC: (PATTERN.slr && Number.isFinite(PATTERN.slr[idx])) ? PATTERN.slr[idx] : null
    };
  }

  function lerp(a,b,t){ return a + (b-a)*t; }
  function rgbToCss(r,g,b,a=255){
    r=Math.round(clamp(r,0,255)); g=Math.round(clamp(g,0,255)); b=Math.round(clamp(b,0,255));
    if (a===255) return `rgb(${r},${g},${b})`;
    return `rgba(${r},${g},${b},${(a/255).toFixed(3)})`;
  }

  // White-centered diverging ramps: t in [-1, 1], white at 0 (= the global
  // average value of the field), so colour shows departure from the average.
  function rampBetween(neg, mid, pos, t){
    if (t < 0){
      const u = clamp(t + 1, 0, 1);
      return [lerp(neg[0],mid[0],u), lerp(neg[1],mid[1],u), lerp(neg[2],mid[2],u), 255];
    }
    const u = clamp(t, 0, 1);
    return [lerp(mid[0],pos[0],u), lerp(mid[1],pos[1],u), lerp(mid[2],pos[2],u), 255];
  }
  const WHITE = [255,255,255];
  const RAMPS = {
    tas: t => rampBetween([33,102,172], WHITE, [178,24,43], t),   // blue-white-red (warming above/below average)
    pr:  t => rampBetween([140,81,10], WHITE, [1,102,94], t),     // brown-white-teal (drier/wetter)
    slr: t => rampBetween([33,102,172], WHITE, [178,24,43], t)    // blue-white-red (less/more rise than average)
  };

  const _mapCache = {tas:null, pr:null, slr:null};

  // Land mask from the sea-level field (NaN over land); used to draw
  // coastlines on every map. Computed once.
  const LAND_EDGE = (function(){
    if (!PATTERN || !PATTERN.slr) return null;
    const g = PATTERN.grid, w = g.nlon, h = g.nlat;
    const isLand = i => !Number.isFinite(PATTERN.slr[i]);
    const edge = new Uint8Array(w*h);
    for (let la=0; la<h; la++){
      for (let lo=0; lo<w; lo++){
        const i = la*w + lo;
        if (!isLand(i)) continue;
        const nbrs = [
          la > 0 ? (la-1)*w + lo : -1,
          la < h-1 ? (la+1)*w + lo : -1,
          la*w + ((lo+1) % w),
          la*w + ((lo-1+w) % w)
        ];
        if (nbrs.some(n => n >= 0 && !isLand(n))) edge[i] = 1;
      }
    }
    return edge;
  })();

  // Centres for the white midpoint of each map: tas_amp averages to exactly 1
  // (by construction), pr and slr departures average to ~0.
  const MAP_CENTER = {tas: 1.0, pr: 0.0, slr: 0.0};

  function buildMapImage(varKey){
    if (!PATTERN) return null;
    const g = PATTERN.grid;
    const w = g.nlon, h = g.nlat;
    const img = new ImageData(w, h);
    const data = (varKey === "pr") ? PATTERN.prPct
               : (varKey === "slr") ? PATTERN.slr
               : PATTERN.tasAmp;
    if (!data) return null;

    const metaVar = PATTERN.meta.vars[varKey === "pr" ? "pr_pct_perC" : varKey === "slr" ? "slr_cm_perC" : "tas_amp"];
    const center = MAP_CENTER[varKey] ?? 0;
    // Two-slope scaling: white sits exactly on the centre (the global average),
    // and each side uses its own data range — so the colour bar labels are the
    // real data limits (an amplification factor cannot be negative, etc.)
    const mNeg = Math.max(center - metaVar.vmin, 1e-9);
    const mPos = Math.max(metaVar.vmax - center, 1e-9);
    const vmin = metaVar.vmin, vmax = metaVar.vmax;
    const ramp = RAMPS[varKey] || RAMPS.tas;
    const toT = v => clamp((v - center) / (v < center ? mNeg : mPos), -1, 1);

    for (let iy=0; iy<h; iy++){
      const ilat = (h-1-iy); // flip so north is at top
      for (let ix=0; ix<w; ix++){
        const idx = ilat*w + ix;
        const v = data[idx];
        let rgba;
        if (!Number.isFinite(v)){
          rgba = [206, 210, 214, 255]; // land / no data
        }else{
          rgba = ramp(toT(v));
        }
        // coastline overlay
        if (LAND_EDGE && LAND_EDGE[idx]) rgba = [90, 96, 102, 255];
        const p = (iy*w + ix)*4;
        img.data[p+0]=rgba[0];
        img.data[p+1]=rgba[1];
        img.data[p+2]=rgba[2];
        img.data[p+3]=rgba[3];
      }
    }
    return {img, vmin, vmax, center, ramp, units: metaVar.units};
  }

  // Horizontal colour bar under the map: min / centre (global average) / max
  function drawColorbar(cache){
    const cv = el("mapColorbar");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0,0,w,h);
    const barH = 12, pad = 6, y0 = 2;
    for (let x = pad; x < w - pad; x++){
      const t = ((x - pad)/(w - 2*pad))*2 - 1;
      const c = cache.ramp(t);
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x, y0, 1, barH);
    }
    ctx.strokeStyle = "#9aa8b3";
    ctx.strokeRect(pad, y0, w - 2*pad, barH);
    // centre tick (the global average = white)
    ctx.strokeStyle = "#444";
    ctx.beginPath();
    ctx.moveTo(w/2, y0); ctx.lineTo(w/2, y0 + barH + 3);
    ctx.stroke();
    ctx.fillStyle = "#444";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    ctx.fillText(cache.vmin.toFixed(1), pad, y0 + barH + 12);
    ctx.textAlign = "center";
    ctx.fillText(`${cache.center.toFixed(0)} (global avg)  ${cache.units || ""}`, w/2, y0 + barH + 12);
    ctx.textAlign = "right";
    ctx.fillText(cache.vmax.toFixed(1), w - pad, y0 + barH + 12);
    ctx.textAlign = "left";
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
    drawColorbar(cache);

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
      }else if (varKey === "slr"){
        legend.textContent = (pat.slrCmPerC === null)
          ? `Sea-level departure: — (land; click an ocean point)  (map range ${cache.vmin.toFixed(0)} to ${cache.vmax.toFixed(0)} cm/°C)`
          : `Sea-level departure: ${pat.slrCmPerC.toFixed(1)} cm/°C  (map range ${cache.vmin.toFixed(0)} to ${cache.vmax.toFixed(0)})`;
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
        <li>The <b>sea-level map</b> shows how much the local sea-level rise differs from the global average
            (in cm per degree of warming). Winds and ocean currents pile water up more in some places than others,
            so the sea does not rise evenly — some coasts get extra rise on top of the global amount. (It does not
            include the effects of <i>where</i> melting ice comes from, which also shifts sea level around.)</li>
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
    if (el("mapVar")){
      const slrOpt = el("mapVar").querySelector('option[value="slr"]');
      if (slrOpt) slrOpt.disabled = !(PATTERN && PATTERN.slr);
      el("mapVar").value = state.local.mapVar || "tas";
    }
  }

  function renderLocalSeries(years, globalTemp, globalSL){
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

    // Local sea level: global-mean rise from the model + regional departure
    // scaled by warming. Only shown for ocean locations with slr data.
    const slrBox = el("plotLocalSlr") ? el("plotLocalSlr").closest(".chartBox") : null;
    if (slrBox){
      const show = !!(globalSL && pat.slrCmPerC !== null);
      slrBox.style.display = show ? "" : "none";
      if (show){
        const locSL = globalSL.map((v, i) => v + (pat.slrCmPerC/100) * globalTemp[i]);
        plotLines(el("plotLocalSlr"), [
          {label:`Local sea level (lat ${lat.toFixed(1)}, lon ${lon.toFixed(1)})`, x:years, y:locSL, color:"#8e44ad", width:2.4},
          {label:`Global mean (model)`, x:years, y:globalSL, color:"rgba(0,0,0,0.25)", width:1.4},
        ], {yLabel:"Sea level rise (m rel. 1850)", yDigits:2});
      }
    }
  }



  // Input variables. The minor GHGs (simpleHidden) are absent in the simple
  // variant, prescribed as ERF (mixed* fields) in the mixed variant, and
  // emission-driven in the full variant.
  const INPUT_VARS = [
    {toggle:"CO2", col:"E_CO2_GtC_yr", canvas:"plotInCO2", mini:"miniCO2", yDigits:1, title:"CO₂", units:"GtC/yr"},
    {toggle:"CH4", col:"E_CH4_TgCH4_yr", canvas:"plotInCH4", mini:"miniCH4", yDigits:0, title:"CH₄", units:"Tg/yr"},
    {toggle:"AER", col:"E_SO2_Tg_yr", canvas:"plotInAER", mini:"miniAER", yDigits:0, title:"Aerosol emissions", units:"Tg SO₂/yr"},
    {toggle:"O3", col:"E_O3prec_Tg_yr", canvas:"plotInO3", mini:"miniO3", yDigits:0, title:"Ozone precursors", units:"Tg/yr", simpleHidden:true,
      mixedCol:"ERF_o3_total_rel1850_Wm2", mixedTitle:"Ozone ERF", mixedUnits:"W/m²", mixedDigits:2,
      mixedSub:"Effective radiative forcing from ozone (W/m², relative to 1850)."},
    {toggle:"N2O", col:"E_N2O_Tg_yr", canvas:"plotInN2O", mini:"miniN2O", yDigits:1, title:"N₂O emissions", units:"Tg N₂O/yr", simpleHidden:true,
      mixedCol:"ERF_N2O_rel1850_Wm2", mixedTitle:"N₂O ERF", mixedUnits:"W/m²", mixedDigits:2,
      mixedSub:"Effective radiative forcing from nitrous oxide (W/m², relative to 1850)."},
    {toggle:"OTHER", col:"E_XGHG_kt_yr", canvas:"plotInOTHER", mini:"miniOTHER", yDigits:0, title:"Synthetic gases", units:"kt CFC-12-eq/yr", simpleHidden:true,
      mixedCol:"ERF_otherWMGHG_rel1850_Wm2", mixedTitle:"Other WMGHG ERF", mixedUnits:"W/m²", mixedDigits:2,
      mixedSub:"Effective radiative forcing from other well-mixed greenhouse gases (W/m², relative to 1850)."},
    {toggle:"VOLC", col:"E_volcAOD_yr", canvas:"plotInVOLC", mini:"miniVOLC", yDigits:3, title:"Volcanic injection", units:"AOD/yr"},
    {toggle:"SOLAR", col:"ERF_solar_rel1850_Wm2", canvas:"plotInSOLAR", mini:"miniSOLAR", yDigits:2, title:"Solar", units:"W/m²"},
    {toggle:"ALB", col:"albedo", canvas:"plotInALB", mini:"miniALB", yDigits:3, title:"Albedo", units:"reflectivity"},
  ];

  // Variant-aware accessors (APP_VARIANT is defined in state.js; these are
  // only called at render time, after all scripts have loaded)
  function inputVarActive(v){ return !(APP_VARIANT === "simple" && v.simpleHidden); }
  function inputVarCol(v){ return (APP_VARIANT === "mixed" && v.mixedCol) ? v.mixedCol : v.col; }
  function inputVarTitle(v){ return (APP_VARIANT === "mixed" && v.mixedTitle) ? v.mixedTitle : v.title; }
  function inputVarUnits(v){ return (APP_VARIANT === "mixed" && v.mixedUnits) ? v.mixedUnits : v.units; }
  function inputVarDigits(v){ return (APP_VARIANT === "mixed" && v.mixedDigits != null) ? v.mixedDigits : v.yDigits; }

  const TOGGLE_DOM = {
    ALB: {cb:"togALB", st:"stateALB"},
    CO2: {cb:"togCO2", st:"stateCO2"},
    CH4: {cb:"togCH4", st:"stateCH4"},
    AER: {cb:"togAER", st:"stateAER"},
    O3: {cb:"togO3", st:"stateO3"},
    N2O: {cb:"togN2O", st:"stateN2O"},
    OTHER: {cb:"togOTHER", st:"stateOTHER"},
    VOLC: {cb:"togVOLC", st:"stateVOLC"},
    SOLAR: {cb:"togSOLAR", st:"stateSOLAR"},
  };

