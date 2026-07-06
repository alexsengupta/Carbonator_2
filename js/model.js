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
    enabled: false,
    amp: 0.7,     // W/m² (typical: 0–2)
    period: 4.0,  // years (typical ENSO-like: 2–7)
    tau: 4.0,     // years (envelope damping time; higher = more persistent)
    seed: 1
  };

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
    vtau: 1.2      // yr, stratospheric aerosol decay (as in the original Carbonator)
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

  // Derive the pseudo-emission columns from the ERF columns (in place, per scenario)
  function addSimpleEmissionCols(rows){
    const {kAer} = SIMPLE_INPUTS;
    const evolc = volcErfToEmis(rows.map(r => r.ERF_volcanic_rel1850_Wm2 || 0));
    rows.forEach((r, i) => {
      r.E_SO2_Tg_yr = (r.ERF_aerosol_rel1850_Wm2 || 0)/kAer;
      r.E_volcAOD_yr = evolc[i];
    });
  }

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

    const s = {
      E_CO2: buildSeries(scenarioRows, "E_CO2_GtC_yr"),
      E_CH4: buildSeries(scenarioRows, "E_CH4_TgCH4_yr"),
      ERF_N2O: buildSeries(scenarioRows, "ERF_N2O_rel1850_Wm2"),
      ERF_other: buildSeries(scenarioRows, "ERF_otherWMGHG_rel1850_Wm2"),
      ERF_aer: buildSeries(scenarioRows, "ERF_aerosol_rel1850_Wm2"),
      ERF_o3: buildSeries(scenarioRows, "ERF_o3_total_rel1850_Wm2"),
      ERF_solar: buildSeries(scenarioRows, "ERF_solar_rel1850_Wm2"),
      ERF_volc: buildSeries(scenarioRows, "ERF_volcanic_rel1850_Wm2"),
    };

    // Simple (emissions) input mode: aerosol/volcanic driven by emissions,
    // minor forcings excluded.
    const simple = params.inputMode === "emissions";
    let volcA = 0; // stratospheric aerosol burden (AOD units)
    let volcEmisByYear = null;
    if (simple){
      s.E_SO2 = buildSeries(scenarioRows, "E_SO2_Tg_yr");
      // Volcanic injections are impulsive: treat them as annual blocks rather than
      // spline-interpolating, so an eruption cannot leak into the preceding year.
      volcEmisByYear = new Map(scenarioRows.map(r => [r.year, Math.max(0, r.E_volcAOD_yr || 0)]));
      volcA = (scenarioRows[0].ERF_volcanic_rel1850_Wm2 || 0) / SIMPLE_INPUTS.vf;
    }

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

    // Internal variability: damped stochastic oscillator producing q(t) (W/m²),
    // exchanged between upper and deep ocean boxes (energy-conserving).
    const iv = {...IV_DEFAULT, ...(params.iv||{})};
    const ivOn = !!iv.enabled && (iv.amp > 0);

    let iv_x1 = 0, iv_x2 = 0;
    let iv_a1 = 0, iv_a2 = 0, iv_sigmaE = 0;
    let iv_randn = null;

    if (ivOn){
      const r = Math.exp(-dt / Math.max(iv.tau, 1e-6));
      const theta = 2*Math.PI*dt / Math.max(iv.period, 1e-6);
      iv_a1 = 2*r*Math.cos(theta);
      iv_a2 = -r*r;

      const gamma1 = iv_a1 / (1 - iv_a2);
      let sigmaE2 = 1 - (iv_a1*iv_a1*(1+iv_a2)/(1 - iv_a2)) - (iv_a2*iv_a2);
      if (!Number.isFinite(sigmaE2) || sigmaE2 <= 0) sigmaE2 = 1e-8;
      iv_sigmaE = Math.sqrt(sigmaE2);

      const rng = mulberry32((iv.seed|0) || 1);
      iv_randn = makeRandn(rng);

      // Draw initial conditions from the stationary distribution (unit variance)
      iv_x2 = iv_randn();
      iv_x1 = gamma1*iv_x2 + Math.sqrt(Math.max(1 - gamma1*gamma1, 0)) * iv_randn();
    }

    const out = [];

    for (let y=y0; y<=yN; y++){
      let qSum = 0, qSum2 = 0, fVolcSum = 0;
      for (let mth=0; mth<12; mth++){
        const t = y + (mth+0.5)/12;

        const E_C = s.E_CO2.interp(t);
        const E_CH4_anth = s.E_CH4.interp(t);

        let F_aer, F_o3, F_n2o, F_other, F_volc;
        const F_solar = s.ERF_solar.interp(t);
        if (simple){
          // aerosol forcing proportional to emission rate; volcanic burden integrated
          F_aer = SIMPLE_INPUTS.kAer * s.E_SO2.interp(t);
          volcA += ((volcEmisByYear.get(y) ?? 0) - volcA/SIMPLE_INPUTS.vtau) * dt;
          F_volc = SIMPLE_INPUTS.vf * volcA;
          F_o3 = 0; F_n2o = 0; F_other = 0;
        } else {
          F_aer = s.ERF_aer.interp(t);
          F_o3  = s.ERF_o3.interp(t);
          F_n2o = s.ERF_N2O.interp(t);
          F_other = s.ERF_other.interp(t);
          F_volc  = s.ERF_volc.interp(t);
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

        const F_total = F_co2 + F_ch4 + F_n2o + F_other + F_aer + F_o3 + F_solar + F_volc;

        // Internal variability heat exchange q(t)
        let q = 0;
        if (ivOn){
          const eps = iv_sigmaE * iv_randn();
          const x = iv_a1*iv_x1 + iv_a2*iv_x2 + eps;
          iv_x2 = iv_x1;
          iv_x1 = x;
          q = iv.amp * x;
        }
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
      // model actually applied, which differs between input modes)
      const tm = y + 0.5;
      const F_solar_m = s.ERF_solar.interp(tm);
      let F_aer_m, F_o3_m, F_n2o_m, F_other_m, F_volc_m;
      if (simple){
        F_aer_m = SIMPLE_INPUTS.kAer * s.E_SO2.interp(tm);
        F_volc_m = fVolcSum/12; // annual mean of the integrated volcanic forcing
        F_o3_m = 0; F_n2o_m = 0; F_other_m = 0;
      } else {
        F_aer_m = s.ERF_aer.interp(tm);
        F_o3_m  = s.ERF_o3.interp(tm);
        F_n2o_m = s.ERF_N2O.interp(tm);
        F_other_m = s.ERF_other.interp(tm);
        F_volc_m  = s.ERF_volc.interp(tm);
      }

      const carbY = carbonateFromCu(Cu, cfg);

      const ppmCO2 = Ca/2.13;
      const F_co2 = 5.35 * Math.log(Ca / Ca0);
      const F_ch4 = 0.0316 * (Math.sqrt(M) - Math.sqrt(M0));
      const F_total = F_co2 + F_ch4 + F_n2o_m + F_other_m + F_aer_m + F_o3_m + F_solar_m + F_volc_m;

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
        q_int_Wm2: qSum/12,
        q_int_rms_Wm2: Math.sqrt(qSum2/12),
        SL_total_m: SL_total,
        SL_therm_m: SL_therm,
        SL_ice_m: SL_ice
      });
    }

    return {out, meta:{y0,yN,Ca0,M0,E_nat,lambda}};
  }

