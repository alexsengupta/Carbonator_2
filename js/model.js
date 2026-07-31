// ========================
  // Model (Sherwood 2022-style)
  // ========================

  // Carbon-cycle parameter sets (Table 1 in Sherwood et al. 2022)
  const CARBON_CONFIGS = {
    1: { m:0.054, delta:0.040, a2_per_1e3Gt:0.341, ka:0.145, kd:0.043, eps:0.31, d:66.4, A:174.8, Alk:767, k1:8.72e-7, k2:5.44e-10, Cu0:701, Cl0_1e3Gt:44.7, Cv0_1e3Gt:1.49, Cs0_1e3Gt:0.62, Pv0:80 },
    2: { m:0.070, delta:0.033, a2_per_1e3Gt:0.377, ka:0.180, kd:0.056, eps:0.62, d:54.4, A:143.7, Alk:767, k1:8.72e-7, k2:5.44e-10, Cu0:711, Cl0_1e3Gt:37.5, Cv0_1e3Gt:0.94, Cs0_1e3Gt:1.24, Pv0:65 },
    3: { m:0.130, delta:0.051, a2_per_1e3Gt:0.370, ka:0.268, kd:0.054, eps:0.54, d:42.5, A:112.7, Alk:767, k1:8.72e-7, k2:5.44e-10, Cu0:723, Cl0_1e3Gt:29.8, Cv0_1e3Gt:0.83, Cs0_1e3Gt:1.14, Pv0:108 },
    4: { m:0.105, delta:0.049, a2_per_1e3Gt:0.432, ka:0.171, kd:0.054, eps:0.40, d:39.7, A:105.6, Alk:767, k1:8.72e-7, k2:5.44e-10, Cu0:724, Cl0_1e3Gt:28.1, Cv0_1e3Gt:1.08, Cs0_1e3Gt:0.94, Pv0:113 }
  };

  const METHANE_DEFAULT = {
    tau0: 7.89,       // years
    alpha: -0.154,
    M0: 800           // ppb baseline (approx mid-19th century)
  };

  const SEA_DEFAULT = {
    // Semi-empirical, two-component sea level model (teaching approximation).
    // Driven by surface temperature anomaly T (°C relative to 1850):
    //   dSL_therm/dt = aTh * max(T - T0Th, 0) - SL_therm/tauTh
    //   dSL_ice/dt   = aIce * max(T - T0Ice, 0) - SL_ice/tauIce
    // This gives a quick thermal component + slower land-ice component and can reproduce
    // historical rise plus continued rise under sustained warming.
    aTh: 0.00087,    // m / (°C·yr)
    tauTh: 200,      // years (thermal response time)
    T0Th: -0.90,     // °C (effective equilibrium reference for thermal)
    aIce: 0.00087,   // m / (°C·yr)
    tauIce: 800,     // years (land-ice response time)
    T0Ice: -1.05     // °C (effective equilibrium reference for land ice)
  };

  // Internal variability (teaching): energy-conserving stochastic heat exchange between
  // upper and deep ocean layers, implemented as a damped stochastic oscillator that
  // generates a heat flux q(t) (W/m²). q(t) is added to the upper box and subtracted
  // from the deep box, so it redistributes heat without changing total energy.
  const IV_DEFAULT = {
    mixEnabled: false,   // ocean mixing (ENSO-like): energy-conserving heat exchange
    cloudEnabled: false, // clouds & sun: random shortwave (albedo) fluctuations
    // Amplitudes calibrated so that with both sources on, the model's
    // year-to-year temperature variability matches detrended HadCRUT5 (~0.08 K).
    amp: 1.0,            // W/m², mixing heat-exchange amplitude (typical: 0–2)
    period: 4.0,         // years, mixing oscillation period (ENSO-like: 2–7)
    tau: 4.0,            // years, mixing envelope damping (higher = more persistent)
    cloudAmp: 0.5,       // W/m², radiative (cloud/sun) noise amplitude (CERES: ~0.5)
    cloudTau: 1.0,       // years, radiative noise decorrelation time
    seed: 1
  };

  // Generate the two annual variability series for a given year grid.
  // Deterministic for a given seed, so the input charts show exactly the
  // realisation the model will use.
  //   q      : heat exchanged from deep to surface ocean (W/m²) — ENSO-like
  //            AR(2) damped oscillator; energy-conserving in the EBM.
  //   fCloud : radiative noise (W/m²) from random cloud/solar fluctuations —
  //            AR(1) red noise; genuinely adds/removes energy.
  //   dAlb   : the albedo perturbation equivalent to fCloud (applied to the
  //            albedo input so the cloud noise is visible there).
  function generateIVSeries(years, ivIn){
    const iv = {...IV_DEFAULT, ...(ivIn || {})};
    const n = years.length;
    const q = new Array(n).fill(0);
    const fCloud = new Array(n).fill(0);
    const dAlb = new Array(n).fill(0);

    if (iv.mixEnabled && iv.amp > 0){
      const r = Math.exp(-1 / Math.max(iv.tau, 1e-6));
      const theta = 2*Math.PI / Math.max(iv.period, 1e-6);
      const a1 = 2*r*Math.cos(theta);
      const a2 = -r*r;
      const gamma1 = a1 / (1 - a2);
      let sigmaE2 = 1 - (a1*a1*(1+a2)/(1 - a2)) - (a2*a2);
      if (!Number.isFinite(sigmaE2) || sigmaE2 <= 0) sigmaE2 = 1e-8;
      const sigmaE = Math.sqrt(sigmaE2);
      const randn = makeRandn(mulberry32((iv.seed|0) || 1));
      let x2 = randn();
      let x1 = gamma1*x2 + Math.sqrt(Math.max(1 - gamma1*gamma1, 0)) * randn();
      for (let i=0; i<n; i++){
        const x = a1*x1 + a2*x2 + sigmaE*randn();
        x2 = x1; x1 = x;
        q[i] = iv.amp * x;
      }
    }

    if (iv.cloudEnabled && iv.cloudAmp > 0){
      const phi = Math.exp(-1 / Math.max(iv.cloudTau, 1e-6));
      const randn = makeRandn(mulberry32(((iv.seed|0) || 1) + 7919));
      let x = randn();
      for (let i=0; i<n; i++){
        x = phi*x + Math.sqrt(1 - phi*phi)*randn();
        fCloud[i] = iv.cloudAmp * x;
        dAlb[i] = -fCloud[i] / SIMPLE_INPUTS.S0q; // +forcing = darker planet
      }
    }
    return {q, fCloud, dAlb};
  }

  // --- Simple (emissions) input mode -----------------------------------------
  // In the default "emissions" mode, aerosol and volcanic inputs are expressed as
  // emissions rather than ERF (as in the original Carbonator):
  //   human aerosol: ERF = kAer * E_SO2  (burden ~ emission rate: lifetime ~days)
  //   volcanic:      dA/dt = E - A/vtau, ERF = vf * A  (A = stratospheric AOD)
  // Minor forcings (O3, N2O, other WMGHG) are EXCLUDED (zero) in this mode, so
  // idealised experiments are exactly zero-forcing outside what the user sets.
  const SIMPLE_INPUTS = {
    kAer: -0.009,  // W/m² per Tg SO2/yr (~110 Tg/yr in 2005 -> ~ -1 W/m²)
    vf:   -20,     // W/m² per unit stratospheric AOD (Pinatubo AOD~0.15 -> ~ -3 W/m²)
    vtau: 1.2,     // yr, stratospheric aerosol decay (as in the original Carbonator)
    alb0: 0.31,    // baseline planetary albedo
    S0q:  340,     // S0/4, W/m²: forcing = -S0q * (albedo - alb0)
    // Default climate sensitivity for the simple model. Higher than the full
    // model's 3.0 °C (IPCC best estimate) but within the IPCC likely range
    // (2.5-4.0 °C); partly compensates for the excluded minor forcings so that
    // end-of-century warming stays close to the full model. Historical warming
    // still undershoots observations (ocean inertia limits what sensitivity can
    // do over a ramp) — a deliberate teaching point.
    S: 3.7
  };

  // Annual volcanic AOD-injection series -> annual ERF series (exact annual step)
  function volcEmisToErf(evals){
    const {vf, vtau} = SIMPLE_INPUTS;
    const e = Math.exp(-1/vtau);
    let A = 0;
    return evals.map(E => {
      A = A*e + Math.max(0, E)*vtau*(1-e);
      return vf*A;
    });
  }

  // Annual volcanic ERF series -> annual AOD-injection series (inverse of above)
  function volcErfToEmis(erfVals){
    const {vf, vtau} = SIMPLE_INPUTS;
    const e = Math.exp(-1/vtau);
    let Aprev = 0;
    return erfVals.map(f => {
      const A = (f || 0)/vf;
      const E = Math.max(0, (A - Aprev*e)/(vtau*(1-e)));
      Aprev = A;
      return E;
    });
  }

  // --- Minor greenhouse gases (full model): emission-driven ------------------
  // N2O: one-box, ~120-yr lifetime, square-root forcing (as in the IPCC simple
  //      expressions). Emissions in Tg N2O/yr; 1 ppb of N2O ~ 7.79 Tg.
  // O3:  tropospheric ozone is made from short-lived precursor pollution
  //      (NOx, CO, VOCs) within days, so forcing is proportional to the
  //      precursor emission rate (an index in ~Tg/yr, NOx-equivalent).
  // XGHG: the basket of synthetic industrial gases (CFCs, HFCs, ...) treated
  //      as ONE equivalent gas: linear forcing per ppt of CFC-12-equivalent,
  //      one-box with a ~100-yr effective lifetime. 1 ppt CFC-12 ~ 21.4 kt.
  const MINOR_GHG = {
    n2o:  { tau: 120, C0: 270, kF: 0.12,    tgPerPpb: 7.79 },
    o3:   { kF: 0.004 },                                        // W/m² per Tg/yr
    xghg: { tau: 100, kF: 0.00032, ktPerPpt: 21.4 }             // per ppt CFC-12-eq
  };

  // Gas/aerosol constants the user can override from the parameter editor.
  // (The emission series themselves are derived once at load time with the
  // DEFAULT values; changing these here changes how those emissions are
  // converted into forcing — which is exactly right for an emission-driven
  // model.)
  const GAS_DEFAULTS = {
    n2oTau:  MINOR_GHG.n2o.tau,    // yr
    n2oKF:   MINOR_GHG.n2o.kF,     // W/m² per sqrt(ppb)
    o3KF:    MINOR_GHG.o3.kF,      // W/m² per Tg/yr of precursor
    xghgTau: MINOR_GHG.xghg.tau,   // yr
    xghgKF:  MINOR_GHG.xghg.kF,    // W/m² per ppt CFC-12-eq
    kAer:    SIMPLE_INPUTS.kAer,   // W/m² per Tg SO2/yr
    vf:      SIMPLE_INPUTS.vf,     // W/m² per unit stratospheric AOD
    vtau:    SIMPLE_INPUTS.vtau    // yr
  };

  // Annual ERF series -> annual emission series (exact annual-step inversions,
  // same approach as volcErfToEmis). Used once per scenario at load time.
  function n2oErfToEmis(erfVals){
    const {tau, C0, kF, tgPerPpb} = MINOR_GHG.n2o;
    const e = Math.exp(-1/tau);
    const Enat = tgPerPpb * C0 / tau; // natural source holding the baseline steady
    let Cprev = C0;
    return erfVals.map(f => {
      const C = Math.pow(Math.sqrt(C0) + Math.max(-Math.sqrt(C0), (f || 0)/kF), 2);
      const E = tgPerPpb * (C - Cprev*e) / (tau*(1-e)) - Enat;
      Cprev = C;
      return Math.max(0, E);
    });
  }

  function xghgErfToEmis(erfVals){
    const {tau, kF, ktPerPpt} = MINOR_GHG.xghg;
    const e = Math.exp(-1/tau);
    let Cprev = 0;
    return erfVals.map(f => {
      const C = Math.max(0, (f || 0)/kF);
      const E = ktPerPpt * (C - Cprev*e) / (tau*(1-e));
      Cprev = C;
      return Math.max(0, E);
    });
  }

  // Derive ALL pseudo-emission columns from the ERF columns (in place, per
  // scenario): aerosol + volcanic (used in both modes) and the minor GHGs
  // (used by the full model).
  function addDerivedEmissionCols(rows){
    const {kAer} = SIMPLE_INPUTS;
    const evolc = volcErfToEmis(rows.map(r => r.ERF_volcanic_rel1850_Wm2 || 0));
    const en2o = n2oErfToEmis(rows.map(r => r.ERF_N2O_rel1850_Wm2 || 0));
    const exghg = xghgErfToEmis(rows.map(r => r.ERF_otherWMGHG_rel1850_Wm2 || 0));
    rows.forEach((r, i) => {
      r.E_SO2_Tg_yr = (r.ERF_aerosol_rel1850_Wm2 || 0)/kAer;
      r.E_volcAOD_yr = evolc[i];
      r.E_N2O_Tg_yr = en2o[i];
      r.E_O3prec_Tg_yr = Math.max(0, (r.ERF_o3_total_rel1850_Wm2 || 0)/MINOR_GHG.o3.kF);
      r.E_XGHG_kt_yr = exghg[i];
      if (!Number.isFinite(r.albedo)) r.albedo = SIMPLE_INPUTS.alb0; // planetary reflectivity input
    });
  }
  const addSimpleEmissionCols = addDerivedEmissionCols; // backwards-compatible name

  function carbonateFromCu(Cu, cfg){
    const term = 1 - (Cu / cfg.Alk);
    let disc = (cfg.k1*cfg.k1)*(term*term) - 4*cfg.k1*cfg.k2*(1 - 2*Cu/cfg.Alk);
    if (!Number.isFinite(disc) || disc < 0) disc = 0;
    const H = (-cfg.k1*term + Math.sqrt(disc)) / 2;
    const B = 1 / (1 + (cfg.k1/H) + (cfg.k1*cfg.k2)/(H*H));
    const pH = -Math.log10(H);
    return {B, H, pH};
  }

  function runModel(scenarioRows, params) {
    const years = scenarioRows.map(r => r.year);
    const y0 = years[0], yN = years[years.length-1];

    // Three model variants (params.inputMode):
    //   "emissions" (simple) — CO2/CH4/aerosol/volcanic/solar/albedo only;
    //                          minor GHGs excluded.
    //   "mixed"              — as above, plus the minor GHGs prescribed as
    //                          radiative forcing (ERF) time series.
    //   "full"               — everything emission-driven, incl. the minor
    //                          GHGs as small emission-driven sub-models.
    const simple = params.inputMode === "emissions";
    const mixed = params.inputMode === "mixed";
    const gas = {...GAS_DEFAULTS, ...(params.gasOverrides || {})};

    const s = {
      E_CO2: buildSeries(scenarioRows, "E_CO2_GtC_yr"),
      E_CH4: buildSeries(scenarioRows, "E_CH4_TgCH4_yr"),
      E_SO2: buildSeries(scenarioRows, "E_SO2_Tg_yr"),
      ERF_solar: buildSeries(scenarioRows, "ERF_solar_rel1850_Wm2"),
      ALB: buildSeries(scenarioRows, "albedo"),
    };
    if (mixed){
      s.ERF_N2O = buildSeries(scenarioRows, "ERF_N2O_rel1850_Wm2");
      s.ERF_o3 = buildSeries(scenarioRows, "ERF_o3_total_rel1850_Wm2");
      s.ERF_other = buildSeries(scenarioRows, "ERF_otherWMGHG_rel1850_Wm2");
    } else if (!simple){
      s.E_N2O = buildSeries(scenarioRows, "E_N2O_Tg_yr");
      s.E_O3 = buildSeries(scenarioRows, "E_O3prec_Tg_yr");
      s.E_XGHG = buildSeries(scenarioRows, "E_XGHG_kt_yr");
    }

    // Volcanic injections are impulsive: treat them as annual blocks rather than
    // spline-interpolating, so an eruption cannot leak into the preceding year.
    const volcEmisByYear = new Map(scenarioRows.map(r => [r.year, Math.max(0, r.E_volcAOD_yr || 0)]));
    let volcA = (scenarioRows[0].ERF_volcanic_rel1850_Wm2 || 0) / gas.vf;

    // Minor-GHG box states (full model)
    let Cn2o = MINOR_GHG.n2o.C0;   // ppb
    let Cxghg = 0;                 // ppt CFC-12-eq
    const n2oEnat = MINOR_GHG.n2o.tgPerPpb * MINOR_GHG.n2o.C0 / gas.n2oTau;

    // EBM parameters
    const S = params.S;
    const cu = params.cu;
    const cl = params.cl;
    const gamma = params.gamma;
    const F2x = 5.35 * Math.log(2);
    const lambda = F2x / S;

    // Carbon cycle config + overrides
    const cfgBase = CARBON_CONFIGS[params.carbonConfig];
    const cfg = {...cfgBase, ...(params.carbonOverrides||{})};
    const a2 = (cfg.a2_per_1e3Gt / 1000.0);

    // Methane
    const meth = {...METHANE_DEFAULT, ...(params.methaneOverrides||{})};

    // Sea level
    const sea = {...SEA_DEFAULT, ...(params.seaOverrides||{})};

    // Initial reservoirs (GtC)
    let Cu = cfg.Cu0;
    let Cl = cfg.Cl0_1e3Gt * 1000.0;
    let Cv = cfg.Cv0_1e3Gt * 1000.0;
    let Cs = cfg.Cs0_1e3Gt * 1000.0;

    // Equilibrium Ca0 = A * B(Cu0) * Cu0
    const carb0 = carbonateFromCu(Cu, cfg);
    const Ca0 = cfg.A * carb0.B * Cu;
    let Ca = Ca0;

    // Pre-industrial flux corrections: the published (rounded) reservoir/parameter
    // values are not an exact fixed point of the flux equations (e.g. for config 2,
    // kd*(Cu0 - Cl0/d) leaks ~1.2 GtC/yr into the deep ocean), so an unforced run
    // drifts (~-30 ppm CO2 by 2100). Subtracting the initial tendencies makes the
    // pre-industrial state an exact equilibrium; the corrections are internal
    // transfers that sum to zero, so total carbon is still conserved.
    const flux_ul0 = cfg.kd * (Cu - Cl / cfg.d);
    const dCv0 = cfg.Pv0 - cfg.m * Cv;
    const dCs0 = cfg.eps * cfg.m * Cv - cfg.delta * Cs;
    const dCa0 = (1 - cfg.eps) * cfg.m * Cv + cfg.delta * Cs - cfg.Pv0;

    // Methane init
    const M0 = meth.M0;
    let M = M0;

    // Natural methane source chosen to hold baseline steady
    const tauAtM0 = meth.tau0 * Math.pow( (M0/(M0+M0)), meth.alpha ); // ratio=0.5
    const E_nat = 2.78 * M0 / tauAtM0; // Tg/yr

    // EBM states (K)
    let Tu = 0.0, Tl = 0.0;

    // Sea level states (m)
    let SL_therm = 0.0;
    let SL_ice = 0.0;

    const dt = 1/12; // monthly

    // Internal variability: the ocean-mixing heat-exchange series q(t)
    // (W/m², deep->surface, energy-conserving) is generated at the input
    // stage (generateIVSeries via buildWorkingRows) and carried in the
    // q_iv_Wm2 column. Cloud/solar radiative noise arrives through the
    // albedo column, so it needs nothing extra here.
    const hasQ = Number.isFinite(scenarioRows[0] && scenarioRows[0].q_iv_Wm2);
    const sQ = hasQ ? buildSeries(scenarioRows, "q_iv_Wm2") : null;

    const out = [];

    for (let y=y0; y<=yN; y++){
      let qSum = 0, qSum2 = 0, fVolcSum = 0;
      for (let mth=0; mth<12; mth++){
        const t = y + (mth+0.5)/12;

        const E_C = s.E_CO2.interp(t);
        const E_CH4_anth = s.E_CH4.interp(t);

        // aerosol forcing proportional to emission rate; volcanic burden integrated
        const F_aer = gas.kAer * s.E_SO2.interp(t);
        volcA += ((volcEmisByYear.get(y) ?? 0) - volcA/gas.vtau) * dt;
        const F_volc = gas.vf * volcA;
        const F_solar = s.ERF_solar.interp(t);
        const F_alb = -SIMPLE_INPUTS.S0q * (s.ALB.interp(t) - SIMPLE_INPUTS.alb0);

        let F_o3, F_n2o, F_other;
        if (simple){
          F_o3 = 0; F_n2o = 0; F_other = 0;
        } else if (mixed){
          F_n2o = s.ERF_N2O.interp(t);
          F_o3 = s.ERF_o3.interp(t);
          F_other = s.ERF_other.interp(t);
        } else {
          const gN = MINOR_GHG.n2o, gX = MINOR_GHG.xghg;
          Cn2o += ((n2oEnat + Math.max(0, s.E_N2O.interp(t)))/gN.tgPerPpb - Cn2o/gas.n2oTau) * dt;
          F_n2o = gas.n2oKF * (Math.sqrt(Math.max(Cn2o, 1e-6)) - Math.sqrt(gN.C0));
          Cxghg += (Math.max(0, s.E_XGHG.interp(t))/gX.ktPerPpt - Cxghg/gas.xghgTau) * dt;
          F_other = gas.xghgKF * Cxghg;
          F_o3 = gas.o3KF * Math.max(0, s.E_O3.interp(t));
        }

        // --- Carbon cycle update (CO2) ---
        const carb = carbonateFromCu(Cu, cfg);
        const Pv = cfg.Pv0 * (1 + a2 * (Ca - Ca0)); // GtC/yr

        const flux_ao = cfg.ka * (Ca - cfg.A * carb.B * Cu);
        const flux_ul = cfg.kd * (Cu - Cl / cfg.d);

        const dCa = E_C - flux_ao + (1 - cfg.eps) * cfg.m * Cv + cfg.delta * Cs - Pv - dCa0;
        const dCu = flux_ao - (flux_ul - flux_ul0);
        const dCl = flux_ul - flux_ul0;
        const dCv = Pv - cfg.m * Cv - dCv0;
        const dCs = cfg.eps * cfg.m * Cv - cfg.delta * Cs - dCs0;

        Ca += dCa * dt;
        Cu += dCu * dt;
        Cl += dCl * dt;
        Cv += dCv * dt;
        Cs += dCs * dt;

        Ca = Math.max(Ca, 1e-6);
        Cu = Math.max(Cu, 1e-6);
        Cl = Math.max(Cl, 1e-6);
        Cv = Math.max(Cv, 1e-6);
        Cs = Math.max(Cs, 1e-6);

        const F_co2 = 5.35 * Math.log(Ca / Ca0);

        // --- Methane ---
        const tau = meth.tau0 * Math.pow( (M/(M+M0)), meth.alpha );
        const dM = (E_nat + E_CH4_anth) / 2.78 - M / tau;
        M += dM * dt;
        M = Math.max(M, 1e-6);
        const F_ch4 = 0.0316 * (Math.sqrt(M) - Math.sqrt(M0));

        fVolcSum += F_volc;

        const F_total = F_co2 + F_ch4 + F_n2o + F_other + F_aer + F_o3 + F_solar + F_volc + F_alb;

        // Internal variability heat exchange q(t) (from the input stage)
        const q = sQ ? sQ.interp(t) : 0;
        qSum += q;
        qSum2 += q*q;

        // --- EBM ---
        // cu dTu/dt = F - λTu - γ(Tu-Tl) + q
        // cl dTl/dt = γ(Tu-Tl) - q
        const dTu = (F_total - lambda*Tu - gamma*(Tu-Tl) + q) / cu;
        const dTl = (gamma*(Tu-Tl) - q) / cl;
        Tu += dTu * dt;
        Tl += dTl * dt;

        // --- Sea level: semi-empirical thermal + land-ice components (temperature-driven) ---
        const Tsurf = 1.11*Tu;
        const driveTh = Math.max(Tsurf - sea.T0Th, 0);
        const driveIce = Math.max(Tsurf - sea.T0Ice, 0);

        SL_therm += (sea.aTh * driveTh - SL_therm/sea.tauTh) * dt;
        SL_ice   += (sea.aIce * driveIce - SL_ice/sea.tauIce) * dt;

        if (SL_therm < 0) SL_therm = 0;
        if (SL_ice < 0) SL_ice = 0;
      }

      // Annual sample at year midpoint (recorded forcings must match what the
      // model actually applied)
      const tm = y + 0.5;
      const F_solar_m = s.ERF_solar.interp(tm);
      const F_aer_m = gas.kAer * s.E_SO2.interp(tm);
      const F_volc_m = fVolcSum/12; // annual mean of the integrated volcanic forcing
      const F_alb_m = -SIMPLE_INPUTS.S0q * (s.ALB.interp(tm) - SIMPLE_INPUTS.alb0);
      let F_o3_m, F_n2o_m, F_other_m;
      if (simple){
        F_o3_m = 0; F_n2o_m = 0; F_other_m = 0;
      } else if (mixed){
        F_n2o_m = s.ERF_N2O.interp(tm);
        F_o3_m = s.ERF_o3.interp(tm);
        F_other_m = s.ERF_other.interp(tm);
      } else {
        F_n2o_m = gas.n2oKF * (Math.sqrt(Math.max(Cn2o, 1e-6)) - Math.sqrt(MINOR_GHG.n2o.C0));
        F_other_m = gas.xghgKF * Cxghg;
        F_o3_m = gas.o3KF * Math.max(0, s.E_O3.interp(tm));
      }

      const carbY = carbonateFromCu(Cu, cfg);

      const ppmCO2 = Ca/2.13;
      const F_co2 = 5.35 * Math.log(Ca / Ca0);
      const F_ch4 = 0.0316 * (Math.sqrt(M) - Math.sqrt(M0));
      const F_total = F_co2 + F_ch4 + F_n2o_m + F_other_m + F_aer_m + F_o3_m + F_solar_m + F_volc_m + F_alb_m;

      // Sea level total (relative to 1850)
      const SL_total = SL_therm + SL_ice;

      out.push({
        year: y,
        Tu,
        Tl,
        T: 1.11*Tu,
        CO2_ppm: ppmCO2,
        CH4_ppb: M,
        Ca_GtC: Ca,
        Cu_GtC: Cu,
        Cl_GtC: Cl,
        Cv_GtC: Cv,
        Cs_GtC: Cs,
        pH: carbY.pH,
        F_total,
        F_co2,
        F_ch4,
        F_n2o: F_n2o_m,
        F_other: F_other_m,
        F_aer: F_aer_m,
        F_o3: F_o3_m,
        F_solar: F_solar_m,
        F_volc: F_volc_m,
        F_alb: F_alb_m,
        q_int_Wm2: qSum/12,
        q_int_rms_Wm2: Math.sqrt(qSum2/12),
        SL_total_m: SL_total,
        SL_therm_m: SL_therm,
        SL_ice_m: SL_ice
      });
    }

    return {out, meta:{y0,yN,Ca0,M0,E_nat,lambda}};
  }

