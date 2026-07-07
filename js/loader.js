  // ========================
  // Scenario loader (CSV import)
  // ========================
  // "+ Load scenario (CSV)…" in the sidebar creates a new user-defined scenario
  // from a CSV file. It appears under "User scenarios" (deletable via ×) and
  // behaves like any other scenario: it can be run, edited and saved.
  //
  // File format — one header row, then one row per time point:
  //   - a "Year" column plus any subset of the input variables;
  //   - variable columns are recognised by raw key (E_CO2_GtC_yr), by the display
  //     names used in saved files ("CO₂ emissions (GtC/yr)"), or by short aliases
  //     (CO2, CH4, Aerosol, Ozone, N2O, Other, Volcanic, Solar);
  //   - rows do NOT need to cover every year, and cells may be left blank: each
  //     column is interpolated through its own specified points with the same
  //     monotone spline used for in-app curve editing, and held constant before
  //     the first / after the last specified point.
  //
  // Baseline for variables NOT in the file:
  //   - if the file has a "scenario" column naming a known scenario (as files
  //     written by Save inputs CSV do), that scenario provides them;
  //   - otherwise they are zero (an idealised experiment, like the pulses).
  //
  // So a complete externally-authored scenario can be as small as:
  //   Year,CO2,Volcanic
  //   2020,10,0
  //   2030,5,-8
  //   2032,5,0
  //   2100,-2,0

  const LOADER_ALIASES = {
    E_CO2_GtC_yr:               ["eco2gtcyr", "co2emissions", "co2"],
    E_CH4_TgCH4_yr:             ["ech4tgch4yr", "ch4emissions", "methane", "ch4"],
    E_SO2_Tg_yr:                ["eso2tgyr", "aerosolemissions", "so2emissions", "so2"],
    E_volcAOD_yr:               ["evolcaodyr", "volcanicaerosolinjection", "volcanicemissions", "volcanicinjection"],
    E_N2O_Tg_yr:                ["en2otgyr", "n2oemissions"],
    E_O3prec_Tg_yr:             ["eo3prectgyr", "ozoneprecursoremissions", "ozoneprecursors"],
    E_XGHG_kt_yr:               ["exghgktyr", "syntheticgasemissions", "syntheticgases", "cfcemissions"],
    ERF_aerosol_rel1850_Wm2:    ["erfaerosolrel1850wm2", "aerosolerf", "aerosol", "aer"],
    ERF_o3_total_rel1850_Wm2:   ["erfo3totalrel1850wm2", "ozoneerf", "ozone", "o3"],
    ERF_N2O_rel1850_Wm2:        ["erfn2orel1850wm2", "n2oerf", "n2o"],
    ERF_otherWMGHG_rel1850_Wm2: ["erfotherwmghgrel1850wm2", "otherwmghgerf", "otherwmghg", "other"],
    ERF_volcanic_rel1850_Wm2:   ["erfvolcanicrel1850wm2", "volcanicerf", "volcanic", "volc"],
    ERF_solar_rel1850_Wm2:      ["erfsolarrel1850wm2", "solarerf", "solar"]
  };

  function loaderNormalize(h){
    return String(h)
      .replace(/₂/g, "2").replace(/₃/g, "3").replace(/₄/g, "4")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  // Map a header cell to an input column key (or "year"/"scenario"/null).
  function loaderMatchHeader(h){
    const n = loaderNormalize(h);
    if (!n) return null;
    if (n === "year" || n === "years" || n === "time") return "year";
    if (n === "scenario" || n === "name") return "scenario";
    let best = null, bestLen = 0;
    for (const col of Object.keys(LOADER_ALIASES)){
      for (const alias of LOADER_ALIASES[col]){
        if ((n === alias || n.startsWith(alias)) && alias.length > bestLen){
          best = col; bestLen = alias.length;
        }
      }
    }
    return bestLen >= 2 ? best : null;
  }

  // Split one CSV line, honouring double-quoted cells (as written by Excel).
  function loaderSplitLine(line){
    const cells = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++){
      const ch = line[i];
      if (inQ){
        if (ch === '"' && line[i+1] === '"'){ cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"' && cur === ""){
        inQ = true;
      } else if (ch === ","){
        cells.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  }

  // Parse CSV text -> {points: {col: [[year,value],...]}, ignored: [...], baseKey: string|null}
  // Throws Error with a user-readable message on malformed input.
  //
  // Multiple "Year" columns are allowed: each Year column provides the years for
  // the variable columns that FOLLOW it (until the next Year column), so different
  // variables can specify different numbers of node points, e.g.
  //   scenario,Year,CO2,Year,CH4
  //   ssp119,1850,0.55,1850,43.1
  //   ssp119,1900,1,1851,43.2
  //   ssp119,2100,3,1852,43.3
  //   ssp119,,,1853,43.9        <- CO2 block exhausted, CH4 continues
  function parseScenarioCSV(text){
    const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(l => l.trim() !== "");
    if (lines.length < 2) throw new Error("File has no data rows.");

    const header = loaderSplitLine(lines[0]);
    const colOf = header.map(loaderMatchHeader);
    if (!colOf.includes("year")) throw new Error('No "Year" column found in the header row.');
    const scenIdx = colOf.indexOf("scenario");

    // Bind each variable column to the nearest "Year" column on its left
    let curYearIdx = -1;
    const varCols = []; // {ci, col, yearIdx}
    for (let ci = 0; ci < colOf.length; ci++){
      if (colOf[ci] === "year"){ curYearIdx = ci; continue; }
      if (!colOf[ci] || colOf[ci] === "scenario") continue;
      if (curYearIdx === -1){
        throw new Error(`Column "${header[ci]}" appears before any "Year" column.`);
      }
      varCols.push({ci, col: colOf[ci], yearIdx: curYearIdx});
    }
    if (!varCols.length) throw new Error("No recognised input-variable columns found.");

    const ignored = header.filter((h, i) => colOf[i] === null && h.trim() !== "");

    let baseKey = null;
    const points = {};
    for (let li = 1; li < lines.length; li++){
      const cells = loaderSplitLine(lines[li]);
      if (scenIdx !== -1 && baseKey === null && (cells[scenIdx] || "").trim() !== ""){
        baseKey = cells[scenIdx].trim();
      }
      for (const vc of varCols){
        const y = Number((cells[vc.yearIdx] ?? "").trim());
        if (!Number.isFinite(y)) continue;
        const raw = (cells[vc.ci] ?? "").trim();
        if (raw === "") continue;
        const v = Number(raw);
        if (!Number.isFinite(v)) continue;
        (points[vc.col] = points[vc.col] || []).push([y, v]);
      }
    }

    const cols = Object.keys(points);
    if (!cols.length){
      throw new Error("No numeric values found for any recognised input variable.");
    }

    // Interpolation needs a common time span: all multi-point series must share
    // the same first and last year (single-point series are constants and exempt).
    const spans = cols
      .map(c => {
        const ys = points[c].map(p => p[0]);
        return {col: c, n: ys.length, from: Math.min(...ys), to: Math.max(...ys)};
      })
      .filter(s => s.n > 1);
    if (spans.length > 1){
      const from0 = spans[0].from, to0 = spans[0].to;
      const bad = spans.filter(s => s.from !== from0 || s.to !== to0);
      if (bad.length){
        const detail = spans.map(s => `${s.col}: ${s.from}–${s.to}`).join("; ");
        throw new Error("All variables must share the same start and end year for interpolation. Found: " + detail);
      }
    }

    return {points, ignored, baseKey};
  }

  // Interpolate sparse points onto the annual grid (monotone spline, clamped ends).
  function loaderInterpolate(pairs, gridYears){
    const byYear = new Map(pairs.sort((a, b) => a[0] - b[0])); // last duplicate wins
    const xs = [...byYear.keys()], ys = [...byYear.values()];
    if (xs.length === 1) return gridYears.map(() => ys[0]);
    const spline = makeMonotoneSpline(xs, ys);
    return gridYears.map(y => spline.evalAt(y));
  }

  let userScenarioCounter = 0;

  // Create a user scenario from CSV text; returns {key, applied, ignored, baseName}.
  function createUserScenarioFromCSV(text, filename){
    const parsed = parseScenarioCSV(text);

    // Baseline rows: the scenario named in the file if known, else zero-everything
    const MODEL_COLS = Object.keys(LOADER_ALIASES);
    let baseRows, baseName;
    if (parsed.baseKey && BY_SCENARIO.has(parsed.baseKey)){
      baseRows = BY_SCENARIO.get(parsed.baseKey);
      baseName = (SCENARIOS.find(s => s.key === parsed.baseKey) || {name: parsed.baseKey}).name;
    } else {
      baseRows = BY_SCENARIO.get("ssp245").map(r => {
        const o = {...r};
        for (const c of MODEL_COLS) o[c] = 0;
        return o;
      });
      baseName = "zero baseline";
    }
    const gridYears = baseRows.map(r => r.year);

    userScenarioCounter++;
    const key = "user" + userScenarioCounter;
    const name = String(filename || "Loaded scenario").replace(/\.csv$/i, "").slice(0, 40) || ("Loaded " + userScenarioCounter);

    const rows = baseRows.map(r => ({...r, scenario:key}));
    const applied = [];
    for (const col of Object.keys(parsed.points)){
      const series = loaderInterpolate(parsed.points[col], gridYears);
      rows.forEach((r, i) => { r[col] = series[i]; });
      const xs = parsed.points[col].map(p => p[0]);
      applied.push({col, n: xs.length, from: Math.min(...xs), to: Math.max(...xs)});
    }

    // Keep the emission and ERF representations of aerosol/volcanic in sync:
    // whichever the file specified drives the other.
    const has = c => Object.prototype.hasOwnProperty.call(parsed.points, c);
    if (has("E_SO2_Tg_yr") && !has("ERF_aerosol_rel1850_Wm2")){
      rows.forEach(r => { r.ERF_aerosol_rel1850_Wm2 = r.E_SO2_Tg_yr * SIMPLE_INPUTS.kAer; });
    } else if (has("ERF_aerosol_rel1850_Wm2")){
      rows.forEach(r => { r.E_SO2_Tg_yr = r.ERF_aerosol_rel1850_Wm2 / SIMPLE_INPUTS.kAer; });
    }
    if (has("E_volcAOD_yr") && !has("ERF_volcanic_rel1850_Wm2")){
      const erf = volcEmisToErf(rows.map(r => r.E_volcAOD_yr));
      rows.forEach((r, i) => { r.ERF_volcanic_rel1850_Wm2 = erf[i]; });
    } else if (has("ERF_volcanic_rel1850_Wm2")){
      const ev = volcErfToEmis(rows.map(r => r.ERF_volcanic_rel1850_Wm2));
      rows.forEach((r, i) => { r.E_volcAOD_yr = ev[i]; });
    }
    // Minor GHGs: files may specify either emissions or ERF; derive the other.
    if (has("ERF_N2O_rel1850_Wm2") && !has("E_N2O_Tg_yr")){
      const ev = n2oErfToEmis(rows.map(r => r.ERF_N2O_rel1850_Wm2));
      rows.forEach((r, i) => { r.E_N2O_Tg_yr = ev[i]; });
    }
    if (has("ERF_o3_total_rel1850_Wm2") && !has("E_O3prec_Tg_yr")){
      rows.forEach(r => { r.E_O3prec_Tg_yr = Math.max(0, r.ERF_o3_total_rel1850_Wm2 / MINOR_GHG.o3.kF); });
    }
    if (has("ERF_otherWMGHG_rel1850_Wm2") && !has("E_XGHG_kt_yr")){
      const ev = xghgErfToEmis(rows.map(r => r.ERF_otherWMGHG_rel1850_Wm2));
      rows.forEach((r, i) => { r.E_XGHG_kt_yr = ev[i]; });
    }

    const varTitle = c => {
      const v = INPUT_VARS.find(q => q.col === c || q.simpleCol === c);
      if (!v) return c;
      return v.simpleCol === c ? (v.simpleTitle || v.title) : v.title;
    };
    const specified = applied.map(a => varTitle(a.col)).join(", ");
    BY_SCENARIO.set(key, rows);
    SCENARIOS.push({
      key, name, group: "user",
      img: "assets/img/scenarios/custom.png",
      desc: `Loaded from ${filename}. Specifies ${specified}; other inputs from ${baseName}.`
    });
    USER_SCENARIOS.push(key);

    return {key, applied, ignored: parsed.ignored, baseName};
  }

  function loaderSummaryModal(result, filename){
    const body = document.createElement("div");
    const titleOf = c => {
      const v = INPUT_VARS.find(q => q.col === c || q.simpleCol === c);
      return v ? (v.simpleCol === c ? (v.simpleTitle || v.title) : v.title) : c;
    };
    let html = `<p>Loaded <b>${filename}</b> as a new user scenario:</p><ul>`;
    for (const a of result.applied){
      html += `<li><b>${titleOf(a.col)}</b> — ${a.n} point${a.n === 1 ? "" : "s"}` +
              (a.n > 1 ? ` (${a.from}–${a.to}, interpolated to annual)` : " (constant)") + `</li>`;
    }
    html += "</ul>";
    html += `<p style="font-size:12px;">Unspecified inputs come from <b>${result.baseName}</b>.</p>`;
    if (result.ignored.length){
      html += `<p style="color:#a05a00;">Ignored unrecognised column${result.ignored.length === 1 ? "" : "s"}: ${result.ignored.join(", ")}</p>`;
    }
    html += `<p style="font-size:12px; color:#666;">The scenario appears under <b>User scenarios</b> in the sidebar (× removes it). It is kept for this session only — Save inputs CSV to keep a copy.</p>`;
    body.innerHTML = html;
    openModal("Scenario loaded", body);
  }

  (function initLoader(){
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".csv,text/csv";
    picker.style.display = "none";
    document.body.appendChild(picker);

    // The sidebar is re-rendered often, so delegate from its container.
    el("sidebarList").addEventListener("click", (ev)=>{
      const t = ev.target.closest && ev.target.closest("#btnLoadScenarioSidebar");
      if (!t) return;
      picker.value = "";
      picker.click();
    });

    picker.addEventListener("change", () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = createUserScenarioFromCSV(String(reader.result), file.name);
          renderSidebar();
          selectScenario(result.key);
          loaderSummaryModal(result, file.name);
        } catch (err){
          alert("Could not load scenario file: " + err.message);
        }
      };
      reader.readAsText(file);
    });
  })();
