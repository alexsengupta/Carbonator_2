  // ========================
  // Teaching experiments
  // ========================
  // Ported from the original Carbonator (UNSW/CCRC Angular app, scenarios.data.ts)
  // and adapted to the SSP-based inputs of Carbonator 2:
  //  - the old app prescribed SO2/volcanic *emissions* and TSI/albedo; this model takes
  //    effective radiative forcings (ERF), so those experiments are expressed as ERF here.
  //  - all experiments run on the same 1850-2100 annual grid as the SSP scenarios.
  //
  // Each entry becomes a selectable scenario: its rows are derived from an SSP baseline
  // (or an idealised zero-forcing world) with the experiment applied on top.

  function buildTeachingScenarios(byScenario){
    const base245 = byScenario.get("ssp245");
    const base585 = byScenario.get("ssp585");
    if (!base245 || !base585) return [];

    // Columns the model actually reads (see runModel in js/model.js)
    const MODEL_COLS = [
      "E_CO2_GtC_yr", "E_CH4_TgCH4_yr",
      "ERF_N2O_rel1850_Wm2", "ERF_otherWMGHG_rel1850_Wm2",
      "ERF_aerosol_rel1850_Wm2", "ERF_o3_total_rel1850_Wm2",
      "ERF_solar_rel1850_Wm2", "ERF_volcanic_rel1850_Wm2"
    ];

    const copyRows = (base, key) => base.map(r => ({...r, scenario:key}));
    const zeroRows = (key) => base245.map(r => {
      const o = {...r, scenario:key};
      for (const c of MODEL_COLS) o[c] = 0;
      return o;
    });
    const valAt = (rows, col, year) => {
      const r = rows.find(q => q.year === year);
      return r ? r[col] : 0;
    };
    const lerp = (a, b, t) => a + (b - a) * t;

    const list = [];

    // --- CO2 Pulse -----------------------------------------------------------
    // Old app: constant forcing except a 10-year CO2 pulse at 20 PgC/yr.
    {
      const key = "co2pulse";
      const rows = zeroRows(key);
      for (const r of rows){
        if (r.year >= 2030 && r.year <= 2039) r.E_CO2_GtC_yr = 20;
      }
      list.push({key, name:"CO₂ Pulse", group:"teaching", rows,
        desc:"How would temperatures react to a sudden release of CO₂? All other forcings are zero except a 10-year pulse of CO₂ (2030–2039) at 20 GtC/yr. Note the long recovery: CO₂ is removed from the atmosphere only slowly."});
    }

    // --- CH4 Pulse -----------------------------------------------------------
    // Old app: constant forcing except a 10-year CH4 pulse at 1000 Tg/yr.
    {
      const key = "ch4pulse";
      const rows = zeroRows(key);
      for (const r of rows){
        if (r.year >= 2030 && r.year <= 2039) r.E_CH4_TgCH4_yr = 1000;
      }
      list.push({key, name:"CH₄ Pulse", group:"teaching", rows,
        desc:"How would temperatures react to a sudden release of methane? All other forcings are zero except a 10-year pulse of CH₄ (2030–2039) at 1000 Tg/yr. Compare the fast recovery with the CO₂ pulse: methane is removed within decades."});
    }

    // --- White Roofs ---------------------------------------------------------
    // Old app: albedo raised 0.31 -> 0.34 for 150 years. An albedo change of +0.03
    // is equivalent to about -10 W/m² of shortwave forcing (0.03 x ~340 W/m²);
    // it is applied here through the aerosol (shortwave reflection) channel.
    {
      const key = "whiteroofs";
      const rows = zeroRows(key);
      for (const r of rows){
        if (r.year >= 2030 && r.year <= 2079) r.ERF_aerosol_rel1850_Wm2 = -10.2;
      }
      list.push({key, name:"White Roofs", group:"teaching", rows,
        desc:"What would happen if we made the planet more reflective? All emissions are zero; planetary reflectivity (albedo) jumps from 0.31 to 0.34 between 2030 and 2080 (≈ −10 W/m², applied via the aerosol channel), then returns to normal."});
    }

    // --- Geoengineering ------------------------------------------------------
    // Old app: RCP8.5 with anthropogenic aerosols ramped up strongly over the
    // 21st century. Here: SSP5-8.5 with aerosol ERF ramped to -8 W/m² by 2070
    // and -11 W/m² by 2100 (solar radiation management by stratospheric aerosols).
    {
      const key = "geoeng";
      const rows = copyRows(base585, key);
      const a2020 = valAt(base585, "ERF_aerosol_rel1850_Wm2", 2020);
      for (const r of rows){
        if (r.year > 2020 && r.year <= 2070){
          r.ERF_aerosol_rel1850_Wm2 = lerp(a2020, -8.0, (r.year - 2020) / 50);
        } else if (r.year > 2070){
          r.ERF_aerosol_rel1850_Wm2 = lerp(-8.0, -11.0, (r.year - 2070) / 30);
        }
      }
      list.push({key, name:"Geoengineering", group:"teaching", rows,
        desc:"Can we pump aerosols into the stratosphere to counteract warming? Emissions follow SSP5-8.5, but reflective aerosol forcing is ramped up massively over the 21st century (to −8 W/m² by 2070). Watch what happens to temperature — and consider what is NOT fixed (e.g. ocean acidification)."});
    }

    // --- Geoengineering Failure ----------------------------------------------
    // Old app: as above, but aerosol emissions cut to zero in 2070. Tropospheric
    // and stratospheric aerosols wash out within a couple of years -> termination shock.
    {
      const key = "geoengfail";
      const rows = copyRows(base585, key);
      const a2020 = valAt(base585, "ERF_aerosol_rel1850_Wm2", 2020);
      for (const r of rows){
        if (r.year > 2020 && r.year <= 2070){
          r.ERF_aerosol_rel1850_Wm2 = lerp(a2020, -8.0, (r.year - 2020) / 50);
        } else if (r.year > 2070){
          r.ERF_aerosol_rel1850_Wm2 = 0;
        }
      }
      list.push({key, name:"Geoengineering Failure", group:"teaching", rows,
        desc:"What happens if geoengineering suddenly fails? As in the Geoengineering experiment, but in 2070 the aerosol injection stops. The aerosols wash out almost immediately while greenhouse gases remain — producing an abrupt 'termination shock' of rapid warming."});
    }

    // --- Eliminate all emissions today ----------------------------------------
    // Old app: RCP8.5 until 2020, then all emissions cut to zero. Here: SSP5-8.5
    // until 2025; from 2026 CO2/CH4 emissions and short-lived forcings (aerosol,
    // ozone) go to zero, while long-lived N2O / other-WMGHG forcings are held at
    // their 2025 values.
    {
      const key = "noemissions";
      const rows = copyRows(base585, key);
      const n2o2025 = valAt(base585, "ERF_N2O_rel1850_Wm2", 2025);
      const oth2025 = valAt(base585, "ERF_otherWMGHG_rel1850_Wm2", 2025);
      for (const r of rows){
        if (r.year >= 2026){
          r.E_CO2_GtC_yr = 0;
          r.E_CH4_TgCH4_yr = 0;
          r.ERF_aerosol_rel1850_Wm2 = 0;
          r.ERF_o3_total_rel1850_Wm2 = 0;
          r.ERF_N2O_rel1850_Wm2 = n2o2025;
          r.ERF_otherWMGHG_rel1850_Wm2 = oth2025;
        }
      }
      list.push({key, name:"Eliminate All Emissions", group:"teaching", rows,
        desc:"What if we suddenly stopped all greenhouse gas and aerosol emissions in 2026? Note the initial warming spike as cooling aerosols wash out, the rapid decline of methane, and the warming already committed by past CO₂ emissions."});
    }

    // --- Solar Variations ------------------------------------------------------
    // Old app: TSI stepped up and down for long blocks. Expressed here as solar
    // ERF steps of ±0.5 W/m² (an exaggerated solar variation — the real 11-year
    // cycle is only ~0.1-0.2 W/m² peak to trough).
    {
      const key = "solarvar";
      const rows = zeroRows(key);
      for (const r of rows){
        if (r.year >= 1920 && r.year <= 1969) r.ERF_solar_rel1850_Wm2 = 0.5;
        else if (r.year >= 2010 && r.year <= 2059) r.ERF_solar_rel1850_Wm2 = -0.5;
      }
      list.push({key, name:"Solar Variations", group:"teaching", rows,
        desc:"What happens if the Sun's output increases or decreases? All emissions are zero; solar forcing is raised by 0.5 W/m² for 50 years (1920–1969), then lowered by 0.5 W/m² for 50 years (2010–2059). These swings are much larger than the real ~0.1 W/m² solar cycle."});
    }

    // --- Large Volcanic Eruption ------------------------------------------------
    // Old app: aerosol optical depth 0.5 in 2020 with VF = -20 -> peak forcing
    // ~ -10 W/m², decaying with the ~1.2 yr stratospheric aerosol lifetime.
    // (Pinatubo 1991 peaked near -3 W/m² for comparison.)
    {
      const key = "megavolcano";
      const rows = zeroRows(key);
      const T0 = 2030, PEAK = -10.0, TAU = 1.2;
      for (const r of rows){
        if (r.year >= T0 && r.year <= T0 + 8){
          r.ERF_volcanic_rel1850_Wm2 = PEAK * Math.exp(-(r.year - T0) / TAU);
        }
      }
      list.push({key, name:"Mega Volcano", group:"teaching", rows,
        desc:"How does a very large volcanic eruption change global temperature? All emissions are zero; in 2030 a massive eruption injects reflective aerosols into the stratosphere (peak forcing −10 W/m², about three times Pinatubo), which wash out over a few years."});
    }

    return list;
  }
