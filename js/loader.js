  // ========================
  // Scenario loader (CSV import)
  // ========================
  // Loads input time series from a CSV file and applies them as custom series on
  // the currently selected scenario (the same mechanism the curve editor uses).
  //
  // Format — one header row, then one row per time point:
  //   - a "Year" column (a leading "scenario" column, as written by Save inputs CSV,
  //     is ignored), plus any subset of the input variables;
  //   - variable columns are recognised by raw key (E_CO2_GtC_yr), by the display
  //     names used in saved files ("CO₂ emissions (GtC/yr)"), or by short aliases
  //     (CO2, CH4, Aerosol, Ozone, N2O, Other, Volcanic, Solar);
  //   - rows do NOT need to cover every year, and cells may be left blank: each
  //     column is interpolated through its own specified points with the same
  //     monotone spline used for in-app curve editing, and held constant before
  //     the first / after the last specified point.
  //
  // So a complete externally-authored scenario can be as small as:
  //   Year,CO2,Volcanic
  //   2020,10,0
  //   2030,5,-8
  //   2032,5,0
  //   2100,-2,0
  //
  // Variables not present in the file keep the selected scenario's own values.

  const LOADER_ALIASES = {
    E_CO2_GtC_yr:               ["eco2gtcyr", "co2emissions", "co2"],
    E_CH4_TgCH4_yr:             ["ech4tgch4yr", "ch4emissions", "methane", "ch4"],
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

  // Parse CSV text -> {applied:[{col,points}], ignored:[header]} and apply to state.
  // Throws Error with a user-readable message on malformed input.
  function applyScenarioCSV(text){
    const baseRows = getScenarioRows(state.scenario);
    if (!baseRows.length) throw new Error("Select a scenario before loading a file.");
    const gridYears = baseRows.map(r => r.year);

    const lines = text.trim().split(/\r?\n/).filter(l => l.trim() !== "");
    if (lines.length < 2) throw new Error("File has no data rows.");

    const header = loaderSplitLine(lines[0]);
    const colOf = header.map(loaderMatchHeader);
    const yearIdx = colOf.indexOf("year");
    if (yearIdx === -1) throw new Error('No "Year" column found in the header row.');

    const ignored = header.filter((h, i) => colOf[i] === null && h.trim() !== "");

    // Collect (year, value) points per recognised column
    const points = {};
    for (let li = 1; li < lines.length; li++){
      const cells = loaderSplitLine(lines[li]);
      const y = Number(cells[yearIdx]);
      if (!Number.isFinite(y)) continue;
      for (let ci = 0; ci < colOf.length; ci++){
        const col = colOf[ci];
        if (!col || col === "year" || col === "scenario") continue;
        const raw = (cells[ci] ?? "").trim();
        if (raw === "") continue;
        const v = Number(raw);
        if (!Number.isFinite(v)) continue;
        (points[col] = points[col] || []).push([y, v]);
      }
    }

    const cols = Object.keys(points);
    if (!cols.length) throw new Error("No numeric values found for any recognised input variable.");

    // Interpolate each column onto the scenario's annual grid
    const applied = [];
    for (const col of cols){
      // sort by year; on duplicate years the last row wins
      const byYear = new Map(points[col].sort((a, b) => a[0] - b[0]));
      const xs = [...byYear.keys()], ys = [...byYear.values()];
      let series;
      if (xs.length === 1){
        series = gridYears.map(() => ys[0]);
      } else {
        const spline = makeMonotoneSpline(xs, ys); // clamps outside [xs[0], xs[end]]
        series = gridYears.map(y => spline.evalAt(y));
      }
      state.customSeries[col] = series;
      applied.push({col, n: xs.length, from: xs[0], to: xs[xs.length-1]});
    }

    state.lastOutput = null;
    updateEditBadges();
    renderAll();
    return {applied, ignored};
  }

  function loaderSummaryModal(result, filename){
    const body = document.createElement("div");
    const titleOf = c => (INPUT_VARS.find(v => v.col === c) || {title: c}).title;
    let html = `<p>Loaded <b>${filename}</b> onto <b>${(currentScenarioMeta()||{}).name || state.scenario}</b>:</p><ul>`;
    for (const a of result.applied){
      html += `<li><b>${titleOf(a.col)}</b> — ${a.n} point${a.n === 1 ? "" : "s"}` +
              (a.n > 1 ? ` (${a.from}–${a.to}, interpolated to annual)` : " (constant)") + `</li>`;
    }
    html += "</ul>";
    if (result.ignored.length){
      html += `<p style="color:#a05a00;">Ignored unrecognised column${result.ignored.length === 1 ? "" : "s"}: ${result.ignored.join(", ")}</p>`;
    }
    html += `<p style="font-size:12px; color:#666;">Variables not in the file keep the scenario's own values. Press <b>Run scenario</b> to see the result; <b>Reset scenario</b> discards loaded series.</p>`;
    body.innerHTML = html;
    openModal("Inputs loaded", body);
  }

  (function initLoader(){
    const btn = el("btnLoadScenarioCSV");
    if (!btn) return;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".csv,text/csv";
    picker.style.display = "none";
    document.body.appendChild(picker);

    btn.addEventListener("click", () => { picker.value = ""; picker.click(); });
    picker.addEventListener("change", () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = applyScenarioCSV(String(reader.result));
          loaderSummaryModal(result, file.name);
        } catch (err){
          alert("Could not load scenario file: " + err.message);
        }
      };
      reader.readAsText(file);
    });
  })();
