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
                             state.params.S !== defaultS() ||
                             state.params.cu !== DEFAULTS.params.cu ||
                             state.params.cl !== DEFAULTS.params.cl ||
                             state.params.gamma !== DEFAULTS.params.gamma ||
                             (state.params.iv && (
                               !!state.params.iv.mixEnabled !== IV_DEFAULT.mixEnabled ||
                               !!state.params.iv.cloudEnabled !== IV_DEFAULT.cloudEnabled ||
                               state.params.iv.amp !== IV_DEFAULT.amp ||
                               state.params.iv.period !== IV_DEFAULT.period ||
                               state.params.iv.tau !== IV_DEFAULT.tau ||
                               (state.params.iv.cloudAmp ?? IV_DEFAULT.cloudAmp) !== IV_DEFAULT.cloudAmp ||
                               (state.params.iv.cloudTau ?? IV_DEFAULT.cloudTau) !== IV_DEFAULT.cloudTau ||
                               state.params.iv.seed !== IV_DEFAULT.seed
                             ))));
  }

  function updateEditBadges(){
    // per-variable edited badges (badge ids use the emission column names;
    // ERF-column edits in the mixed variant light up the same card's badge)
    document.querySelectorAll('[id^="badge_"]').forEach(span=>{ span.style.display="none"; });
    for (const k of Object.keys(state.customSeries)){
      let b = el("badge_" + k);
      if (!b){
        const mv = INPUT_VARS.find(v => v.mixedCol === k);
        if (mv) b = el("badge_" + mv.col);
      }
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
    // Internal variability is generated at the input stage: the mixing series
    // rides in its own column; the cloud/solar noise perturbs the albedo input.
    const iv = (state.params && state.params.iv) || {};
    const ivs = (iv.mixEnabled || iv.cloudEnabled)
      ? generateIVSeries(baseRows.map(r => r.year), iv)
      : null;
    return baseRows.map((r, idx) => {
      const o = {...r};

      // apply custom series overrides (both ERF and pseudo-emission columns)
      for (const meta of INPUT_VARS){
        for (const col of [meta.col, meta.simpleCol]){
          if (!col) continue;
          const custom = state.customSeries[col];
          if (custom && custom.length === baseRows.length){
            o[col] = custom[idx];
          }
        }
      }

      // apply toggles: zero out disabled inputs (both representations)
      if (!state.toggles.CO2) o.E_CO2_GtC_yr = 0;
      if (!state.toggles.CH4) o.E_CH4_TgCH4_yr = 0;
      if (!state.toggles.AER){ o.ERF_aerosol_rel1850_Wm2 = 0; o.E_SO2_Tg_yr = 0; }
      if (!state.toggles.O3){ o.ERF_o3_total_rel1850_Wm2 = 0; o.E_O3prec_Tg_yr = 0; }
      if (!state.toggles.N2O){ o.ERF_N2O_rel1850_Wm2 = 0; o.E_N2O_Tg_yr = 0; }
      if (!state.toggles.OTHER){ o.ERF_otherWMGHG_rel1850_Wm2 = 0; o.E_XGHG_kt_yr = 0; }
      if (!state.toggles.VOLC){ o.ERF_volcanic_rel1850_Wm2 = 0; o.E_volcAOD_yr = 0; }
      if (!state.toggles.SOLAR) o.ERF_solar_rel1850_Wm2 = 0;
      if (!state.toggles.ALB) o.albedo = SIMPLE_INPUTS.alb0; // reset to baseline, not zero

      // variability (applied on top of edits and toggles)
      o.q_iv_Wm2 = (ivs && iv.mixEnabled) ? ivs.q[idx] : 0;
      if (ivs && iv.cloudEnabled) o.albedo = o.albedo + ivs.dAlb[idx];

      return o;
    });
  }

  // Model variants are separate pages (index.html?model=... / simple.html /
  // mixed.html) — there is no in-app switching.

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

  const VARIANT_INFO = {
    simple: {hint:"Inputs: CO₂, CH₄, aerosols, volcanoes, solar and albedo. Minor gases are off."},
    mixed:  {hint:"Emission inputs plus N₂O, ozone and synthetic-gas forcings (W/m²)."},
    full:   {hint:"Every input is an emission — including N₂O, ozone precursors and synthetic gases."}
  };

  function updateVariantUI(){
    const hint = el("controlsHint");
    if (hint) hint.textContent = VARIANT_INFO[APP_VARIANT].hint;
  }

  function updateIVToggle(){
    const iv = (state.params && state.params.iv) || {};
    const mixCb = el("togIVMix"), cloudCb = el("togIVCloud");
    if (mixCb){
      mixCb.checked = !!iv.mixEnabled;
      const st = el("stateIVMix");
      if (st) st.textContent = iv.mixEnabled ? "ON" : "OFF";
    }
    if (cloudCb){
      cloudCb.checked = !!iv.cloudEnabled;
      const st = el("stateIVCloud");
      if (st) st.textContent = iv.cloudEnabled ? "ON" : "OFF";
    }
    const seedVal = el("ivSeedVal");
    if (seedVal) seedVal.textContent = String(iv.seed ?? IV_DEFAULT.seed);
    const btn = el("btnIVRandom");
    if (btn){
      const on = !!(iv.mixEnabled || iv.cloudEnabled);
      btn.disabled = !on;
      btn.style.opacity = on ? "1" : "0.6";
    }
  }

  // ------------------------------------------------------------------
  // Per-input information: sources, sinks, lifetime, warming potential.
  // Written for a high-school audience; numbers follow IPCC AR6.
  // ------------------------------------------------------------------
  const INPUT_INFO = {
    CO2: {
      title: "Carbon dioxide (CO₂)",
      html: `
        <p style="margin-top:0;"><b>Where it comes from:</b> mostly burning fossil fuels — coal, oil and gas — for
        electricity, transport and industry (about 90% of our emissions), plus cutting down forests. Nature also
        exchanges huge amounts of CO₂ with the air every year (plants, soils, the ocean), but those flows were in
        balance before we started adding extra.</p>
        <p><b>Where it goes:</b> roughly a quarter of what we emit dissolves into the ocean (making it more acidic —
        watch the pH output) and about a quarter to a third is taken up by plants. The rest stays in the air.</p>
        <p><b>How long it lasts:</b> there is no single lifetime — about half is absorbed within a few decades, but the
        remainder lingers for <b>centuries to thousands of years</b>. That is why CO₂ dominates long-term warming, and
        why the CO₂ Pulse experiment takes so long to recover.</p>
        <p style="margin-bottom:0;"><b>Warming potential:</b> CO₂ is the yardstick all other gases are measured
        against (its "global warming potential" is defined as 1). It is not the strongest greenhouse gas per
        kilogram — it matters because of the sheer quantity we emit: about 40 billion tonnes per year.</p>`
    },
    CH4: {
      title: "Methane (CH₄)",
      html: `
        <p style="margin-top:0;"><b>Where it comes from:</b> livestock digestion (cow burps, not farts!), rice paddies,
        landfills, and leaks from coal mines and gas pipelines. Natural wetlands are a big natural source.</p>
        <p><b>Where it goes:</b> destroyed in the atmosphere by reactive molecules called OH radicals — the
        atmosphere's "detergent" — which oxidise it back to CO₂ and water.</p>
        <p><b>How long it lasts:</b> about <b>12 years</b> — short for a greenhouse gas. Stop emitting it and
        concentrations fall within decades (try the CH₄ Pulse experiment).</p>
        <p style="margin-bottom:0;"><b>Warming potential:</b> kilogram for kilogram, methane causes about
        <b>30 times</b> more warming than CO₂ over a century — and over 80 times more over 20 years, because its
        effect is intense but brief. That makes cutting methane one of the fastest ways to slow near-term warming.</p>`
    },
    AER: {
      title: "Human aerosols (SO₂ and other particles)",
      html: `
        <p style="margin-top:0;"><b>Where they come from:</b> tiny particles and droplets made mostly from sulphur
        dioxide (SO₂) released by burning coal and ship fuel, plus smoke from industry and fires.</p>
        <p><b>What they do:</b> unlike greenhouse gases, aerosols <b>cool</b> the planet — they reflect sunlight back
        to space and make clouds brighter and longer-lasting. They currently hide roughly half a degree of the
        warming our greenhouse gases would otherwise cause.</p>
        <p><b>How long they last:</b> only <b>days to weeks</b> — rain washes them out. That is why their cooling
        tracks the emission rate: stop emitting and the cooling vanishes almost immediately (this "unmasking" is why
        the Eliminate All Emissions experiment warms briefly at first).</p>
        <p style="margin-bottom:0;"><b>The dilemma:</b> these same particles are air pollution that damages human
        health, so we clean them up for good reason — but the cleanup removes their accidental cooling.</p>`
    },
    O3: {
      title: "Ozone-forming pollution (precursors)",
      html: `
        <p style="margin-top:0;"><b>What it is:</b> ozone near the ground is not emitted directly. It is cooked up by
        sunlight from "precursor" pollution — nitrogen oxides (NOx) from vehicle exhausts and power stations, carbon
        monoxide, and evaporated fuels and solvents.</p>
        <p><b>What it does:</b> this low-level ozone is a greenhouse gas <i>and</i> a harmful pollutant — it damages
        lungs and crops. (It is a different story from the protective ozone layer high in the stratosphere.)</p>
        <p><b>How long it lasts:</b> <b>days to weeks</b>, so its warming follows the precursor emission rate, like
        aerosols in reverse.</p>
        <p style="margin-bottom:0;"><b>Warming contribution:</b> about +0.3 W/m² of forcing today — the third-largest
        human warming influence after CO₂ and methane.</p>`
    },
    N2O: {
      title: "Nitrous oxide (N₂O)",
      html: `
        <p style="margin-top:0;"><b>Where it comes from:</b> mostly farming — nitrogen fertilisers and manure give
        soil microbes extra nitrogen to convert into N₂O. Smaller amounts come from industry and burning. Natural
        soils and the ocean produce it too.</p>
        <p><b>Where it goes:</b> it is so stable that almost nothing in the lower atmosphere touches it — it is
        finally broken apart by intense ultraviolet sunlight high in the stratosphere.</p>
        <p><b>How long it lasts:</b> about <b>110–120 years</b> — between methane (12) and CO₂ (centuries).</p>
        <p style="margin-bottom:0;"><b>Warming potential:</b> kilogram for kilogram, about <b>270 times</b> CO₂ over a
        century. Bonus villain points: it is now also the biggest remaining threat to the ozone layer.</p>`
    },
    OTHER: {
      title: "Synthetic gases (CFCs, HFCs and friends)",
      html: `
        <p style="margin-top:0;"><b>Where they come from:</b> entirely human-made — refrigerants in fridges and air
        conditioners, foam-blowing agents, solvents and old aerosol-spray propellants. They do not exist in nature.</p>
        <p><b>Where they go:</b> the older CFCs are so inert they survive until ultraviolet light destroys them in the
        stratosphere (which is exactly where the released chlorine attacks the ozone layer). Their modern HFC
        replacements are removed lower down within a decade or two.</p>
        <p><b>How long they last:</b> from a few years (some HFCs) to <b>over a century</b> (CFC-12: ~100 years). This
        model treats the whole basket as one equivalent gas with a ~100-year lifetime.</p>
        <p style="margin-bottom:0;"><b>Warming potential:</b> enormous — CFC-12 warms about <b>10,000 times</b> more
        than CO₂ per kilogram. Look at this input's history: emissions peak around 1990 and collapse. That is the
        <b>Montreal Protocol</b> (1987), the most successful environmental treaty ever — signed to save the ozone
        layer, it also avoided a large amount of warming.</p>`
    },
    VOLC: {
      title: "Volcanic aerosols",
      html: `
        <p style="margin-top:0;"><b>Where they come from:</b> big explosive eruptions blast sulphur dioxide right up
        into the stratosphere, above the weather, where it turns into a haze of tiny sulphuric-acid droplets that
        spreads around the globe.</p>
        <p><b>What they do:</b> the haze reflects sunlight and <b>cools</b> the planet. Mt&nbsp;Pinatubo (1991) cooled
        Earth by about half a degree; Tambora (1815) caused the "year without a summer".</p>
        <p><b>How long they last:</b> because the haze sits above the rain, it takes <b>1–3 years</b> to settle out —
        much longer than pollution aerosols near the ground, but still brief on climate timescales.</p>
        <p style="margin-bottom:0;"><b>In this model:</b> the input is the optical thickness of haze injected each
        year; it decays away with a ~1.2-year lifetime. Try the Mega Volcano experiment — and notice how fast the
        climate recovers compared with a CO₂ pulse.</p>`
    },
    SOLAR: {
      title: "Solar forcing",
      html: `
        <p style="margin-top:0;"><b>What it is:</b> the Sun's brightness is not perfectly constant. It flickers by
        about 0.1% over the 11-year sunspot cycle, and can drift a little over centuries (a long quiet spell in the
        1600s — the Maunder Minimum — coincided with the "Little Ice Age" in Europe).</p>
        <p><b>How big is it:</b> small — the solar cycle moves the planet's energy balance by only about
        ±0.1 W/m², compared with roughly +3 W/m² from human greenhouse gases so far.</p>
        <p style="margin-bottom:0;"><b>Could the Sun explain recent warming?</b> No — satellites have measured the Sun
        directly since the 1970s, and its output has been flat or slightly declining while the planet warmed fastest.
        Test it yourself: switch this input off and see how little changes.</p>`
    },
    ALB: {
      title: "Albedo (planetary reflectivity)",
      html: `
        <p style="margin-top:0;"><b>What it is:</b> the fraction of incoming sunlight Earth reflects straight back to
        space — currently about <b>0.31</b> (31%). Clouds do most of the reflecting, then ice, snow, deserts and
        everything else down to dark ocean, which reflects almost nothing.</p>
        <p><b>Why it matters:</b> tiny changes are powerful — brightening the planet by just 0.01 reflects about
        3.4 W/m² of sunlight, comparable to all human greenhouse forcing. This also powers a feedback: melting
        sea ice exposes dark ocean, which absorbs more sunlight, which melts more ice.</p>
        <p style="margin-bottom:0;"><b>In this model:</b> the input sets the planet's reflectivity directly. The White
        Roofs experiment brightens it to 0.34 for fifty years — an exaggerated version of "paint everything white"
        geoengineering ideas.</p>`
    }
  };

  function openInputInfo(key){
    const info = INPUT_INFO[key];
    if (!info) return;
    const body = document.createElement("div");
    body.innerHTML = info.html;
    openModal(info.title, body);
  }

  // Inject an (i) button into every input card title (runs once at startup)
  function initInputInfoButtons(){
    for (const v of INPUT_VARS){
      if (!INPUT_INFO[v.toggle]) continue;
      const canvas = el(v.canvas);
      if (!canvas) continue;
      const title = canvas.closest(".plot-card")?.querySelector(".title");
      if (!title || title.querySelector(".info-btn")) continue;
      const btn = document.createElement("button");
      btn.className = "info-btn";
      btn.type = "button";
      btn.textContent = "i";
      btn.title = "Sources, sinks, lifetime and warming potential";
      btn.addEventListener("click", ()=>openInputInfo(v.toggle));
      title.appendChild(btn);
    }
    // the Natural Variability card reuses its explainer
    const ivTitle = el("plotInIV")?.closest(".plot-card")?.querySelector(".title");
    if (ivTitle && !ivTitle.querySelector(".info-btn")){
      const btn = document.createElement("button");
      btn.className = "info-btn";
      btn.type = "button";
      btn.textContent = "i";
      btn.title = "What the two variability sources are";
      btn.addEventListener("click", ()=>openIVNotice());
      ivTitle.appendChild(btn);
    }
  }

  // One-time explainer for Basic vs Advanced mode
  function openModeNotice(){
    const body = document.createElement("div");
    body.innerHTML = `
      <p style="margin-top:0;">You have switched to <b>Advanced</b> mode. Here is what changes:</p>
      <ul style="padding-left:18px; font-size:13px; line-height:1.55;">
        <li><b>Basic mode</b> is for exploring: pick a scenario, switch inputs on or off, and run the model.</li>
        <li><b>Advanced mode</b> lets you change things. Each input card gets an <b>Edit curve…</b> button —
            drag the control points to design your own emission pathway. An <b>Edit parameters</b> button
            appears in the Controls panel, where you can change the model itself (climate sensitivity,
            ocean heat uptake, carbon-cycle settings, variability details).</li>
      </ul>
      <p style="font-size:12px; color:#666; margin-bottom:0;">Anything you change is marked with an
      <b>EDITED</b> or <b>CUSTOM</b> badge, and <b>Reset scenario</b> always takes you back to the defaults.
      You can switch between the two modes at any time without losing your work.</p>
    `;
    openModal("Advanced mode: what changes?", body);
  }

  // One-time explainer when natural variability is first switched on
  function openIVNotice(){
    const body = document.createElement("div");
    body.innerHTML = `
      <p style="margin-top:0;">In the real world, temperatures wobble from year to year even when greenhouse
      gases and aerosols do not change. This model can include two sources of that natural randomness:</p>
      <ul style="padding-left:18px; font-size:13px; line-height:1.55;">
        <li><b>Ocean mixing (ENSO-like).</b> The ocean constantly stirs heat between its warm surface and cold
            depths. In some years (like El Niño) less cold water reaches the surface and the planet runs warm;
            in others (La Niña) the opposite. This only <i>moves</i> heat around — it doesn't create or destroy
            it — so the temperature wiggles but always comes back.</li>
        <li><b>Clouds &amp; sun.</b> Random changes in cloudiness (and small flickers in the Sun) briefly change
            how much sunlight the planet absorbs — you can see these as tiny wiggles on the Albedo input.
            Unlike ocean mixing, this genuinely adds or removes energy, so its effects can linger for years.</li>
      </ul>
      <p style="font-size:13px;">The chart on this card shows the random sequence the model will use, in watts
      per square metre. Every sequence is one possible realisation — press <b>Randomise</b> for a different one.</p>
      <p style="font-size:12px; color:#666; margin-bottom:0;">Real thermometer records (compare with HadCRUT in
      the temperature output) contain exactly this kind of variability — it is why observations look wiggly
      next to a smooth model run.</p>
    `;
    openModal("Natural variability: what just turned on?", body);
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
      const card = el(meta.canvas).closest(".plot-card");
      const active = inputVarActive(meta);
      if (card) card.style.display = active ? "" : "none";
      if (!active) continue;

      // In the mixed variant the minor-GHG cards show ERF titles/subtitles
      if (APP_VARIANT === "mixed" && meta.mixedCol && card){
        const t = card.querySelector(".title");
        const sub = card.querySelector(".subtitle");
        if (t && meta.mixedTitle) t.textContent = meta.mixedTitle;
        if (sub && meta.mixedSub) sub.textContent = meta.mixedSub;
      }

      const col = inputVarCol(meta);
      const baseAll = rows.map(r=>r[col]);
      const effAll = working.map(r=>r[col]);
      const base = pickByIdx(baseAll, idx);
      const eff = pickByIdx(effAll, idx);
      const enabled = !!state.toggles[meta.toggle];

      plotLines(el(meta.canvas), [
        {x: years, y: base, label:"SSP", color:"rgba(0,0,0,0.25)", width:1.5},
        {x: years, y: eff, label: enabled ? "used" : "disabled", color: enabled ? "#4d8bff" : "rgba(0,0,0,0.22)", width:2}
      ], {yLabel: inputVarUnits(meta), yDigits: inputVarDigits(meta), vline:2020, legend:false});
    }

    renderIVCard();
  }

  // Natural-variability card: plot the two random series (W/m²) exactly as
  // the model will use them (same seed).
  function renderIVCard(){
    const canvas = el("plotInIV");
    if (!canvas) return;
    const rows = getScenarioRows(state.scenario);
    const yearsAll = rows.map(r=>r.year);
    const idx = viewIndices(yearsAll);
    const years = pickByIdx(yearsAll, idx);
    const iv = (state.params && state.params.iv) || {};

    const series = [];
    if (iv.mixEnabled || iv.cloudEnabled){
      const ivs = generateIVSeries(yearsAll, iv);
      if (iv.mixEnabled) series.push({label:"Ocean mixing (heat to surface)", x:years, y:pickByIdx(ivs.q, idx), color:"#1f77b4", width:1.6});
      if (iv.cloudEnabled) series.push({label:"Clouds & sun (extra sunlight)", x:years, y:pickByIdx(ivs.fCloud, idx), color:"#e6a23c", width:1.6});
    } else {
      series.push({label:"(both sources off)", x:years, y:years.map(()=>0), color:"rgba(0,0,0,0.25)", width:1.4});
    }
    plotLines(canvas, series, {yLabel:"W/m²", yDigits:2});
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
      const block = el(meta.mini).closest(".mini-block");
      const active = inputVarActive(meta);
      if (block) block.style.display = active ? "" : "none";
      if (!active) continue;

      if (APP_VARIANT === "mixed" && meta.mixedCol && block){
        const t = block.querySelector(".mini-title");
        if (t && meta.mixedTitle) t.textContent = meta.mixedTitle;
      }

      plotLines(el(meta.mini), [
        mk(working.map(r=>r[inputVarCol(meta)]), !!state.toggles[meta.toggle])
      ], {yLabel: inputVarUnits(meta), yDigits: inputVarDigits(meta), vline:2020, legend:false, xTicks:4, yTicks:4});
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
      renderLocalSeries(years, out.map(r=>((r.T||0)-baseT)), out.map(r=>r.SL_total_m));
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
      if (state.forcingLines.alb){
        series.push({label:"Albedo", x:years, y: out.map(r=>r.F_alb ?? 0), color:"#17becf"});
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
    const isCompare = (state.mode === "compare");
    const inScenario = (state.mode === "edit" || state.mode === "output");
    panel.style.display = (inScenario || isCompare) ? "" : "none";
    if (!inScenario && !isCompare) return;
    const isOutput = (state.mode === "output");
    const rangeBox = el("viewRangeBox");
    if (rangeBox) rangeBox.style.display = isCompare ? "none" : "";
    const outBlock = el("fpOutputs");
    if (outBlock) outBlock.style.display = isOutput ? "" : "none";
    const addCmp = el("fpAddCompare");
    if (addCmp) addCmp.style.display = (isOutput && state.lastOutput) ? "" : "none";
    const cmpBlock = el("fpCompare");
    if (cmpBlock) cmpBlock.style.display = isCompare ? "" : "none";
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
    updateVariantUI();
    updateViewRangeUI();

    const isOutput = (state.mode === "output");

    // Header buttons
    el("btnRun").style.display = isOutput ? "none" : "";
    el("btnContinue").style.display = isOutput ? "" : "none";

    // Controls panel buttons: Edit parameters and Save inputs belong to the
    // edit view, Export outputs to the output view.
    if (isOutput && el("btnParams")) el("btnParams").style.display = "none";
    if (el("btnDownloadScenarioCSV")){
      el("btnDownloadScenarioCSV").style.display = isOutput ? "none" : "";
    }
    if (el("btnExportOutput")){
      el("btnExportOutput").style.display = isOutput ? "" : "none";
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
      if (el("fShowAlb")) el("fShowAlb").checked = state.forcingLines.alb;

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
    state.params = defaultParams();
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

