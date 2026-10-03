"""Erbs split and extraterrestrial irradiance from pvlib, the reference for irradiance.ts.

    .venv-ref/bin/python scripts/reference_irradiance.py

writes tests/reference/irradiance_pvlib.json: every 30th day of the year, zenith 0 to 84 degrees
in steps of 6, global horizontal irradiance 0 to 1100 W/m2 in steps of 100.
"""

from __future__ import annotations

import itertools
import json
from importlib import metadata
from pathlib import Path

import numpy as np
import pvlib

OUT = Path(__file__).resolve().parents[1] / "tests" / "reference" / "irradiance_pvlib.json"


def main() -> None:
    days = list(range(1, 366, 30))
    zen = list(range(0, 90, 6))
    ghi = list(range(0, 1101, 100))
    grid = np.array(list(itertools.product(days, zen, ghi)), dtype=float)
    doy, z, g = grid.T
    extra = pvlib.irradiance.get_extra_radiation(doy)
    e = pvlib.irradiance.erbs(g, z, doy)
    rows = [
        [
            int(d),
            float(zz),
            float(gg),
            round(float(x), 6),
            round(float(k), 8),
            round(float(dni), 6),
            round(float(dhi), 6),
        ]
        for d, zz, gg, x, k, dni, dhi in zip(
            doy, z, g, extra, e["kt"], e["dni"], e["dhi"], strict=True
        )
    ]
    doc = {
        "name": "irradiance_pvlib",
        "description": "pvlib.irradiance.get_extra_radiation (spencer) and pvlib.irradiance.erbs",
        "generated_by": "scripts/reference_irradiance.py",
        "versions": {p: metadata.version(p) for p in ("pvlib", "numpy")},
        "columns": ["day_of_year", "zenith", "ghi", "dni_extra", "kt", "dni", "dhi"],
        "rows": rows,
    }
    OUT.write_text(json.dumps(doc) + "\n")
    print(f"wrote {OUT} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
