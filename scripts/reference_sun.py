"""Sun positions from pvlib's NREL SPA, the reference for apps/web/src/sun/position.ts.

Needs pvlib, which pins an older numpy than the project, so it runs in its own environment:

    uv venv .venv-ref && uv pip install --python .venv-ref/bin/python pvlib==0.16.1
    .venv-ref/bin/python scripts/reference_sun.py      # writes tests/reference/sun_pvlib.json

Cases: the Hong Kong Observatory and four latitudes from -34 to 60 degrees, the 21st of every
month of 2000, 2026 and 2050, every hour, kept where the sun is no more than 2 degrees below the
horizon.
"""

from __future__ import annotations

import json
from importlib import metadata
from pathlib import Path

import pandas as pd
import pvlib

OUT = Path(__file__).resolve().parents[1] / "tests" / "reference" / "sun_pvlib.json"

#: (name, latitude, longitude), degrees, east positive.
PLACES = [
    ("Hong Kong Observatory", 22.302, 114.174),
    ("Equator", 0.0, 0.0),
    ("London", 51.48, -0.0),
    ("Sydney", -33.87, 151.21),
    ("Helsinki", 60.17, 24.94),
]


def main() -> None:
    times = pd.DatetimeIndex(
        [
            pd.Timestamp(year=y, month=m, day=21, hour=h, tz="UTC")
            for y in (2000, 2026, 2050)
            for m in range(1, 13)
            for h in range(24)
        ]
    )
    rows = []
    for _, lat, lon in PLACES:
        sp = pvlib.solarposition.get_solarposition(times, lat, lon, method="nrel_numpy")
        for t, r in sp.iterrows():
            if r["elevation"] < -2:
                continue
            rows.append(
                [
                    int(t.value // 1_000_000),
                    lat,
                    lon,
                    round(float(r["elevation"]), 5),
                    round(float(r["apparent_elevation"]), 5),
                    round(float(r["azimuth"]), 5),
                ]
            )
    doc = {
        "name": "sun_pvlib",
        "description": "Solar position from pvlib.solarposition.get_solarposition, method "
        "nrel_numpy (NREL SPA, Reda and Andreas 2004), default pressure and temperature",
        "generated_by": "scripts/reference_sun.py",
        "versions": {p: metadata.version(p) for p in ("pvlib", "numpy", "pandas")},
        "places": [{"name": n, "latitude": a, "longitude": b} for n, a, b in PLACES],
        "columns": [
            "utc_ms",
            "latitude",
            "longitude",
            "elevation",
            "apparent_elevation",
            "azimuth",
        ],
        "rows": rows,
    }
    OUT.write_text(json.dumps(doc) + "\n")
    print(f"wrote {OUT} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
