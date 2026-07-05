  // ========================
  // App State
  // ========================
  const ALL_ROWS = parseCSV(CSV_DATA_TEXT);
  const BY_SCENARIO = groupByScenario(ALL_ROWS);

  const SCENARIOS = [
    {key:"ssp119", name:"SSP1-1.9", group:"ssp", desc:"Very strong mitigation. Rapid reductions in CO₂ and CH₄ emissions; low end-of-century forcing."},
    {key:"ssp126", name:"SSP1-2.6", group:"ssp", desc:"Strong mitigation. Emissions decline substantially; stabilising forcing by late century."},
    {key:"ssp245", name:"SSP2-4.5", group:"ssp", desc:"Intermediate pathway. Emissions peak mid-century and decline; moderate forcing by 2100."},
    {key:"ssp585", name:"SSP5-8.5", group:"ssp", desc:"High emissions. Fossil-fuel intensive pathway with strong forcing increases through the century."}
  ];

  // Teaching experiments (ported from the original Carbonator): derived row sets
  // registered as ordinary scenarios so all editing/plotting works on them too.
  for (const t of buildTeachingScenarios(BY_SCENARIO)){
    BY_SCENARIO.set(t.key, t.rows);
    SCENARIOS.push({key:t.key, name:t.name, group:t.group, desc:t.desc});
  }

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

