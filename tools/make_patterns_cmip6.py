#!/usr/bin/env python3
"""Generate CMIP6-derived pattern-scaling coefficients for Carbonator 2.

Replaces the synthetic data/patterns_synthetic_1deg.js with real patterns:
  tas_amp     : local warming per degree of global-mean warming (degC/degC)
  pr_pct_perC : local precipitation change per degree of global-mean warming
                (% of the local pre-industrial mean per degC)

Method (per model, then ensemble median):
  - epoch difference: (2071-2100 mean under the scenario) minus
    (1850-1900 mean from historical), divided by the same-epoch change in
    global-mean surface temperature (area-weighted). Epoch differences are
    robust to volcanic years and internal variability, unlike regression.
  - each model is bilinearly regridded to a common 1x1 degree grid
    (centres -89.5..89.5, -179.5..179.5) with cyclic longitude handling.
  - precipitation is expressed as % of the local 1850-1900 mean; cells drier
    than 0.1 mm/day in the base period are masked (% change is meaningless
    there) and later filled by nearest neighbour; values clipped to +-12 %/degC.

Data source: the public Pangeo/Google Cloud CMIP6 zarr archive (anonymous
access, no ESGF account needed). Only two ~30-50 yr monthly slabs of tas and
pr are read per model.

Usage:
  python3 tools/make_patterns_cmip6.py --selftest        # no network; validates pipeline
  python3 tools/make_patterns_cmip6.py                   # default: up to 12 models, ssp585
  python3 tools/make_patterns_cmip6.py --max-models 5 --scenario ssp245 \
          --out data/patterns_cmip6_1deg.js

Dependencies:
  numpy xarray            (always)
  pandas gcsfs zarr cftime (for real runs)
Install: pip install numpy xarray pandas gcsfs zarr cftime

To use the output in the app, point the pattern <script> tag in index.html at
the generated file (it defines window.PATTERN_1DEG in the same format).
"""

import argparse
import base64
import datetime
import json
import sys

import numpy as np
import xarray as xr

CATALOG_URL = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"
BASE_PERIOD = ("1850", "1900")
FUTURE_PERIOD = ("2071", "2100")
PR_DRY_LIMIT = 0.1 / 86400.0   # 0.1 mm/day in kg m-2 s-1
PR_CLIP = 12.0                 # %/degC display clip
TARGET_LAT = np.arange(-89.5, 90.0, 1.0)
TARGET_LON = np.arange(-179.5, 180.0, 1.0)

# Models with well-behaved r1i1p1f1 tas+pr in historical and the SSPs on the
# Pangeo archive. Order = preference; --max-models takes the first N available.
DEFAULT_MODELS = [
    "ACCESS-ESM1-5", "ACCESS-CM2", "MPI-ESM1-2-LR", "MPI-ESM1-2-HR",
    "MRI-ESM2-0", "MIROC6", "NorESM2-LM", "NorESM2-MM", "CanESM5",
    "IPSL-CM6A-LR", "EC-Earth3", "EC-Earth3-Veg", "CMCC-CM2-SR5",
    "CESM2-WACCM", "INM-CM5-0", "INM-CM4-8", "GFDL-ESM4", "KACE-1-0-G",
]


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Core numerics (network-free, exercised by --selftest)
# ---------------------------------------------------------------------------

def area_weighted_mean(da):
    w = np.cos(np.deg2rad(da.lat))
    return da.weighted(w).mean(("lat", "lon"))


def to_minus180_180(da):
    """Convert longitude coordinate to [-180, 180) and sort ascending."""
    lon = ((da.lon + 180) % 360) - 180
    da = da.assign_coords(lon=lon).sortby("lon")
    return da


def nan_fill_nearest(a, axis):
    """Fill NaNs along one axis with the nearest valid value (numpy only)."""
    def fill1d(x):
        n = len(x)
        good = ~np.isnan(x)
        if good.all() or not good.any():
            return x
        idx = np.arange(n)
        return np.interp(idx, idx[good], x[good])  # linear inside, edge-hold outside
    return np.apply_along_axis(fill1d, axis, np.asarray(a, dtype=np.float64))


def regrid_to_1deg(da):
    """Bilinear regrid to the common 1-degree grid with cyclic longitudes."""
    da = to_minus180_180(da).sortby("lat")
    # cyclic pad in longitude so interpolation wraps at the dateline
    left = da.isel(lon=-1).assign_coords(lon=da.lon[-1] - 360)
    right = da.isel(lon=0).assign_coords(lon=da.lon[0] + 360)
    da = xr.concat([left, da, right], dim="lon")
    out = da.interp(lat=TARGET_LAT, lon=TARGET_LON, method="linear",
                    kwargs={"fill_value": None})
    # models whose first/last latitude centre is inside +-89.5: fill poleward
    vals = nan_fill_nearest(out.values, axis=0)
    return xr.DataArray(vals, dims=("lat", "lon"),
                        coords={"lat": TARGET_LAT, "lon": TARGET_LON})


def model_patterns(tas_base, tas_fut, pr_base, pr_fut):
    """Per-model tas_amp and pr_pct fields (on the model's native grid).

    Inputs are time-mean 2D fields (lat, lon) for the base and future epochs.
    Returns (tas_amp, pr_pct, dgmst) as DataArrays / float.
    """
    dgmst = float(area_weighted_mean(tas_fut) - area_weighted_mean(tas_base))
    if not np.isfinite(dgmst) or dgmst <= 0.5:
        raise ValueError(f"suspicious global-mean warming {dgmst:.2f} K")
    tas_amp = (tas_fut - tas_base) / dgmst
    pr_pct = 100.0 * (pr_fut - pr_base) / xr.where(pr_base > PR_DRY_LIMIT, pr_base, np.nan) / dgmst
    pr_pct = pr_pct.clip(-PR_CLIP, PR_CLIP)
    return tas_amp, pr_pct, dgmst


def ensemble_median(fields):
    """Median across models, then nearest-neighbour fill of any NaNs."""
    stack = np.stack([np.asarray(f, dtype=np.float64) for f in fields])
    with np.errstate(all="ignore"):
        med = np.nanmedian(stack, axis=0)
    if np.isnan(med).any():
        med = nan_fill_nearest(med, axis=1)  # along longitudes first
        med = nan_fill_nearest(med, axis=0)  # then latitudes
    return med.astype(np.float32)


def robust_limits(arr, lo=2, hi=98):
    return float(np.percentile(arr, lo)), float(np.percentile(arr, hi))


def write_pattern_js(path, tas_amp, pr_pct, source_desc):
    """Write the JS file in exactly the format js/patterns-map.js loads."""
    nlat, nlon = len(TARGET_LAT), len(TARGET_LON)
    assert tas_amp.shape == (nlat, nlon) and pr_pct.shape == (nlat, nlon)
    # lat-major, lat ascending from -89.5 (matches meta below)
    payload = tas_amp.astype("<f4").tobytes() + pr_pct.astype("<f4").tobytes()
    b64 = base64.b64encode(payload).decode("ascii")

    t_lo, t_hi = robust_limits(tas_amp)
    p_lo, p_hi = robust_limits(pr_pct)
    meta = {
        "name": "CMIP6 pattern scaling (epoch difference, ensemble median)",
        "source": source_desc,
        "created": datetime.date.today().isoformat(),
        "grid": {"nlat": nlat, "nlon": nlon, "lat0": float(TARGET_LAT[0]),
                 "lon0": float(TARGET_LON[0]), "dlat": 1.0, "dlon": 1.0,
                 "lat_is_center": True, "lon_is_center": True},
        "vars": {
            "tas_amp": {
                "description": "Local temperature amplification factor (°C local per °C global)",
                "units": "°C/°C", "vmin": t_lo, "vmax": t_hi,
                "note": "vmin/vmax are 2nd/98th percentiles for display scaling"},
            "pr_pct_perC": {
                "description": "Local precipitation change (% of 1850-1900 local mean per °C global warming)",
                "units": "%/°C", "vmin": p_lo, "vmax": p_hi,
                "note": f"clipped to ±{PR_CLIP:g} %/°C; dry cells (<0.1 mm/day) filled by nearest neighbour"},
        },
        "layout": {"order": "lat-major", "arrays": ["tas_amp", "pr_pct_perC"]},
    }

    with open(path, "w", encoding="utf-8") as f:
        f.write("// CMIP6-derived pattern scaling coefficients on a 1°x1° grid.\n")
        f.write("// Generated by tools/make_patterns_cmip6.py — see that file for the method.\n")
        f.write("// Same format as patterns_synthetic_1deg.js: two Float32 arrays\n")
        f.write("// [tas_amp, pr_pct_perC], lat-major, concatenated and base64-encoded.\n\n")
        f.write("window.PATTERN_1DEG = {\n")
        f.write("  meta: " + json.dumps(meta) + ",\n")
        f.write('  format: "f32-b64-concat",\n')
        f.write('  b64: "' + b64 + '"\n')
        f.write("};\n")
    log(f"Wrote {path} ({(len(b64)/1024):.0f} kB base64, {nlat}x{nlon} grid)")
    log(f"  tas_amp: median {np.median(tas_amp):.2f}, display range {t_lo:.2f}..{t_hi:.2f} °C/°C")
    log(f"  pr_pct : median {np.median(pr_pct):.2f}, display range {p_lo:.2f}..{p_hi:.2f} %/°C")


# ---------------------------------------------------------------------------
# CMIP6 access (Pangeo Google Cloud archive)
# ---------------------------------------------------------------------------

def load_catalog():
    import pandas as pd
    log(f"Loading Pangeo CMIP6 catalogue …")
    cat = pd.read_csv(CATALOG_URL)
    keep = (
        cat.table_id.eq("Amon")
        & cat.variable_id.isin(["tas", "pr"])
        & cat.member_id.eq("r1i1p1f1")
    )
    return cat[keep]


def epoch_mean_from_catalog(cat, model, experiment, variable, period):
    """Open the first catalogue entry that actually covers the epoch.

    Some models have several zarr stores (versions, split records); the first
    one is not always usable, so try each until the epoch mean succeeds.
    """
    import gcsfs
    rows = cat[(cat.source_id == model)
               & (cat.experiment_id == experiment)
               & (cat.variable_id == variable)]
    if rows.empty:
        raise KeyError(f"{model}/{experiment}/{variable} not in catalogue")
    fs = gcsfs.GCSFileSystem(token="anon")
    last_err = None
    for zstore in rows.zstore:
        try:
            ds = xr.open_zarr(fs.get_mapper(zstore), consolidated=True, use_cftime=True)
            da = ds[variable]
            if "latitude" in da.dims:
                da = da.rename({"latitude": "lat", "longitude": "lon"})
            slab = da.sel(time=slice(period[0], period[1]))
            nyears = len(np.unique([t.year for t in slab.time.values]))
            if nyears < 20:
                raise ValueError(f"only {nyears} years in epoch {period}")
            return slab.mean("time").load()
        except Exception as e:  # try the next candidate store
            last_err = e
    raise ValueError(f"{model}/{experiment}/{variable}: no usable store ({last_err})")


def process_model(cat, model, scenario):
    tas_base = epoch_mean_from_catalog(cat, model, "historical", "tas", BASE_PERIOD)
    pr_base = epoch_mean_from_catalog(cat, model, "historical", "pr", BASE_PERIOD)
    tas_fut = epoch_mean_from_catalog(cat, model, scenario, "tas", FUTURE_PERIOD)
    pr_fut = epoch_mean_from_catalog(cat, model, scenario, "pr", FUTURE_PERIOD)
    tas_amp, pr_pct, dgmst = model_patterns(tas_base, tas_fut, pr_base, pr_fut)
    return regrid_to_1deg(tas_amp), regrid_to_1deg(pr_pct), dgmst


# ---------------------------------------------------------------------------
# Self-test: fabricate two fake models and run the whole pipeline (no network)
# ---------------------------------------------------------------------------

def fake_model(nlat, nlon, amp_pole, warming):
    """Analytic fields on a native grid with 0..360 longitudes."""
    lat = np.linspace(-90 + 90/nlat, 90 - 90/nlat, nlat)
    lon = np.arange(0, 360, 360/nlon)
    LAT = np.radians(lat)[:, None] * np.ones((1, nlon))
    coords = {"lat": lat, "lon": lon}
    tas_base = xr.DataArray(280 + 15*np.cos(2*LAT), dims=("lat", "lon"), coords=coords)
    # polar-amplified warming: amp 1 at equator -> amp_pole at poles
    amp = 1 + (amp_pole - 1) * np.abs(np.sin(LAT))
    tas_fut = tas_base + warming * amp
    pr_base = xr.DataArray(3e-5 * (0.4 + np.cos(LAT)**2), dims=("lat", "lon"), coords=coords)
    # wet-get-wetter-ish: +5%/K in tropics, -3%/K in subtropics
    frac = 0.05*np.cos(3*LAT)
    pr_fut = pr_base * (1 + frac * warming * amp)
    return tas_base, tas_fut, pr_base, pr_fut


def selftest(out_path):
    fields_t, fields_p = [], []
    for (nlat, nlon, amp_pole, warming) in [(45, 72, 2.2, 4.0), (36, 60, 2.6, 3.5)]:
        tb, tf, pb, pf = fake_model(nlat, nlon, amp_pole, warming)
        ta, pp, dg = model_patterns(tb, tf, pb, pf)
        ta1, pp1 = regrid_to_1deg(ta), regrid_to_1deg(pp)
        assert ta1.shape == (180, 360), ta1.shape
        fields_t.append(ta1); fields_p.append(pp1)
        log(f"  fake model {nlat}x{nlon}: dGMST={dg:.2f} K")
    tas_amp = ensemble_median(fields_t)
    pr_pct = ensemble_median(fields_p)

    # physical checks:
    # (1) area-weighted global mean of tas_amp must be 1 by construction
    w = np.cos(np.deg2rad(TARGET_LAT))[:, None] * np.ones((1, len(TARGET_LON)))
    gmean = float((tas_amp*w).sum()/w.sum())
    assert abs(gmean - 1.0) < 0.05, f"global-mean amplification {gmean} != 1"
    # (2) polar amplification: pole/equator ratio ~ the built-in 2.2-2.6
    eq = tas_amp[85:95, :].mean(); pole = tas_amp[172:, :].mean()
    assert 1.9 < pole/eq < 2.9, f"pole/equator ratio {pole/eq}"
    assert np.isfinite(tas_amp).all() and np.isfinite(pr_pct).all()

    write_pattern_js(out_path, tas_amp, pr_pct,
                     "SELFTEST: synthetic 2-model ensemble — do not use for teaching")
    # round-trip the encoding
    txt = open(out_path, encoding="utf-8").read()
    b64 = txt.split('b64: "')[1].split('"')[0]
    buf = base64.b64decode(b64)
    n = 180*360
    t2 = np.frombuffer(buf, dtype="<f4", count=n).reshape(180, 360)
    assert np.allclose(t2, tas_amp), "b64 round-trip mismatch"
    log("selftest OK: pipeline, grid, encoding and round-trip all valid")


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--selftest", action="store_true", help="validate the pipeline without network access")
    ap.add_argument("--scenario", default="ssp585", help="SSP experiment for the future epoch (default ssp585)")
    ap.add_argument("--models", nargs="*", default=None, help="explicit model list (default: built-in preference list)")
    ap.add_argument("--max-models", type=int, default=12)
    ap.add_argument("--out", default="data/patterns_cmip6_1deg.js")
    args = ap.parse_args()

    if args.selftest:
        selftest("/tmp/patterns_selftest.js" if args.out == "data/patterns_cmip6_1deg.js" else args.out)
        return

    cat = load_catalog()
    wanted = args.models or DEFAULT_MODELS
    fields_t, fields_p, used = [], [], []
    for model in wanted:
        if len(used) >= args.max_models:
            break
        try:
            log(f"processing {model} …")
            ta, pp, dgmst = process_model(cat, model, args.scenario)
            fields_t.append(ta); fields_p.append(pp)
            used.append(model)
            log(f"  {model}: dGMST({args.scenario} {FUTURE_PERIOD[0]}-{FUTURE_PERIOD[1]} vs {BASE_PERIOD[0]}-{BASE_PERIOD[1]}) = {dgmst:.2f} K")
        except Exception as e:
            log(f"  skipping {model}: {e}")
    if len(used) < 3:
        sys.exit(f"Only {len(used)} models processed — refusing to write an ensemble from fewer than 3.")

    tas_amp = ensemble_median(fields_t)
    pr_pct = ensemble_median(fields_p)
    src = (f"CMIP6 ensemble median of {len(used)} models ({', '.join(used)}); "
           f"epoch difference {args.scenario} {FUTURE_PERIOD[0]}-{FUTURE_PERIOD[1]} minus "
           f"historical {BASE_PERIOD[0]}-{BASE_PERIOD[1]}, per K of global-mean warming; "
           f"r1i1p1f1; Pangeo Google Cloud archive")
    write_pattern_js(args.out, tas_amp, pr_pct, src)
    log("Done. Point the pattern <script> tag in index.html at this file.")


if __name__ == "__main__":
    main()
