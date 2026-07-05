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
