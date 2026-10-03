"""Write tests/reference/ai_designs.json: designs from the dataset's sampler with their blocks,
scalar-model features and field-model input, so the app's TypeScript ports can be checked
against python/treesvb/dataset.py and surrogate.py.

    python scripts/reference_ai.py && npx prettier --write tests/reference/ai_designs.json
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "python"))

from treesvb import dataset, surrogate  # noqa: E402
from treesvb.solver2d import cases  # noqa: E402


def main() -> None:
    plan = dataset.FULL
    designs = dataset.sample_block(plan, (0.3, 0.7, 1.0, 1.5, 2.0), seed=5)
    rows = []
    for d in designs[::7]:
        g = cases.canyon_geometry(plan.height, d.aspect)
        blocks = dataset.elements(d, g.width / g.height)
        arr = np.array([[c.x0, c.x1, c.z0, c.z1, c.lam_h] for c in blocks]).reshape(-1, 5)
        x = surrogate.field_input(g.aspect, arr)
        rows.append(
            {
                "design": asdict(d),
                "grid_width": g.width / g.height,
                "grid_aspect": g.aspect,
                "blocks": [asdict(c) for c in blocks],
                "features": [float(v) for v in dataset.features(g.aspect, blocks)],
                "field_input_sums": [float(v) for v in x.sum(axis=(1, 2))],
                "field_input_probe": [float(x[k, 5, 40]) for k in range(x.shape[0])],
            }
        )
    out = REPO / "tests" / "reference" / "ai_designs.json"
    out.write_text(
        json.dumps({"generated_by": "python scripts/reference_ai.py", "rows": rows}, indent=1)
        + "\n"
    )
    print(f"wrote {out.relative_to(REPO)} ({len(rows)} designs)")


if __name__ == "__main__":
    main()
