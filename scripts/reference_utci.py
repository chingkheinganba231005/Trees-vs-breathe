"""UTCI from pythermalcomfort over a grid of inputs, the reference for apps/web/src/sun/utci.ts.

    .venv-ref/bin/python scripts/reference_utci.py

writes tests/reference/utci_pythermalcomfort.json.

The grid spans the polynomial's whole validity range: air temperature -50 to 50 C, mean radiant
temperature 30 K below to 70 K above it, wind at 10 m 0.5 to 17 m/s, humidity 5 to 100%.
"""

from __future__ import annotations

import itertools
import json
from importlib import metadata
from pathlib import Path

import numpy as np
from pythermalcomfort.models import utci

OUT = Path(__file__).resolve().parents[1] / "tests" / "reference" / "utci_pythermalcomfort.json"

TA = list(range(-50, 51, 10))
DTR = list(range(-30, 71, 10))
VA = [0.5, 1.0, 2.0, 4.0, 8.0, 17.0]
RH = [5, 25, 50, 75, 100]


def main() -> None:
    grid = np.array(list(itertools.product(TA, DTR, VA, RH)), dtype=float)
    ta, dtr, va, rh = grid.T
    r = utci(tdb=ta, tr=ta + dtr, v=va, rh=rh, limit_inputs=False, round_output=False)
    rows = [
        [float(a), float(a + d), float(v), float(h), round(float(u), 6), str(c)]
        for (a, d, v, h), u, c in zip(grid, r.utci, r.stress_category, strict=True)
    ]
    doc = {
        "name": "utci_pythermalcomfort",
        "description": "pythermalcomfort.models.utci with limit_inputs=False, round_output=False",
        "generated_by": "scripts/reference_utci.py",
        "versions": {p: metadata.version(p) for p in ("pythermalcomfort", "numpy")},
        "columns": ["ta", "tmrt", "va10", "rh", "utci", "stress_category"],
        "rows": rows,
    }
    OUT.write_text(json.dumps(doc) + "\n")
    print(f"wrote {OUT} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
