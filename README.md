# Carbonator 2

A simple climate model for teaching, running entirely in the browser — no install,
no build step, no external dependencies.

Carbonator couples a two-layer energy-balance model (Geoffroy et al. 2013) to an
interactive carbon cycle with ocean carbonate chemistry (Glotter et al. 2014), a
methane lifetime model, a sea-level model (thermal expansion + land ice) and
optional stochastic internal variability. Scenarios are the CMIP6 Shared
Socioeconomic Pathways (SSP1-1.9, SSP1-2.6, SSP2-4.5, SSP5-8.5, from RCMIP), plus
a set of idealised teaching experiments (CO₂/CH₄ pulses, mega volcano,
geoengineering and its failure, zero emissions, solar variations, white roofs)
ported from the original Carbonator. Model output can be compared against
observations (HadCRUT5, Berkeley Earth, GISTEMP) and CMIP6 model ranges, and
projected onto a 1°×1° map via pattern scaling.

## Running it

Open `index.html` in a browser — that's it. Everything (including the scenario
data) ships as plain script files, so it works from a local folder or any static
host (e.g. GitHub Pages).

For local development with live reload, any static server works, e.g.:

```bash
npx serve .
# or
python3 -m http.server
```

## Repository layout

```
index.html         the app shell (markup + script load order)
explained.html     how the model works (from the original Carbonator site)
faqs.html          frequently asked questions
schools.html       lesson plans and resources for schools
team.html          the team behind Carbonator
css/app.css        app styles     css/site.css  static-page styles
js/utils.js        CSV parsing, splines, RNG, formatting
js/plotting.js     canvas line/stacked/decomposition plots + hover tips
js/model.js        the science: EBM, carbon cycle, methane, sea level, variability
js/state.js        scenario registry, defaults, app state
js/patterns-map.js pattern scaling, local projections, map rendering
js/ui.js           views, rendering, scenario selection
js/editors.js      curve editor and parameter editor (Advanced mode)
js/main.js         data table, about, event wiring
data/scenario-data.js        RCMIP SSP emissions & forcings, 1850-2100 (CSV-in-JS)
data/compare-data.js         observed GMST + CMIP6 ranges
data/teaching-scenarios.js   the teaching experiments
data/patterns_synthetic_1deg.js  pattern-scaling coefficients (swap for CMIP-derived)
assets/            images, logos, worksheets (PDF), Excel mini-model
tools/build-standalone.mjs   bundles everything into one HTML file
```

The scripts are plain (non-module) JavaScript loaded in dependency order and
sharing one scope — which is what lets the same code run unbundled from `file://`
and be trivially inlined into a single file.

## Three model versions

The app ships as three separate versions — there is no in-app mode switching:

| Version | URL | Inputs |
|---|---|---|
| **Full** (production) | `index.html` | everything as emissions: CO2, CH4, aerosols (Tg SO2/yr), volcanic injection (AOD/yr), N2O (Tg/yr), ozone precursors (~Tg/yr), synthetic gases (kt CFC-12-eq/yr), plus solar forcing and albedo |
| **Simple** | `simple.html` or `index.html?model=simple` | CO2, CH4, aerosols, volcanoes, solar, albedo only; minor gases excluded; default sensitivity 3.7 degC (vs 3.0) |
| **Mixed** | `mixed.html` or `index.html?model=mixed` | as Simple, plus the minor gases prescribed as radiative forcing (W/m2) time series |

The home page shows which version is running with links to the others.
`tools/build-standalone.mjs --variant simple|mixed|full` bakes a version into a
single-file build.

Model internals: the minor-GHG sub-models (N2O one-box, 120-yr lifetime;
ozone forcing proportional to precursor emissions; synthetic gases as one
CFC-12-equivalent box, 100-yr lifetime — its derived emission history peaks in
1988, the Montreal Protocol) live in js/model.js (MINOR_GHG). Pseudo-emission
series are derived once per scenario by exact annual inversion of the RCMIP
ERF series; the full model reproduces the ERF-driven forcings to ~3 decimal
places. An **albedo input** (planetary reflectivity, baseline 0.31; forcing
-S0/4 x Δalbedo) is available in every version — the White Roofs experiment
uses it. The simple model's historical undershoot vs observations is a
deliberate teaching point (ocean inertia means its higher sensitivity cannot
compensate for the missing 20th-century forcing).

## Saving and loading scenarios

Every scenario view has **Save inputs CSV** (the input time series, including any
edits) and **Export outputs CSV** (model results after a run); both prompt for a
filename. **+ Load scenario (CSV)…** in the sidebar does the reverse: it creates
a new scenario under **User scenarios** from a CSV file (× removes it again;
user scenarios live for the browser session only).

Loaded files do **not** need annual data. The format is one `Year` column plus
any subset of input variables; rows can be at any years and cells can be left
blank — each variable is interpolated through its own specified points (with the
app's monotone spline, held constant outside the specified range). Variables not
in the file come from the scenario named in the file's `scenario` column (as
written by Save inputs CSV), or are zero for an idealised experiment. Column
names can be raw keys (`E_CO2_GtC_yr`), the names written by Save inputs CSV, or
short aliases (`CO2`, `CH4`, `Aerosol`, `Ozone`, `N2O`, `Other`, `Volcanic`,
`Solar`). So a complete externally-authored scenario can be as small as:

```csv
Year,CO2,Volcanic
2020,10,0
2030,5,-8
2032,5,0
2100,-2,0
```

Different variables can use different node points by repeating the `Year`
column: each `Year` column provides the years for the variable columns that
follow it. All multi-point variables must share the same start and end year
(checked on load); single-point variables are constants and exempt.

```csv
scenario,Year,CO2 emissions (GtC/yr),Year,CH4 emissions (TgCH4/yr)
ssp119,1850,0.55,1850,43.1
ssp119,1900,1.0,1851,43.2
ssp119,2100,3.0,1852,43.3
ssp119,,,2100,100
```

See [examples/custom-scenario-example.csv](examples/custom-scenario-example.csv).
Files written by Save inputs CSV round-trip exactly. CSVs are written with
ASCII-safe headers and a UTF-8 BOM so they open cleanly in Excel.

## Comparing runs

**Compare runs** (bottom of the sidebar) overlays any output variable across
several runs: add the run on screen (**Add current run**, or **Add to compare**
in the floating display-controls panel), and/or load files saved earlier with
Export outputs CSV (multiple files at once). Each run gets a colour and can be
removed individually; runs persist for the browser session.

## Pattern scaling data

The "Local patterns" output panel scales a 1x1 degree gridded pattern by the
modelled global-mean temperature. The coefficients (local warming per degC of
global warming; local precipitation change in %/degC) are generated from the
public Pangeo/Google Cloud CMIP6 archive by
[tools/make_patterns_cmip6.py](tools/make_patterns_cmip6.py):

```bash
pip install numpy xarray scipy pandas gcsfs zarr cftime
python3 tools/make_patterns_cmip6.py --selftest     # validate pipeline, no network
python3 tools/make_patterns_cmip6.py                # ~12 models, ssp585, -> data/patterns_cmip6_1deg.js
```

The maps use white-centred colour scales (white = the global average value,
marked on the colour bar) with coastlines derived from the ocean mask of the
sea-level field. Variables: temperature amplification (degC/degC), precipitation
change (%/degC) and regional sea-level departure (cm/degC, from CMIP6 zos).

Method: per model, epoch difference (2071-2100 under the SSP minus 1850-1900
historical) divided by that model's global-mean warming; bilinear regrid to 1
degree; ensemble median. Precipitation is % of the local 1850-1900 mean per
degC, masked where the base climate is drier than 0.1 mm/day and clipped to
+-12 %/degC. The app loads whichever pattern file index.html points at
(`data/patterns_synthetic_1deg.js` is the original synthetic placeholder, kept
for reference).

## Single-file build

To produce one self-contained HTML file (handy for email or offline use):

```bash
node tools/build-standalone.mjs
# -> dist/carbonator-standalone.html
```

## Deploying

The repository is a static site: enable GitHub Pages (Settings → Pages →
deploy from branch, root folder) and `index.html` is served as-is.

## Provenance

- Carbonator 1 (Angular, RCP scenarios): UNSW Climate Change Research Centre —
  the surrounding website content and teaching experiments here were ported from it.
- Carbonator 2.0: single-file prototypes (`ssp-carbonator-*.html`, v2→v13);
  this repository is v13 split into maintainable modules with the teaching
  experiments and site pages added.
- Scenario data: RCMIP v5.1.0 collated forcing & emissions, annual-filled, World.
- Observations: HadCRUT5, Berkeley Earth, GISTEMP v4 (annual GMST anomalies
  relative to 1850-1900). CMIP6 ranges from the CMIP6-scalars compilation.

## References

- Geoffroy et al. (2013), *Transient Climate Response in a Two-Layer
  Energy-Balance Model*, J. Climate, doi:10.1175/JCLI-D-12-00195.1
- Glotter et al. (2014), *A Simple Carbon Cycle Representation for Economic and
  Policy Analyses*, Climatic Change, doi:10.1007/s10584-014-1224-y
- Boucher et al. (2009), *The Indirect Global Warming Potential and Global
  Temperature Change Potential Due to Methane Oxidation*, ERL,
  doi:10.1088/1748-9326/4/4/044007

## License

Creative Commons [BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/2.0/au/).
Developed with support from UNSW Sydney, the Climate Change Research Centre and
the ARC Centre of Excellence for Climate System Science.
