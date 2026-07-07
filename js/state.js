  // ========================
  // App State
  // ========================
  const ALL_ROWS = parseCSV(CSV_DATA_TEXT);
  const BY_SCENARIO = groupByScenario(ALL_ROWS);

  const SCENARIOS = [
    {key:"ssp119", name:"SSP1-1.9", group:"ssp", img:"assets/img/scenarios/rcp3.jpeg", desc:"Very strong mitigation. Rapid reductions in CO₂ and CH₄ emissions; low end-of-century forcing."},
    {key:"ssp126", name:"SSP1-2.6", group:"ssp", img:"assets/img/scenarios/rcp3.jpeg", desc:"Strong mitigation. Emissions decline substantially; stabilising forcing by late century."},
    {key:"ssp245", name:"SSP2-4.5", group:"ssp", img:"assets/img/scenarios/rcp4.5.jpeg", desc:"Intermediate pathway. Emissions peak mid-century and decline; moderate forcing by 2100."},
    {key:"ssp585", name:"SSP5-8.5", group:"ssp", img:"assets/img/scenarios/rcp8.5.jpeg", desc:"High emissions. Fossil-fuel intensive pathway with strong forcing increases through the century."}
  ];

  // Teaching experiments (ported from the original Carbonator): derived row sets
  // registered as ordinary scenarios so all editing/plotting works on them too.
  for (const t of buildTeachingScenarios(BY_SCENARIO)){
    BY_SCENARIO.set(t.key, t.rows);
    SCENARIOS.push({key:t.key, name:t.name, group:t.group, img:t.img, desc:t.desc});
  }

  // Derive the simple-mode pseudo-emission columns (aerosol Tg/yr, volcanic AOD/yr)
  // for every scenario, including the teaching experiments registered above.
  for (const rows of BY_SCENARIO.values()) addSimpleEmissionCols(rows);

  // Keys of user-loaded scenarios (in-memory only; not persisted across reloads)
  const USER_SCENARIOS = [];

  // Output columns and their CSV display names — shared by Export outputs CSV
  // and the Compare view's outputs-file parser (keep the two in sync via this map).
  const OUTPUT_HEADER_MAP = [
    ["year","Year"],
    ["T","Surface temperature (°C)"],
    ["Tu","Upper ocean temperature (K)"],
    ["Tl","Deep ocean temperature (K)"],
    ["CO2_ppm","CO₂ concentration (ppm)"],
    ["CH4_ppb","CH₄ concentration (ppb)"],
    ["N2O_ppb_implied","N₂O concentration (ppb implied)"],
    ["OtherWMGHG_ppt_eq_implied","Other WMGHG (ppt-eq implied)"],
    ["pH","Ocean surface pH"],
    ["Ca_GtC","Atmospheric carbon (GtC)"],
    ["Cv_GtC","Vegetation carbon (GtC)"],
    ["Cs_GtC","Soil carbon (GtC)"],
    ["Cu_GtC","Upper ocean carbon (GtC)"],
    ["Cl_GtC","Deep ocean carbon (GtC)"],
    ["F_total","Total forcing (W/m²)"],
    ["F_co2","CO₂ forcing (W/m²)"],
    ["F_ch4","CH₄ forcing (W/m²)"],
    ["F_n2o","N₂O forcing (W/m²)"],
    ["F_other","Other WMGHG forcing (W/m²)"],
    ["F_aer","Aerosol forcing (W/m²)"],
    ["F_o3","Ozone forcing (W/m²)"],
    ["F_solar","Solar forcing (W/m²)"],
    ["F_volc","Volcanic forcing (W/m²)"],
    ["q_int_Wm2","Internal heat exchange q (W/m² annual mean)"],
    ["q_int_rms_Wm2","Internal heat exchange q (W/m² annual RMS)"],
    ["SL_total_m","Sea level rise total (m)"],
    ["SL_therm_m","Sea level rise thermal (m)"],
    ["SL_ice_m","Sea level rise land ice (m)"],
  ];

  const DEFAULTS = {
    uiMode: "basic",
    toggles: { CO2:true, CH4:true, AER:true, O3:true, N2O:true, OTHER:true, VOLC:true, SOLAR:true },
    params: {
      S:3.0, cu:8.0, cl:110.0, gamma:0.7,
      carbonConfig:2,
      carbonOverrides:{},
      methaneOverrides:{},
      seaOverrides:{},
      iv: {...IV_DEFAULT}
    },
    outputPanels: { sea:false, conc:false, carbon:false, ph:false, f:false, local:false },
    local: {lat:0, lon:0, mapVar:"tas"},
    concLines: { CO2:true, CH4:true, N2O:true, OTHER:false },
    carbonLines: { atm:true, veg:true, soil:true, upper:false, deep:false },
    forcingLines: { total:true, co2:true, ch4:true, n2o:true, other:true, o3:true, aer:true, solar:true, volc:true },
    compare: { hadcrut:false, gistemp:false, berkeley:false, cmip:false },
    curveDetailLevel: 1, // 0:25y, 1:10y, 2:5y, 3:1y (default 10y)
    viewStart: 1850,
    viewEnd: 2100
  };



  let state = {
    scenario: null,
    mode: "home", // home | edit | output
    inputMode: "emissions", // "emissions" (simple, default) | "full" (ERF inputs)
    erfNoticeShown: false,  // full-model explainer shown once per session
    uiMode: DEFAULTS.uiMode,
    viewStart: DEFAULTS.viewStart,
    viewEnd: DEFAULTS.viewEnd,
    toggles: {...DEFAULTS.toggles},
    params: JSON.parse(JSON.stringify(DEFAULTS.params)),
    outputPanels: {...DEFAULTS.outputPanels},
    local: {...DEFAULTS.local},
    concLines: {...DEFAULTS.concLines},
    carbonLines: {...DEFAULTS.carbonLines},
    forcingLines: {...DEFAULTS.forcingLines},
    compare: {...DEFAULTS.compare},
    customSeries: {}, // varKey -> array of annual values
    curveDetailPerVar: {}, // varKey -> level
    lastOutput: null
  };

  // Default climate sensitivity depends on the input mode (see SIMPLE_INPUTS.S)
  function defaultS(){
    return state.inputMode === "emissions" ? SIMPLE_INPUTS.S : DEFAULTS.params.S;
  }
  function defaultParams(){
    const p = JSON.parse(JSON.stringify(DEFAULTS.params));
    p.S = defaultS();
    return p;
  }
  state.params.S = defaultS(); // initial mode is "emissions"

