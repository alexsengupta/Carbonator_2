  // ========================
  // Utilities
  // ========================
  const fmt = (x, digits=2) => {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    const abs = Math.abs(x);
    if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return x.toExponential(digits);
    return Number(x).toFixed(digits);
  };

  function parseCSV(text) {
    // Split on real newline characters (optional CR for Windows files)
    const lines = text.trim().split(/\r?\n/);
    const header = lines[0].split(",");
    const out = [];
    for (let i=1; i<lines.length; i++) {
      const row = lines[i].split(",");
      if (row.length !== header.length) continue;
      const obj = {};
      for (let j=0; j<header.length; j++) {
        const k = header[j];
        const v = row[j];
        if (k === "scenario") obj[k] = v;
        else if (k === "year") obj[k] = Number(v);
        else obj[k] = (v === "" ? NaN : Number(v));
      }
      out.push(obj);
    }
    return out;
  }

  function groupByScenario(rows) {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.scenario)) map.set(r.scenario, []);
      map.get(r.scenario).push(r);
    }
    for (const [k, arr] of map.entries()) arr.sort((a,b) => a.year - b.year);
    return map;
  }

  // Basic linear interpolator on annual series
  function buildSeries(rows, key) {
    const years = rows.map(r => r.year);
    const vals = rows.map(r => r[key]);
    const y0 = years[0];
    return {
      years,
      vals,
      interp: (t) => {
        const i = Math.floor(t - y0);
        if (i < 0) return vals[0];
        if (i >= vals.length-1) return vals[vals.length-1];
        const f = (t - (y0 + i));
        return vals[i]*(1-f) + vals[i+1]*f;
      }
    };
  }

  // Monotone cubic Hermite spline (Fritsch–Carlson)
  function makeMonotoneSpline(x, y){
    const n = x.length;
    const d = new Array(n-1);
    const m = new Array(n);

    for (let i=0; i<n-1; i++){
      const h = x[i+1]-x[i];
      d[i] = h===0 ? 0 : (y[i+1]-y[i])/h;
    }
    m[0] = d[0];
    for (let i=1; i<n-1; i++){
      m[i] = 0.5*(d[i-1]+d[i]);
    }
    m[n-1] = d[n-2];

    for (let i=0; i<n-1; i++){
      if (d[i] === 0){
        m[i] = 0;
        m[i+1] = 0;
      } else {
        let a = m[i]/d[i];
        let b = m[i+1]/d[i];
        const s = a*a + b*b;
        if (s > 9){
          const t = 3 / Math.sqrt(s);
          m[i] = t*a*d[i];
          m[i+1] = t*b*d[i];
        }
      }
    }

    function evalAt(xq){
      if (xq <= x[0]) return y[0];
      if (xq >= x[n-1]) return y[n-1];
      // binary search interval
      let lo = 0, hi = n-1;
      while (hi - lo > 1){
        const mid = (lo+hi)>>1;
        if (x[mid] <= xq) lo = mid; else hi = mid;
      }
      const i = lo;
      const h = x[i+1]-x[i];
      const t = (xq - x[i]) / h;
      const t2 = t*t;
      const t3 = t2*t;
      const h00 = 2*t3 - 3*t2 + 1;
      const h10 = t3 - 2*t2 + t;
      const h01 = -2*t3 + 3*t2;
      const h11 = t3 - t2;
      return h00*y[i] + h10*h*m[i] + h01*y[i+1] + h11*h*m[i+1];
    }

    return { evalAt };
  }

  function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

  // "Nice" axis scaling: snap bounds/step to 1, 2 or 5 x 10^n so tick labels are
  // round numbers (e.g. -1..5 step 1, not -0.65..5.47 step 1.224).
  function niceScale(min, max, maxTicks=5){
    if (!Number.isFinite(min) || !Number.isFinite(max)){ min = 0; max = 1; }
    if (min === max){ min -= 1; max += 1; }
    const niceNum = (range, round) => {
      const exp = Math.floor(Math.log10(range));
      const f = range / Math.pow(10, exp);
      let nf;
      if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
      else       nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
      return nf * Math.pow(10, exp);
    };
    const step = niceNum((max - min) / Math.max(1, maxTicks), true);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    return { min: lo, max: hi, step, ticks: Math.round((hi - lo) / step) };
  }

  // Decimal places needed to print multiples of `step` exactly (capped at 6)
  function tickDecimals(step){
    let d = 0;
    while (d < 6 && Math.abs(Math.round(step * 10**d) - step * 10**d) > 1e-9) d++;
    return d;
  }

  // Nice tick values strictly WITHIN [min,max] — for axes whose bounds must not
  // move (e.g. the year axis spans exactly the data range).
  function niceTicksWithin(min, max, maxTicks=5){
    const step = niceScale(min, max, maxTicks).step;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step*1e-9; v += step){
      out.push(Math.abs(v) < step*1e-9 ? 0 : v);
    }
    return out;
  }

  // ------------------------
  // Random numbers (seeded)
  // ------------------------
  // Deterministic PRNG for reproducible “internal variability” runs.
  function mulberry32(seed){
    let a = (seed >>> 0) || 1;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Gaussian N(0,1) with caching (Box–Muller)
  function makeRandn(rng){
    let spare = null;
    return function(){
      if (spare !== null){
        const v = spare;
        spare = null;
        return v;
      }
      let u = 0, v = 0, s = 0;
      do{
        u = rng()*2 - 1;
        v = rng()*2 - 1;
        s = u*u + v*v;
      }while(s === 0 || s >= 1);
      const mul = Math.sqrt(-2*Math.log(s)/s);
      spare = v * mul;
      return u * mul;
    };
  }

  // Hover tooltips for plots
  const PLOT_TIP = document.getElementById("plotTip");
  function showPlotTip(html, clientX, clientY){
    if (!PLOT_TIP) return;
    PLOT_TIP.innerHTML = html;
    PLOT_TIP.style.display = "block";
    const pad = 12;
    let x = clientX + 12;
    let y = clientY + 12;
    const r = PLOT_TIP.getBoundingClientRect();
    if (x + r.width > window.innerWidth - pad) x = clientX - r.width - 12;
    if (y + r.height > window.innerHeight - pad) y = clientY - r.height - 12;
    x = Math.max(pad, x);
    y = Math.max(pad, y);
    PLOT_TIP.style.left = x + "px";
    PLOT_TIP.style.top = y + "px";
  }
  function hidePlotTip(){ if (PLOT_TIP) PLOT_TIP.style.display = "none"; }
  function nearestIndex(arr, value){
    let lo = 0, hi = arr.length - 1;
    if (hi < 0) return 0;
    if (value <= arr[lo]) return lo;
    if (value >= arr[hi]) return hi;
    while (hi - lo > 1){
      const mid = (lo + hi) >> 1;
      if (arr[mid] < value) lo = mid;
      else hi = mid;
    }
    return (Math.abs(arr[lo] - value) <= Math.abs(arr[hi] - value)) ? lo : hi;
  }
  function bindPlotHover(canvas){
    if (canvas._hoverBound) return;
    canvas._hoverBound = true;

    canvas.addEventListener("mousemove", (e)=>{
      const meta = canvas._plotMeta;
      if (!meta) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = meta.dpr || (window.devicePixelRatio || 1);
      const px = (e.clientX - rect.left) * dpr;
      const py = (e.clientY - rect.top) * dpr;

      const x0 = meta.pad.l * dpr;
      const x1 = meta.w - meta.pad.r * dpr;
      const y0 = meta.pad.t * dpr;
      const y1 = meta.h - meta.pad.b * dpr;

      if (px < x0 || px > x1 || py < y0 || py > y1){
        hidePlotTip();
        return;
      }

      const year = meta.xMin + (px - x0) / (x1 - x0) * (meta.xMax - meta.xMin);
      const i = nearestIndex(meta.xArr, year);
      const xVal = meta.xArr[i];
      const xPix = meta.xScale(xVal);

      let minDist = Infinity;
      const rows = [];

      if (meta.type === "lines"){
        for (const s of meta.series){
          const yVal = s.y[i];
          if (!Number.isFinite(yVal)) continue;
          const yPix = meta.yScale(yVal);
          const dist = Math.hypot(xPix - px, yPix - py);
          minDist = Math.min(minDist, dist);
          rows.push({label: s.label, color: s.color || "#444", value: yVal});
        }
      } else if (meta.type === "stack"){
        const total = meta.total[i];
        const yPixTotal = meta.yScale(total);
        minDist = Math.hypot(xPix - px, yPixTotal - py);
        for (const L of meta.layers){
          const yVal = L.y[i];
          if (!Number.isFinite(yVal)) continue;
          rows.push({label: L.label, color: L.color || "#444", value: yVal});
        }
        rows.push({label: "Total", color: "#111111", value: total});
      }
      else if (meta.type === "forcingStack"){
        const total = meta.total[i];
        const yPixTotal = meta.yScale(total);
        minDist = Math.hypot(xPix - px, yPixTotal - py);
        for (const L of meta.layers){
          const yVal = L.y[i];
          if (!Number.isFinite(yVal)) continue;
          rows.push({label: L.label, color: L.color || "#444", value: yVal});
        }
        rows.push({label: "Total", color: "#111111", value: total});
      }

      const thresh = 18 * dpr;
      if (!Number.isFinite(minDist) || minDist > thresh){
        hidePlotTip();
        return;
      }

      const yDigits = meta.yDigits ?? 2;
      const html = [
        `<div class="yr">${xVal}</div>`,
        ...rows.map(r=>{
          const dot = `<span style="color:${r.color}; font-weight:700;">●</span>`;
          return `<div>${dot} ${r.label}: ${fmt(r.value, yDigits)}</div>`;
        })
      ].join("");

      showPlotTip(html, e.clientX, e.clientY);
    });

    canvas.addEventListener("mouseleave", hidePlotTip);
  }

