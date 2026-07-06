  // ========================
  // Plotting
  // ========================
  
  function plotLines(canvas, seriesList, options={}){
    // seriesList: [{label, x:[], y:[], color}]
    // options: {yLabel, xLabel, yDigits, xMin, xMax, yMin, yMax, legend, vline}
    const dpr = window.devicePixelRatio || 1;

    // If the canvas is not yet laid out, clientWidth can be 0. Retry a few frames.
    const w0 = canvas.clientWidth;
    if (!w0 || w0 < 30){
      canvas._plotRetry = (canvas._plotRetry || 0) + 1;
      if (canvas._plotRetry < 12){
        requestAnimationFrame(()=>plotLines(canvas, seriesList, options));
      }
      return;
    }
    canvas._plotRetry = 0;

    const hCss = canvas.classList.contains("autoHeight")
      ? canvas.clientHeight
      : (Number(canvas.dataset.height) || 240);
    const h = (hCss || (Number(canvas.dataset.height) || 240)) * dpr;
    const w = w0 * dpr;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,w,h);

    const pad = {l:62, r:12, t:18, b:36, ...(options.pad||{})};
    const xAll = seriesList.flatMap(s=>s.x||[]);
    const xMin = options.xMin ?? Math.min(...xAll);
    const xMax = options.xMax ?? Math.max(...xAll);

    const allY = seriesList.flatMap(s=>(s.y||[]).filter(v=>Number.isFinite(v)));
    let yMin = options.yMin ?? Math.min(...allY);
    let yMax = options.yMax ?? Math.max(...allY);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin=0; yMax=1; }
    if (yMin === yMax){ yMin -= 1; yMax += 1; }

    // Snap the y axis to "nice" bounds/steps so tick labels are round numbers
    const yNice = niceScale(yMin, yMax, options.yTicks ?? 5);
    yMin = yNice.min; yMax = yNice.max;
    const yTicks = yNice.ticks;
    const yTickDigits = tickDecimals(yNice.step);

    const xScale = x => pad.l*dpr + (x-xMin)/(xMax-xMin) * (w - (pad.l+pad.r)*dpr);
    const yScale = y => h - pad.b*dpr - (y-yMin)/(yMax-yMin) * (h - (pad.t+pad.b)*dpr);

    // axes
    ctx.strokeStyle = "#9aa8b3";
    ctx.lineWidth = 1*dpr;
    ctx.beginPath();
    ctx.moveTo(pad.l*dpr, pad.t*dpr);
    ctx.lineTo(pad.l*dpr, h-pad.b*dpr);
    ctx.lineTo(w-pad.r*dpr, h-pad.b*dpr);
    ctx.stroke();

    // Year ticks at nice values within the data range (bounds don't move)
    const xTickVals = niceTicksWithin(xMin, xMax, options.xTicks ?? 5);

    // grid
    ctx.strokeStyle = "#e0e7ed";
    for (let i=0; i<=yTicks; i++){
      const yy = pad.t*dpr + (h-(pad.t+pad.b)*dpr)*i/yTicks;
      ctx.beginPath();
      ctx.moveTo(pad.l*dpr, yy);
      ctx.lineTo(w-pad.r*dpr, yy);
      ctx.stroke();
    }
    for (const xv of xTickVals){
      const xx = xScale(xv);
      ctx.beginPath();
      ctx.moveTo(xx, pad.t*dpr);
      ctx.lineTo(xx, h-pad.b*dpr);
      ctx.stroke();
    }

    // uncertainty bands (optional)
    if (options.bands && options.bands.length){
      for (const b of options.bands){
        const xArr = b.x || [];
        const y0Arr = b.y0 || [];
        const y1Arr = b.y1 || [];
        if (!xArr.length) continue;
        ctx.fillStyle = b.color || "rgba(120,120,120,0.18)";
        ctx.beginPath();
        ctx.moveTo(xScale(xArr[0]), yScale(y1Arr[0]));
        for (let i=1; i<xArr.length; i++){
          ctx.lineTo(xScale(xArr[i]), yScale(y1Arr[i]));
        }
        for (let i=xArr.length-1; i>=0; i--){
          ctx.lineTo(xScale(xArr[i]), yScale(y0Arr[i]));
        }
        ctx.closePath();
        ctx.fill();
      }
    }


    // vertical marker line
    if (options.vline){
      const xx = xScale(options.vline);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.setLineDash([4*dpr,4*dpr]);
      ctx.beginPath();
      ctx.moveTo(xx, pad.t*dpr);
      ctx.lineTo(xx, h-pad.b*dpr);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ticks
    ctx.fillStyle = "#444";
    ctx.font = `${11*dpr}px Arial`;

    // y-axis tick labels: right-aligned near the axis (reduces overlap with y-axis title)
    ctx.textAlign = "right";
    for (let j=0; j<=yTicks; j++){
      const yv = yMin + yNice.step*j;
      ctx.fillText(yv.toFixed(yTickDigits), (pad.l-8)*dpr, yScale(yv)+4*dpr);
    }

    // x-axis tick labels: centered under ticks
    ctx.textAlign = "center";
    const xTickY = h - pad.b*dpr + 16*dpr;
    for (const xv of xTickVals){
      ctx.fillText(Math.round(xv).toString(), xScale(xv), xTickY);
    }
    ctx.textAlign = "left";

    // axis labels (units)
    const yLabel = options.yLabel || "";
    const xLabel = options.xLabel || "Year";
    ctx.fillStyle = "#333";
    ctx.font = `${11*dpr}px Arial`;

    if (yLabel){
      ctx.save();
      ctx.translate(12*dpr, (h - (pad.t+pad.b)*dpr)/2 + pad.t*dpr);
      ctx.rotate(-Math.PI/2);
      ctx.textAlign = "center";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
    if (xLabel){
      ctx.textAlign = "center";
      ctx.fillText(xLabel, (pad.l*dpr + (w-pad.r*dpr))/2, h-4*dpr);
      ctx.textAlign = "left";
    }

    // lines
    for (const s of seriesList){
      const xArr = s.x || [];
      const yArr = s.y || [];
      ctx.strokeStyle = s.color || "#4d8bff";
      ctx.lineWidth = ((s.width ?? 2) * dpr);
      ctx.beginPath();
      for (let i=0; i<xArr.length; i++){
        const xv = xArr[i], yv = yArr[i];
        if (!Number.isFinite(yv)) continue;
        const xx = xScale(xv);
        const yy = yScale(yv);
        if (i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
      }
      ctx.stroke();
    }

    // legend
    if (options.legend !== false){
      ctx.font = `${11*dpr}px Arial`;
      ctx.textAlign = "right";
      let lx = w - pad.r*dpr - 4*dpr;
      let ly = pad.t*dpr + 12*dpr;

      const legendItems = [];

      for (const s of seriesList){
        const label = s.label || "";
        if (!label) continue;
        if (s.hidden || s.skipLegend) continue;
        legendItems.push({label, color: s.color || "#4d8bff"});
      }
      if (options.bands && options.bands.length){
        for (const b of options.bands){
          const label = b.label || "";
          if (!label) continue;
          legendItems.push({label, color: b.color || "rgba(120,120,120,0.18)"});
        }
      }

      for (const it of legendItems){
        ctx.fillStyle = it.color;
        ctx.fillRect(lx-95*dpr, ly-8*dpr, 10*dpr, 10*dpr);
        ctx.fillStyle = "#111";
        ctx.fillText(it.label, lx-101*dpr, ly);
        ly += 16*dpr;
      }
      ctx.textAlign = "left";
    }

    // Hover metadata
    if (seriesList && seriesList.length){
      canvas._plotMeta = {
        type: "lines",
        dpr,
        w,
        h,
        pad,
        xMin,
        xMax,
        yMin,
        yMax,
        xArr: seriesList.reduce((acc,s)=> (s.x && s.x.length>acc.length) ? s.x : acc, []),
        series: seriesList,
        xScale,
        yScale,
        yDigits: (options.yDigits ?? 2)
      };
      bindPlotHover(canvas);
    }
  }



  function plotStackedPositive(canvas, x, layers, options={}){
    // layers: [{label, y:[] , color}]
    const dpr = window.devicePixelRatio || 1;

    const w0 = canvas.clientWidth;
    if (!w0 || w0 < 30){
      canvas._plotRetry = (canvas._plotRetry || 0) + 1;
      if (canvas._plotRetry < 12){
        requestAnimationFrame(()=>plotStackedPositive(canvas, x, layers, options));
      }
      return;
    }
    canvas._plotRetry = 0;

    const hCss = canvas.classList.contains("autoHeight")
      ? canvas.clientHeight
      : (Number(canvas.dataset.height) || 260);
    const h = (hCss || (Number(canvas.dataset.height) || 260)) * dpr;
    const w = w0 * dpr;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,w,h);

    const pad = {l:62, r:12, t:18, b:36, ...(options.pad||{})};
    const xMin = options.xMin ?? Math.min(...x);
    const xMax = options.xMax ?? Math.max(...x);

    const totals = x.map((_,i)=>layers.reduce((acc,ly)=>acc+(ly.y[i]||0),0));
    let yMin = options.yMin ?? 0;
    let yMax = options.yMax ?? Math.max(...totals);
    if (yMax === yMin) yMax = yMin + 1;

    const yNice = niceScale(yMin, yMax, options.yTicks ?? 5);
    yMin = yNice.min; yMax = yNice.max;
    const yTicks = yNice.ticks;
    const yTickDigits = tickDecimals(yNice.step);

    const xScale = xv => pad.l*dpr + (xv-xMin)/(xMax-xMin) * (w - (pad.l+pad.r)*dpr);
    const yScale = yv => h - pad.b*dpr - (yv-yMin)/(yMax-yMin) * (h - (pad.t+pad.b)*dpr);

    // axes + grid
    ctx.strokeStyle = "#9aa8b3";
    ctx.lineWidth = 1*dpr;
    ctx.beginPath();
    ctx.moveTo(pad.l*dpr, pad.t*dpr);
    ctx.lineTo(pad.l*dpr, h-pad.b*dpr);
    ctx.lineTo(w-pad.r*dpr, h-pad.b*dpr);
    ctx.stroke();

    const xTickVals = niceTicksWithin(xMin, xMax, options.xTicks ?? 5);

    ctx.strokeStyle = "#e0e7ed";
    for (let i=0; i<=yTicks; i++){
      const yy = pad.t*dpr + (h-(pad.t+pad.b)*dpr)*i/yTicks;
      ctx.beginPath();
      ctx.moveTo(pad.l*dpr, yy);
      ctx.lineTo(w-pad.r*dpr, yy);
      ctx.stroke();
    }
    for (const xv of xTickVals){
      const xx = xScale(xv);
      ctx.beginPath();
      ctx.moveTo(xx, pad.t*dpr);
      ctx.lineTo(xx, h-pad.b*dpr);
      ctx.stroke();
    }

    if (options.vline){
      const xx = xScale(options.vline);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.setLineDash([4*dpr,4*dpr]);
      ctx.beginPath();
      ctx.moveTo(xx, pad.t*dpr);
      ctx.lineTo(xx, h-pad.b*dpr);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ticks
    ctx.fillStyle = "#444";
    ctx.font = `${11*dpr}px Arial`;

    ctx.textAlign = "right";
    for (let j=0; j<=yTicks; j++) {
      const yv = yMin + yNice.step*j;
      ctx.fillText(yv.toFixed(yTickDigits), (pad.l-8)*dpr, yScale(yv)+4*dpr);
    }

    ctx.textAlign = "center";
    const xTickY = h - pad.b*dpr + 16*dpr;
    for (const xv of xTickVals){
      ctx.fillText(Math.round(xv).toString(), xScale(xv), xTickY);
    }
    ctx.textAlign = "left";

    // axis labels (units)
    const yLabel = options.yLabel || "";
    const xLabel = options.xLabel || "Year";
    ctx.fillStyle = "#333";
    ctx.font = `${11*dpr}px Arial`;
    if (yLabel){
      ctx.save();
      ctx.translate(12*dpr, (h - (pad.t+pad.b)*dpr)/2 + pad.t*dpr);
      ctx.rotate(-Math.PI/2);
      ctx.textAlign = "center";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
    if (xLabel){
      ctx.textAlign = "center";
      ctx.fillText(xLabel, (pad.l*dpr + (w-pad.r*dpr))/2, h-4*dpr);
      ctx.textAlign = "left";
    }

    // stacked fills
    const base = new Array(x.length).fill(0);
    for (const layer of layers){
      const top = base.map((b,i)=>b + (layer.y[i]||0));
      ctx.fillStyle = layer.color || "rgba(77,139,255,0.35)";
      ctx.beginPath();
      for (let i=0; i<x.length; i++){
        ctx.lineTo(xScale(x[i]), yScale(top[i]));
      }
      for (let i=x.length-1; i>=0; i--){
        ctx.lineTo(xScale(x[i]), yScale(base[i]));
      }
      ctx.closePath();
      ctx.fill();
      for (let i=0; i<x.length; i++) base[i] = top[i];
    }

    // outline total
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.6*dpr;
    ctx.beginPath();
    for (let i=0; i<x.length; i++){
      const xx = xScale(x[i]);
      const yy = yScale(base[i]);
      if (i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
    }
    ctx.stroke();

    // legend
    if (options.legend !== false){
      ctx.font = `${11*dpr}px Arial`;
      ctx.textAlign = "right";
      let lx = w - pad.r*dpr - 4*dpr;
      let ly = pad.t*dpr + 12*dpr;
      for (const layer of layers){
        if (!layer.label) continue;
        ctx.fillStyle = layer.color || "#4d8bff";
        ctx.fillRect(lx-80*dpr, ly-8*dpr, 10*dpr, 10*dpr);
        ctx.fillStyle = "#111";
        ctx.fillText(layer.label, lx-86*dpr, ly);
        ly += 16*dpr;
      }
      ctx.textAlign = "left";
    }

    // Hover metadata
    if (layers && layers.length){
      canvas._plotMeta = {
        type: "stack",
        dpr,
        w,
        h,
        pad,
        xMin,
        xMax,
        yMin,
        yMax,
        xArr: x,
        layers,
        total: base.slice(),
        xScale,
        yScale,
        yDigits: (options.yDigits ?? 2)
      };
      bindPlotHover(canvas);
    }
  }



  function plotForcingDecomp(canvas, x, comps, options={}){
    // comps: [{label, y:[], color}]
    const dpr = window.devicePixelRatio || 1;

    const w0 = canvas.clientWidth;
    if (!w0 || w0 < 30){
      canvas._plotRetry = (canvas._plotRetry || 0) + 1;
      if (canvas._plotRetry < 12){
        requestAnimationFrame(()=>plotForcingDecomp(canvas, x, comps, options));
      }
      return;
    }
    canvas._plotRetry = 0;

    const hCss = canvas.classList.contains("autoHeight")
      ? canvas.clientHeight
      : (Number(canvas.dataset.height) || 300);
    const h = (hCss || (Number(canvas.dataset.height) || 300)) * dpr;
    const w = w0 * dpr;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,w,h);

    const pad = {l:62, r:12, t:18, b:36, ...(options.pad||{})};
    const xMin = options.xMin ?? Math.min(...x);
    const xMax = options.xMax ?? Math.max(...x);

    const posSum = x.map((_,i)=>comps.reduce((acc,c)=>acc + (c.y[i]>0 ? c.y[i] : 0), 0));
    const negSum = x.map((_,i)=>comps.reduce((acc,c)=>acc + (c.y[i]<0 ? c.y[i] : 0), 0));

    let yMin = options.yMin ?? Math.min(...negSum);
    let yMax = options.yMax ?? Math.max(...posSum);
    if (yMin === yMax){ yMin -= 1; yMax += 1; }

    const yNice = niceScale(yMin, yMax, options.yTicks ?? 6);
    yMin = yNice.min; yMax = yNice.max;
    const yTicks = yNice.ticks;
    const yTickDigits = tickDecimals(yNice.step);

    const xScale = xv => pad.l*dpr + (xv-xMin)/(xMax-xMin) * (w - (pad.l+pad.r)*dpr);
    const yScale = yv => h - pad.b*dpr - (yv-yMin)/(yMax-yMin) * (h - (pad.t+pad.b)*dpr);

    // axes
    ctx.strokeStyle = "#9aa8b3";
    ctx.lineWidth = 1*dpr;
    ctx.beginPath();
    ctx.moveTo(pad.l*dpr, pad.t*dpr);
    ctx.lineTo(pad.l*dpr, h-pad.b*dpr);
    ctx.lineTo(w-pad.r*dpr, h-pad.b*dpr);
    ctx.stroke();

    const xTickVals = niceTicksWithin(xMin, xMax, options.xTicks ?? 5);

    // grid
    ctx.strokeStyle = "#e0e7ed";
    for (let i=0; i<=yTicks; i++){
      const yy = pad.t*dpr + (h-(pad.t+pad.b)*dpr)*i/yTicks;
      ctx.beginPath();
      ctx.moveTo(pad.l*dpr, yy);
      ctx.lineTo(w-pad.r*dpr, yy);
      ctx.stroke();
    }
    for (const xv of xTickVals){
      const xx = xScale(xv);
      ctx.beginPath();
      ctx.moveTo(xx, pad.t*dpr);
      ctx.lineTo(xx, h-pad.b*dpr);
      ctx.stroke();
    }

    // zero line
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1*dpr;
    ctx.beginPath();
    ctx.moveTo(pad.l*dpr, yScale(0));
    ctx.lineTo(w-pad.r*dpr, yScale(0));
    ctx.stroke();

    // vline
    if (options.vline){
      const xx = xScale(options.vline);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.setLineDash([4*dpr,4*dpr]);
      ctx.beginPath();
      ctx.moveTo(xx, pad.t*dpr);
      ctx.lineTo(xx, h-pad.b*dpr);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ticks
    ctx.fillStyle = "#444";
    ctx.font = `${11*dpr}px Arial`;

    ctx.textAlign = "right";
    for (let j=0; j<=yTicks; j++){
      const yv = yMin + yNice.step*j;
      ctx.fillText(yv.toFixed(yTickDigits), (pad.l-8)*dpr, yScale(yv)+4*dpr);
    }

    ctx.textAlign = "center";
    const xTickY = h - pad.b*dpr + 16*dpr;
    for (const xv of xTickVals){
      ctx.fillText(Math.round(xv).toString(), xScale(xv), xTickY);
    }
    ctx.textAlign = "left";

    // axis labels
    const yLabel = options.yLabel || "";
    const xLabel = options.xLabel || "Year";
    ctx.fillStyle = "#333";
    ctx.font = `${11*dpr}px Arial`;
    if (yLabel){
      ctx.save();
      ctx.translate(12*dpr, (h - (pad.t+pad.b)*dpr)/2 + pad.t*dpr);
      ctx.rotate(-Math.PI/2);
      ctx.textAlign = "center";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
    if (xLabel){
      ctx.textAlign = "center";
      ctx.fillText(xLabel, (pad.l*dpr + (w-pad.r*dpr))/2, h-4*dpr);
      ctx.textAlign = "left";
    }

    // stacking
    const posBase = new Array(x.length).fill(0);
    const negBase = new Array(x.length).fill(0);

    for (const c of comps){
      const hasNeg = c.y.some(v=>v<0);
      if (!hasNeg) continue;
      const top = negBase.map((b,i)=>b + (c.y[i]<0 ? c.y[i] : 0));
      ctx.fillStyle = c.color || "rgba(120,120,120,0.35)";
      ctx.beginPath();
      for (let i=0; i<x.length; i++){
        ctx.lineTo(xScale(x[i]), yScale(top[i]));
      }
      for (let i=x.length-1; i>=0; i--){
        ctx.lineTo(xScale(x[i]), yScale(negBase[i]));
      }
      ctx.closePath();
      ctx.fill();
      for (let i=0; i<x.length; i++) negBase[i] = top[i];
    }

    for (const c of comps){
      const hasPos = c.y.some(v=>v>0);
      if (!hasPos) continue;
      const top = posBase.map((b,i)=>b + (c.y[i]>0 ? c.y[i] : 0));
      ctx.fillStyle = c.color || "rgba(77,139,255,0.35)";
      ctx.beginPath();
      for (let i=0; i<x.length; i++){
        ctx.lineTo(xScale(x[i]), yScale(top[i]));
      }
      for (let i=x.length-1; i>=0; i--){
        ctx.lineTo(xScale(x[i]), yScale(posBase[i]));
      }
      ctx.closePath();
      ctx.fill();
      for (let i=0; i<x.length; i++) posBase[i] = top[i];
    }

    // total line
    const total = x.map((_,i)=>posSum[i] + negSum[i]);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.8*dpr;
    ctx.beginPath();
    for (let i=0; i<x.length; i++){
      const xx = xScale(x[i]);
      const yy = yScale(total[i]);
      if (i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
    }
    ctx.stroke();

    // legend
    if (options.legend !== false){
      ctx.font = `${11*dpr}px Arial`;
      ctx.textAlign = "right";
      let lx = w - pad.r*dpr - 4*dpr;
      let ly = pad.t*dpr + 12*dpr;
      for (const c of comps){
        if (!c.label) continue;
        ctx.fillStyle = c.color || "#4d8bff";
        ctx.fillRect(lx-95*dpr, ly-8*dpr, 10*dpr, 10*dpr);
        ctx.fillStyle = "#111";
        ctx.fillText(c.label, lx-101*dpr, ly);
        ly += 16*dpr;
      }
      ctx.textAlign = "left";
    }

    // Hover metadata
    if (comps && comps.length){
      canvas._plotMeta = {
        type: "forcingStack",
        dpr,
        w,
        h,
        pad,
        xMin,
        xMax,
        yMin,
        yMax,
        xArr: x,
        layers: comps,
        total,
        xScale,
        yScale,
        yDigits: (options.yDigits ?? 2)
      };
      bindPlotHover(canvas);
    }
  }

