  // ========================
  // Schematic parameter editor
  // ========================
  // Draws the model as a flow diagram with every adjustable value sitting on
  // the component it controls. Chips are data-driven (PARAM_CHIPS below) and
  // read/write the same working copy (`tmp`) the table editor uses, so the two
  // views stay in sync and Apply/Reset are shared.

  // ---- helpers to bind a chip to a value in `tmp` -------------------------
  function ovAccess(bucket, key, defaults){
    return {
      get: (tmp) => (tmp[bucket] && tmp[bucket][key] !== undefined) ? tmp[bucket][key] : defaults[key],
      def: () => defaults[key],
      set: (tmp, v) => {
        if (!tmp[bucket]) tmp[bucket] = {};
        if (Math.abs(v - defaults[key]) < 1e-12) delete tmp[bucket][key];
        else tmp[bucket][key] = v;
      }
    };
  }
  function carbonAccess(key){
    return {
      get: (tmp) => (tmp.carbonOverrides && tmp.carbonOverrides[key] !== undefined)
        ? tmp.carbonOverrides[key] : CARBON_CONFIGS[tmp.carbonConfig][key],
      def: (tmp) => CARBON_CONFIGS[tmp.carbonConfig][key],
      set: (tmp, v) => {
        if (!tmp.carbonOverrides) tmp.carbonOverrides = {};
        if (Math.abs(v - CARBON_CONFIGS[tmp.carbonConfig][key]) < 1e-12) delete tmp.carbonOverrides[key];
        else tmp.carbonOverrides[key] = v;
      }
    };
  }
  function directAccess(key, defFn){
    return {
      get: (tmp) => tmp[key],
      def: () => defFn(),
      set: (tmp, v) => { tmp[key] = v; }
    };
  }
  function ivAccess(key){ return ovAccess("iv", key, IV_DEFAULT); }

  const fmtNum = (v, d) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d));

  // ---- chip registry ------------------------------------------------------
  // x/y = top-left of the chip rect in SVG units; w = width.
  const PARAM_CHIPS = [
    // ===================== climate view =====================
    { view:"climate", id:"S", x:654, y:124, w:196,
      label:(v)=>`climate sensitivity  S = ${v.toFixed(1)} °C`,
      title:"Climate sensitivity — S", units:"°C per CO₂ doubling",
      help:"How much the planet warms in the long run if CO₂ doubles. The single most important number in climate science: bigger S means the same emissions cause more warming.",
      min:1.5, max:6, step:0.1, typical:"likely 2.5–4.0 (IPCC)",
      ...directAccess("S", ()=>defaultS()) },

    { view:"climate", id:"cu", x:406, y:262, w:176,
      label:(v)=>`heat capacity  c_u = ${v.toFixed(0)}`,
      title:"Surface heat capacity — c_u", units:"W yr/m²/°C",
      help:"The heat capacity of the atmosphere, land and upper ocean combined. Smaller values let the surface warm faster from year to year.",
      min:3, max:20, step:0.5, typical:"6–10",
      ...directAccess("cu", ()=>DEFAULTS.params.cu) },

    { view:"climate", id:"cl", x:406, y:458, w:184,
      label:(v)=>`heat capacity  c_l = ${v.toFixed(0)}`,
      title:"Deep-ocean heat capacity — c_l", units:"W yr/m²/°C",
      help:"The heat capacity of the deep ocean — far larger than the surface, which is why the deep ocean responds over centuries.",
      min:40, max:250, step:5, typical:"80–150",
      ...directAccess("cl", ()=>DEFAULTS.params.cl) },

    { view:"climate", id:"gamma", x:486, y:330, w:84,
      label:(v)=>`γ = ${v.toFixed(2)}`,
      title:"Ocean heat exchange — γ", units:"W/m²/°C",
      help:"How fast heat mixes from the surface down into the deep ocean. Higher γ means slower warming now, but more warming still “in the pipeline”.",
      min:0.2, max:1.5, step:0.05, typical:"0.5–1.2",
      ...directAccess("gamma", ()=>DEFAULTS.params.gamma) },

    // gases (forcing panel)
    { view:"climate", id:"ch4tau", x:150, y:187, w:124,
      label:(v)=>`lifetime ${v.toFixed(1)} yr`,
      title:"Methane lifetime — τ₀", units:"years",
      help:"How long methane survives before oxidation destroys it. (The effective lifetime is a little longer than this base value, because methane slows down its own destruction.)",
      min:3, max:20, step:0.1, typical:"7–12",
      ...ovAccess("methaneOverrides", "tau0", METHANE_DEFAULT) },

    { view:"climate", id:"n2otau", x:150, y:212, w:124,
      label:(v)=>`lifetime ${v.toFixed(0)} yr`,
      title:"Nitrous oxide lifetime", units:"years",
      help:"N₂O is destroyed only by ultraviolet sunlight high in the stratosphere, so it lasts far longer than methane.",
      min:40, max:250, step:5, typical:"110–120",
      ...ovAccess("gasOverrides", "n2oTau", GAS_DEFAULTS) },

    { view:"climate", id:"xghgtau", x:150, y:237, w:124,
      label:(v)=>`lifetime ${v.toFixed(0)} yr`,
      title:"Synthetic gas lifetime", units:"years",
      help:"CFCs, HFCs and friends are bundled into one “equivalent gas”. Real lifetimes range from a few years (HFCs) to over a century (CFC-12); this is the effective average.",
      min:10, max:300, step:5, typical:"50–150",
      ...ovAccess("gasOverrides", "xghgTau", GAS_DEFAULTS) },

    { view:"climate", id:"o3k", x:150, y:262, w:124,
      label:(v)=>`${v.toFixed(3)} W per Tg`,
      title:"Ozone forcing per unit pollution", units:"W/m² per Tg/yr",
      help:"Ozone near the ground is made from short-lived pollution, so its warming simply tracks how much precursor pollution is emitted.",
      min:0.001, max:0.01, step:0.0005, typical:"0.003–0.005",
      ...ovAccess("gasOverrides", "o3KF", GAS_DEFAULTS) },

    { view:"climate", id:"kaer", x:150, y:287, w:124,
      label:(v)=>`${v.toFixed(3)} W per Tg`,
      title:"Aerosol cooling per unit emission", units:"W/m² per Tg SO₂/yr",
      help:"How much cooling each tonne of sulphur pollution causes by reflecting sunlight and brightening clouds. This is one of the most uncertain numbers in climate science.",
      min:-0.02, max:-0.002, step:0.001, typical:"−0.006 to −0.013",
      ...ovAccess("gasOverrides", "kAer", GAS_DEFAULTS) },

    { view:"climate", id:"vtau", x:150, y:312, w:124,
      label:(v)=>`lifetime ${v.toFixed(1)} yr`,
      title:"Volcanic aerosol lifetime", units:"years",
      help:"How long volcanic haze stays in the stratosphere before settling out. Because it sits above the weather, rain cannot wash it out quickly.",
      min:0.5, max:5, step:0.1, typical:"1–2",
      ...ovAccess("gasOverrides", "vtau", GAS_DEFAULTS) },

    { view:"climate", id:"cloudamp", x:150, y:362, w:124,
      label:(v)=>`σ ${v.toFixed(2)} W/m²`,
      title:"Cloud & sun variability", units:"W/m²",
      help:"Size of the random year-to-year swings in absorbed sunlight from changing cloudiness. Satellites measure about 0.5 W/m².",
      min:0, max:2, step:0.05, typical:"0.3–0.7",
      ...ivAccess("cloudAmp") },

    { view:"climate", id:"ivamp", x:150, y:387, w:124,
      label:(v)=>`σ ${v.toFixed(1)} W/m² · ${(0)}`,
      labelFn:(tmp)=>{
        const a = (tmp.iv && tmp.iv.amp !== undefined) ? tmp.iv.amp : IV_DEFAULT.amp;
        const p = (tmp.iv && tmp.iv.period !== undefined) ? tmp.iv.period : IV_DEFAULT.period;
        return `σ ${a.toFixed(1)} W/m² · ${p.toFixed(0)} yr`;
      },
      title:"Ocean mixing variability", units:"W/m²",
      help:"Size of the ENSO-like heat exchange between surface and deep ocean. This moves heat around without adding any, so temperature always recovers.",
      min:0, max:3, step:0.1, typical:"0.5–1.5",
      ...ivAccess("amp") },

    // sea level
    { view:"climate", id:"aTh", x:802, y:298, w:216,
      labelFn:(tmp)=>{
        const a = ovAccess("seaOverrides","aTh",SEA_DEFAULT).get(tmp);
        const t = ovAccess("seaOverrides","tauTh",SEA_DEFAULT).get(tmp);
        return `${(a*1000).toFixed(2)} mm/yr per °C · τ ${t.toFixed(0)} yr`;
      },
      title:"Thermal expansion rate", units:"m/yr per °C",
      help:"How fast sea level rises from water expanding as it warms. Shown here in millimetres per year for each degree of warming.",
      min:0.0002, max:0.002, step:0.00005, typical:"0.5–1.2 mm/yr/°C",
      ...ovAccess("seaOverrides", "aTh", SEA_DEFAULT) },

    { view:"climate", id:"aIce", x:802, y:352, w:216,
      labelFn:(tmp)=>{
        const a = ovAccess("seaOverrides","aIce",SEA_DEFAULT).get(tmp);
        const t = ovAccess("seaOverrides","tauIce",SEA_DEFAULT).get(tmp);
        return `${(a*1000).toFixed(2)} mm/yr per °C · τ ${t.toFixed(0)} yr`;
      },
      title:"Land-ice melt rate", units:"m/yr per °C",
      help:"How fast sea level rises from melting glaciers and ice sheets. This component keeps going for centuries after temperature stabilises.",
      min:0.0002, max:0.003, step:0.00005, typical:"0.5–1.5 mm/yr/°C",
      ...ovAccess("seaOverrides", "aIce", SEA_DEFAULT) },

    // ===================== carbon view =====================
    { view:"carbon", id:"P0", x:470, y:146, w:176,
      label:(v)=>`baseline P₀ = ${v.toFixed(0)} GtC/yr`,
      title:"Photosynthesis — P₀", units:"GtC/yr",
      help:"How much carbon plants take out of the air each year in the pre-industrial world.",
      min:30, max:150, step:1, typical:"60–110",
      ...carbonAccess("Pv0") },

    { view:"carbon", id:"a2", x:470, y:168, w:176,
      label:(v)=>`CO₂ fertilisation a₂ = ${v.toFixed(3)}`,
      title:"CO₂ fertilisation — a₂", units:"per 1000 GtC",
      help:"Plants grow faster when there is more CO₂ in the air. This sets how strong that extra uptake is — a brake on rising CO₂.",
      min:0, max:0.8, step:0.005, typical:"0.34–0.43",
      ...carbonAccess("a2_per_1e3Gt") },

    { view:"carbon", id:"m", x:824, y:234, w:164,
      label:(v)=>`turnover m = ${v.toFixed(3)} /yr`,
      title:"Vegetation turnover — m", units:"per year",
      help:"The fraction of plant carbon that dies and falls as litter each year. 1/m is roughly how long carbon stays in living plants.",
      min:0.02, max:0.2, step:0.005, typical:"0.05–0.13",
      ...carbonAccess("m") },

    { view:"carbon", id:"eps", x:824, y:256, w:164,
      label:(v)=>`to soil: ε = ${(v*100).toFixed(0)}%`,
      title:"Fraction to soil — ε", units:"fraction",
      help:"When plants die, this fraction becomes soil carbon; the rest returns straight to the air as respiration.",
      min:0, max:1, step:0.01, typical:"0.3–0.6",
      ...carbonAccess("eps") },

    { view:"carbon", id:"delta", x:504, y:338, w:164,
      label:(v)=>`decay δ = ${v.toFixed(3)} /yr`,
      title:"Soil decay rate — δ", units:"per year",
      help:"How fast soil carbon is broken down by microbes and returned to the atmosphere.",
      min:0.005, max:0.12, step:0.001, typical:"0.03–0.05",
      ...carbonAccess("delta") },

    { view:"carbon", id:"ka", x:256, y:232, w:160,
      label:(v)=>`rate k_a = ${v.toFixed(3)} /yr`,
      title:"Air–sea exchange rate — k_a", units:"per year",
      help:"How quickly the ocean surface soaks up CO₂ from the air. Try changing it: almost nothing happens! The surface ocean already keeps up with the atmosphere — the real bottleneck is mixing down into the deep ocean (k_d).",
      min:0.05, max:0.4, step:0.005, typical:"0.145–0.268",
      ...carbonAccess("ka") },

    { view:"carbon", id:"A", x:256, y:254, w:160,
      label:(v)=>`solubility A = ${v.toFixed(1)}`,
      title:"Ocean solubility — A", units:"—",
      help:"Sets the balance point between carbon in the air and carbon dissolved in the surface ocean.",
      min:60, max:220, step:1, typical:"105–175",
      ...carbonAccess("A") },

    { view:"carbon", id:"kd", x:256, y:400, w:160,
      label:(v)=>`rate k_d = ${v.toFixed(3)} /yr`,
      title:"Ocean overturning — k_d", units:"per year",
      help:"How fast surface water (and its carbon) mixes down into the deep ocean. This is the slow leak that eventually removes CO₂ for centuries.",
      min:0.01, max:0.15, step:0.002, typical:"0.043–0.056",
      ...carbonAccess("kd") },

    { view:"carbon", id:"d", x:256, y:422, w:160,
      label:(v)=>`depth ratio d = ${v.toFixed(1)}`,
      title:"Deep/upper volume ratio — d", units:"—",
      help:"How much bigger the deep ocean is than the surface layer — it sets how much carbon the deep ocean can ultimately hold.",
      min:20, max:100, step:1, typical:"40–66",
      ...carbonAccess("d") },

    { view:"carbon", id:"Alk", x:486, y:476, w:176,
      label:(v)=>`alkalinity Alk = ${v.toFixed(0)}`,
      title:"Ocean alkalinity — Alk", units:"—",
      help:"Alkalinity buffers the ocean's acidity. It controls how much extra CO₂ the ocean can absorb before it saturates, and how far pH falls.",
      min:500, max:1000, step:5, typical:"~767",
      ...carbonAccess("Alk") },
  ];

  // ---- SVG background art -------------------------------------------------
  const SCHEMATIC_DEFS = `
    <defs>
      <linearGradient id="ps-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#22333e"/><stop offset="1" stop-color="#4a626e"/>
      </linearGradient>
      <linearGradient id="ps-sea1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#cbe6f4"/><stop offset="1" stop-color="#9dcbe2"/>
      </linearGradient>
      <linearGradient id="ps-sea2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4d86aa"/><stop offset="1" stop-color="#2b5169"/>
      </linearGradient>
      <marker id="ps-red" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14"
              refX="7" refY="7" orient="auto"><path d="M1,1 L13,7 L1,13 z" fill="#b8402c"/></marker>
      <marker id="ps-org" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14"
              refX="7" refY="7" orient="auto"><path d="M1,1 L13,7 L1,13 z" fill="#dd8033"/></marker>
      <marker id="ps-blu" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12"
              refX="6" refY="6" orient="auto"><path d="M1,1 L11,6 L1,11 z" fill="#2c637f"/></marker>
      <marker id="ps-blu-s" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12"
              refX="6" refY="6" orient="auto-start-reverse"><path d="M1,1 L11,6 L1,11 z" fill="#2c637f"/></marker>
      <marker id="ps-pur" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11"
              refX="5.5" refY="5.5" orient="auto"><path d="M1,1 L10,5.5 L1,10 z" fill="#7d3f9c"/></marker>
      <marker id="ps-gry" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12"
              refX="6" refY="6" orient="auto"><path d="M1,1 L11,6 L1,11 z" fill="#4d6f84"/></marker>
      <marker id="ps-grn" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11"
              refX="5.5" refY="5.5" orient="auto"><path d="M1,1 L10,5.5 L1,10 z" fill="#5f8a57"/></marker>
      <marker id="ps-grn-s" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11"
              refX="5.5" refY="5.5" orient="auto-start-reverse"><path d="M1,1 L10,5.5 L1,10 z" fill="#5f8a57"/></marker>
      <marker id="ps-emis" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14"
              refX="7" refY="7" orient="auto"><path d="M1,1 L13,7 L1,13 z" fill="#8a5a12"/></marker>
    </defs>`;

  const SCHEMATIC_CLIMATE = `
    <rect x="0" y="0" width="1060" height="74" fill="url(#ps-sky)" rx="6"/>
    <text x="1036" y="22" text-anchor="end" class="ps-space">SPACE</text>
    <circle cx="58" cy="37" r="19" fill="#ffd76e" stroke="#e6b23c" stroke-width="3"/>

    <rect x="24" y="108" width="266" height="316" fill="#f5f9fb" stroke="#cfd8df" rx="8"/>
    <text x="40" y="130" class="ps-box">FORCINGS</text>
    <text x="40" y="147" class="ps-tiny">time series come from your input curves</text>
    <text x="40" y="174" class="ps-small">CO₂</text>
    <text x="150" y="174" class="ps-tiny">see carbon cycle tab</text>
    <text x="40" y="199" class="ps-small">CH₄</text>
    <text x="40" y="224" class="ps-small">N₂O</text>
    <text x="40" y="249" class="ps-small">Synthetic gases</text>
    <text x="40" y="274" class="ps-small">Ozone precursors</text>
    <text x="40" y="299" class="ps-small">Aerosols (SO₂)</text>
    <text x="40" y="324" class="ps-small">Volcanic</text>
    <text x="40" y="349" class="ps-small">Solar · Albedo</text>
    <text x="150" y="349" class="ps-tiny">no parameters</text>
    <text x="40" y="374" class="ps-small">Clouds &amp; sun noise</text>
    <text x="40" y="399" class="ps-small">Ocean-mixing noise</text>

    <text x="300" y="222" class="ps-flow">F(t)</text>
    <path d="M296 240 L376 240" stroke="#dd8033" stroke-width="5" marker-end="url(#ps-org)" fill="none"/>

    <rect x="390" y="176" width="320" height="128" fill="url(#ps-sea1)" stroke="#6d97ad" rx="8"/>
    <text x="406" y="200" class="ps-box">ATMOSPHERE + UPPER OCEAN</text>
    <text x="406" y="219" class="ps-small">temperature T</text>

    <path d="M636 176 L636 84" stroke="#b8402c" stroke-width="5" marker-end="url(#ps-red)" fill="none"/>
    <text x="654" y="112" class="ps-flow" fill="#8c2f1e">λT  heat radiated to space</text>
    <text x="654" y="159" class="ps-tiny">λ = F₂ₓ / S  ·  higher S ⇒ weaker cooling ⇒ more warming</text>

    <path d="M470 312 L470 366" stroke="#2c637f" stroke-width="4"
          marker-start="url(#ps-blu-s)" marker-end="url(#ps-blu)" fill="none"/>
    <text x="404" y="344" class="ps-flow">γ(T − T₀)</text>

    <path d="M604 316 q10 8 0 16 q-10 8 0 16 q10 6 0 12" stroke="#7d3f9c" stroke-width="3" fill="none" marker-end="url(#ps-pur)"/>
    <text x="620" y="338" class="ps-flow" fill="#6b2f86">q(t)</text>
    <text x="620" y="354" class="ps-tiny">random ocean mixing</text>

    <rect x="390" y="378" width="320" height="122" fill="url(#ps-sea2)" stroke="#2b5169" rx="8"/>
    <text x="406" y="402" class="ps-box ps-light">DEEP OCEAN</text>
    <text x="406" y="421" class="ps-small ps-light">temperature T₀</text>

    <text x="742" y="228" class="ps-flow">T</text>
    <path d="M716 240 L772 240" stroke="#4d6f84" stroke-width="4" marker-end="url(#ps-gry)" fill="none"/>
    <rect x="786" y="192" width="248" height="212" fill="#eef4fb" stroke="#b9c9dd" rx="8"/>
    <text x="802" y="216" class="ps-box">SEA LEVEL</text>
    <path d="M802 246 q22 -11 44 0 t44 0 t44 0 t44 0" stroke="#8fb7ff" stroke-width="2.5" fill="none"/>
    <path d="M802 256 q22 -11 44 0 t44 0 t44 0 t44 0" stroke="#4d8bff" stroke-width="3" fill="none"/>
    <text x="802" y="290" class="ps-small">warm water expands…</text>
    <text x="802" y="344" class="ps-small">…and land ice melts</text>
    <text x="802" y="390" class="ps-tiny">both driven by surface temperature T</text>

    <rect x="24" y="440" width="266" height="96" fill="#f2f7f0" stroke="#b9cdb4" rx="8"/>
    <text x="40" y="462" class="ps-box">CARBON CYCLE</text>
    <text x="40" y="480" class="ps-tiny">turns CO₂ emissions into concentrations</text>
    <text x="40" y="504" class="ps-small">5 reservoirs · 10 parameters</text>
    <path d="M154 436 L154 420" stroke="#5f8a57" stroke-width="3" marker-end="url(#ps-grn)" fill="none"/>`;

  const SCHEMATIC_CARBON = `
    <path d="M300 108 L300 40" stroke="#b8402c" stroke-width="5" marker-end="url(#ps-red)" fill="none"/>
    <text x="318" y="52" class="ps-flow" fill="#8c2f1e">F_CO₂ = 5.35 ln(C / C₀)   → to the climate system</text>
    <text x="318" y="70" class="ps-tiny">more atmospheric carbon ⇒ more trapped heat (logarithmic)</text>

    <text x="24" y="146" class="ps-flow" fill="#7a5210">your CO₂</text>
    <text x="24" y="162" class="ps-flow" fill="#7a5210">emissions E(t)</text>
    <path d="M24 176 L136 176" stroke="#8a5a12" stroke-width="5" marker-end="url(#ps-emis)" fill="none"/>

    <rect x="150" y="110" width="300" height="86" fill="#eaf1f6" stroke="#7f9bab" stroke-width="2" rx="8"/>
    <text x="166" y="134" class="ps-box">ATMOSPHERE</text>
    <text x="166" y="155" class="ps-stock">C_at · 590 GtC in 1850</text>
    <text x="166" y="176" class="ps-tiny">carbon here sets the CO₂ concentration</text>

    <rect x="700" y="110" width="220" height="86" fill="#eef6ea" stroke="#7fa374" stroke-width="2" rx="8"/>
    <text x="716" y="134" class="ps-box">PLANTS</text>
    <text x="716" y="155" class="ps-stock">C_veg · 940 GtC</text>
    <text x="716" y="176" class="ps-tiny">living vegetation</text>

    <rect x="700" y="300" width="220" height="86" fill="#f4f1e6" stroke="#a8996d" stroke-width="2" rx="8"/>
    <text x="716" y="324" class="ps-box">SOIL</text>
    <text x="716" y="345" class="ps-stock">C_soil · 1240 GtC</text>
    <text x="716" y="366" class="ps-tiny">dead organic matter</text>

    <rect x="150" y="286" width="300" height="82" fill="#d8ecf7" stroke="#6d97ad" stroke-width="2" rx="8"/>
    <text x="166" y="310" class="ps-box">UPPER OCEAN</text>
    <text x="166" y="331" class="ps-stock">C_up · 711 GtC</text>
    <text x="166" y="352" class="ps-tiny">its chemistry also sets ocean pH</text>

    <rect x="150" y="440" width="300" height="82" fill="#bcd9e9" stroke="#3f7791" stroke-width="2" rx="8"/>
    <text x="166" y="464" class="ps-box">DEEP OCEAN</text>
    <text x="166" y="485" class="ps-stock">C_deep · 37 500 GtC</text>
    <text x="166" y="506" class="ps-tiny">by far the biggest store — but slow to reach</text>

    <path d="M458 140 L694 140" stroke="#5f8a57" stroke-width="4" marker-end="url(#ps-grn)" fill="none"/>
    <text x="500" y="132" class="ps-flow" fill="#3f6338">photosynthesis P</text>

    <path d="M810 202 L810 294" stroke="#5f8a57" stroke-width="4" marker-end="url(#ps-grn)" fill="none"/>
    <text x="824" y="226" class="ps-flow" fill="#3f6338">litterfall</text>

    <path d="M760 202 C 760 250, 520 246, 452 208" stroke="#5f8a57" stroke-width="3"
          stroke-dasharray="6 4" marker-end="url(#ps-grn)" fill="none"/>
    <text x="516" y="240" class="ps-tiny">plant respiration — the rest goes straight back</text>

    <path d="M694 336 C 560 336, 500 320, 458 214" stroke="#5f8a57" stroke-width="4" marker-end="url(#ps-grn)" fill="none"/>
    <text x="536" y="330" class="ps-flow" fill="#3f6338">soil decay</text>

    <path d="M240 202 L240 280" stroke="#5f8a57" stroke-width="4"
          marker-start="url(#ps-grn-s)" marker-end="url(#ps-grn)" fill="none"/>
    <text x="256" y="224" class="ps-flow" fill="#3f6338">air–sea exchange</text>

    <path d="M240 374 L240 434" stroke="#5f8a57" stroke-width="4"
          marker-start="url(#ps-grn-s)" marker-end="url(#ps-grn)" fill="none"/>
    <text x="256" y="392" class="ps-flow" fill="#3f6338">overturning</text>

    <rect x="470" y="392" width="284" height="118" fill="#f6fafc" stroke="#c3d5de" rx="8"/>
    <text x="486" y="414" class="ps-box">OCEAN CHEMISTRY</text>
    <text x="486" y="434" class="ps-small">The more carbon the ocean already holds,</text>
    <text x="486" y="450" class="ps-small">the harder it is to absorb more — and the</text>
    <text x="486" y="466" class="ps-small">more acidic it becomes.</text>

    <rect x="776" y="392" width="258" height="118" fill="#fdf8ef" stroke="#e0cba5" rx="8"/>
    <text x="792" y="414" class="ps-box">PARAMETER SET</text>
    <text x="792" y="434" class="ps-small">Four published calibrations of</text>
    <text x="792" y="450" class="ps-small">this carbon cycle.</text>
    <text x="792" y="500" class="ps-tiny">switching resets every value here</text>`;

  // ---- build the interactive view -----------------------------------------
  // tmp     : working copy of params (mutated in place)
  // onEdit  : called after any change (so the host can refresh badges etc.)
  function buildParamSchematic(tmp, onEdit){
    const root = document.createElement("div");
    root.className = "ps-root";
    root.innerHTML = `
      <div class="ps-tabs">
        <button type="button" class="active" data-psview="climate">Climate system</button>
        <button type="button" data-psview="carbon">Carbon cycle</button>
      </div>
      <div class="ps-stage">
        <svg class="ps-svg" data-psview="climate" viewBox="0 0 1060 570" xmlns="http://www.w3.org/2000/svg">
          ${SCHEMATIC_DEFS}${SCHEMATIC_CLIMATE}
        </svg>
        <svg class="ps-svg" data-psview="carbon" viewBox="0 0 1060 540" style="display:none;"
             xmlns="http://www.w3.org/2000/svg">
          ${SCHEMATIC_DEFS}${SCHEMATIC_CARBON}
        </svg>
        <div class="ps-pop" style="display:none;"></div>
      </div>
      <div class="ps-hint">Click any <b>orange value</b> to change it. Changed values are outlined.</div>
    `;

    const svgs = {
      climate: root.querySelector('svg[data-psview="climate"]'),
      carbon: root.querySelector('svg[data-psview="carbon"]')
    };
    const pop = root.querySelector(".ps-pop");
    const SVGNS = "http://www.w3.org/2000/svg";

    // preset (carbon config) chip — special, opens a select
    function drawPresetChip(){
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "ps-chip");
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", 792); rect.setAttribute("y", 462);
      rect.setAttribute("width", 130); rect.setAttribute("height", 20);
      rect.setAttribute("rx", 9);
      const text = document.createElementNS(SVGNS, "text");
      text.setAttribute("x", 800); text.setAttribute("y", 476);
      text.textContent = `preset ${tmp.carbonConfig} ▾`;
      g.appendChild(rect); g.appendChild(text);
      g.addEventListener("click", ()=>openPresetPopover());
      svgs.carbon.appendChild(g);
    }

    function chipValueText(spec){
      return spec.labelFn ? spec.labelFn(tmp) : spec.label(spec.get(tmp));
    }

    function isEdited(spec){
      const d = spec.def(tmp);
      return Math.abs(spec.get(tmp) - d) > 1e-12;
    }

    const chipNodes = new Map();
    function drawChip(spec){
      const svg = svgs[spec.view];
      if (!svg) return;
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "ps-chip");
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", spec.x); rect.setAttribute("y", spec.y);
      rect.setAttribute("width", spec.w); rect.setAttribute("height", 19);
      rect.setAttribute("rx", 9);
      const text = document.createElementNS(SVGNS, "text");
      text.setAttribute("x", spec.x + 8); text.setAttribute("y", spec.y + 13);
      g.appendChild(rect); g.appendChild(text);
      g.addEventListener("click", ()=>openChipPopover(spec));
      svg.appendChild(g);
      chipNodes.set(spec.id, {g, text});
      refreshChip(spec);
    }

    function refreshChip(spec){
      const node = chipNodes.get(spec.id);
      if (!node) return;
      node.text.textContent = chipValueText(spec);
      node.g.classList.toggle("edited", isEdited(spec));
    }
    function refreshAll(){
      for (const spec of PARAM_CHIPS) refreshChip(spec);
      const presetText = svgs.carbon.querySelector(".ps-chip text");
      if (presetText && presetText.textContent.startsWith("preset")){
        presetText.textContent = `preset ${tmp.carbonConfig} ▾`;
      }
      if (onEdit) onEdit();
    }

    // Position the popover under a chip. Works from the chip's SVG user
    // coordinates mapped through the SVG's rendered rect, so it stays correct
    // at any modal width (and does not depend on layout-dependent clientWidth).
    function placePopoverAt(view, x, y, h){
      const svg = svgs[view];
      const stage = root.querySelector(".ps-stage");
      let sRect = svg.getBoundingClientRect();
      const stRect = stage.getBoundingClientRect();
      // If the diagram has not been laid out yet (modal opened in this same
      // tick), retry on the next frame rather than placing at a bogus scale.
      if (!sRect.width){
        requestAnimationFrame(()=>placePopoverAt(view, x, y, h));
        pop.style.display = "";
        return;
      }
      const vb = svg.viewBox.baseVal;
      const scale = (sRect.width || 1) / (vb.width || 1060);
      const popW = 262;

      let left = (sRect.left - stRect.left) + x * scale;
      if (stRect.width > popW + 8){
        left = Math.min(Math.max(left, 4), stRect.width - popW - 4);
      }
      const top = (sRect.top - stRect.top) + (y + h) * scale + 8;

      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
      pop.style.display = "";

      // flip above the chip if it would spill past the bottom of the diagram
      const popH = pop.offsetHeight || pop.getBoundingClientRect().height;
      if (top + popH > (sRect.top - stRect.top) + sRect.height){
        const above = (sRect.top - stRect.top) + y * scale - popH - 8;
        if (above > 0) pop.style.top = Math.round(above) + "px";
      }
    }

    function openChipPopover(spec){
      const cur = spec.get(tmp);
      const def = spec.def(tmp);
      pop.innerHTML = `
        <h4>${spec.title}</h4>
        <p class="ps-help">${spec.help}</p>
        <div class="ps-valrow">
          <span class="ps-val"></span>
          <span class="ps-def">default ${fmtNum(def, 3)}</span>
        </div>
        <input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${cur}" />
        <div class="ps-valrow ps-range">
          <span>${fmtNum(spec.min,3)}</span><span>${spec.typical || ""}</span><span>${fmtNum(spec.max,3)}</span>
        </div>
        <div class="ps-btns">
          <button type="button" class="btn orange" data-act="ok">Done</button>
          <button type="button" class="btn" data-act="reset">Reset</button>
        </div>
      `;
      const slider = pop.querySelector("input");
      const valEl = pop.querySelector(".ps-val");
      const showVal = () => {
        const v = Number(slider.value);
        valEl.textContent = `${fmtNum(v, 3)}${spec.units ? " " + spec.units : ""}`;
      };
      showVal();
      slider.addEventListener("input", ()=>{
        spec.set(tmp, Number(slider.value));
        showVal();
        refreshChip(spec);
        if (onEdit) onEdit();
      });
      pop.querySelector('[data-act="ok"]').addEventListener("click", ()=>{ pop.style.display = "none"; });
      pop.querySelector('[data-act="reset"]').addEventListener("click", ()=>{
        spec.set(tmp, def);
        slider.value = def;
        showVal();
        refreshChip(spec);
        if (onEdit) onEdit();
      });
      placePopoverAt(spec.view, spec.x, spec.y, 19);
    }

    function openPresetPopover(){
      pop.innerHTML = `
        <h4>Carbon-cycle parameter set</h4>
        <p class="ps-help">Four published calibrations of this carbon cycle (Sherwood et al. 2022). Switching set replaces every carbon value on this diagram.</p>
        <select class="ps-select">
          ${[1,2,3,4].map(n=>`<option value="${n}" ${n===tmp.carbonConfig?"selected":""}>Preset ${n}</option>`).join("")}
        </select>
        <div class="ps-btns" style="margin-top:10px;">
          <button type="button" class="btn orange" data-act="ok">Done</button>
        </div>
      `;
      pop.querySelector("select").addEventListener("change", (e)=>{
        tmp.carbonConfig = Number(e.target.value);
        tmp.carbonOverrides = {};
        refreshAll();
      });
      pop.querySelector('[data-act="ok"]').addEventListener("click", ()=>{ pop.style.display = "none"; });
      placePopoverAt("carbon", 792, 462, 20);
    }

    // tab switching
    root.querySelectorAll(".ps-tabs button").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const v = btn.dataset.psview;
        root.querySelectorAll(".ps-tabs button").forEach(b=>b.classList.toggle("active", b===btn));
        Object.entries(svgs).forEach(([k, svg])=>{ svg.style.display = (k===v) ? "" : "none"; });
        pop.style.display = "none";
      });
    });

    // dismiss popover when clicking elsewhere in the stage
    root.querySelector(".ps-stage").addEventListener("click", (e)=>{
      if (!e.target.closest(".ps-chip") && !e.target.closest(".ps-pop")) pop.style.display = "none";
    });

    for (const spec of PARAM_CHIPS) drawChip(spec);
    drawPresetChip();

    root.refreshAll = refreshAll;
    return root;
  }
