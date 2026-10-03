"""A measured Hong Kong street at its true shape, on a grid finer than the live app's.

    python -m treesvb.streetruns wing_lok --height 96   # results/streets/run_wing_lok.json

The live app runs 24 cells per building height and stops at the H/W its regime study checked
(results/street/regimes.json). Wing Lok Street is deeper than that, so it is run here instead,
on the Colab A100 (colab/02_streets.ipynb), and the app shows the recorded result beside the
live view.

Everything is sized in metres from the measured preset (results/streets/presets.json): the
street's median H/W, its median building height for trees and hedges, the typical local tree
(results/streets/trees.json, A-014) in the wind-tunnel tree's form (A-015) along both kerbs
(A-024), CODASC's lanes
closing in with the width (A-012) and the breathing zone at its full-scale size (A-016). Three
designs are run: no greenery, an avenue of local trees, and a hedge in the middle.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np

from . import results, trees
from .solver2d import cases

GENERATED_BY = "python -m treesvb.streetruns"

#: The crown of trees.directions and the app's default: CODASC's dense crown, lambda 200 1/m at
#: model scale (H = 0.12 m), kept per metre at full scale (A-015).
DENSE_LAMBDA_PER_M = 200 * trees.MODEL_HEIGHT_M / trees.FULL_SCALE_HEIGHT_M

#: A deep street turns over slowly near the ground, so the spin-up is twice the CODASC runs'.
SPIN_UP_FACTOR = 2

#: Sampling of the stored fields: the street and one building depth either side, up to 1.5 H.
FIELD_ABOVE = 1.5
FIELD_CELLS = 4  # cells per stored sample, along each axis, for the mean flow


def preset(key: str) -> dict:
    rows = results.read("streets/presets.json")["rows"]
    for row in rows:
        if row["key"] == key:
            return row
    raise SystemExit(f"no preset {key!r}; known: {[r['key'] for r in rows]}")


def local_tree(key: str) -> dict:
    tree = next(r for r in results.read("streets/trees.json")["rows"] if r["key"] == key)
    if "height_m" not in tree:
        raise SystemExit(f"no local tree estimate for {key!r}")
    return {"height_m": tree["height_m"]["median"], "spread_m": tree["crown_spread_m"]["median"]}


def designs(width: float, height_m: float, tree: dict, kerb: float) -> dict[str, list[cases.Crown]]:
    """No greenery, local trees along both kerbs, a central hedge; x from the upwind wall, in H.

    The trees follow kerbTrees and buildGreenery in apps/web/src/sim/greenery.ts: one row centred on
    each kerb line, `kerb` from each wall (A-024), crown from a third of the tree height to its top,
    as wide as the crown spread; rows that meet become one canopy.
    """
    top = min(1.0, tree["height_m"] / height_m)
    half = 0.5 * tree["spread_m"] / height_m
    lam_h = DENSE_LAMBDA_PER_M * height_m
    spans = [(max(0.0, m - half), min(width, m + half)) for m in (kerb, width - kerb)]
    if spans[0][1] >= spans[1][0]:
        spans = [(spans[0][0], spans[1][1])]
    rows = [cases.Crown(a, b, top / 3, top, lam_h) for a, b in spans]
    hedge = trees.HEDGE
    h_half = 0.5 * hedge["width_m"] / height_m
    return {
        "none": [],
        "trees": rows,
        "hedge": [
            cases.Crown(
                0.5 * width - h_half,
                0.5 * width + h_half,
                0.0,
                hedge["height_m"] / height_m,
                hedge["lambda_per_m"] * height_m,
            )
        ],
    }


def _sample(g: cases.CanyonGeometry, f: dict) -> dict:
    """The mean fields around the street: c+ per cell inside it, the flow on a coarser grid."""
    x0, x1 = g.street
    lo, hi = x0 - g.building, x1 + g.building
    top = min(g.top, round((1 + FIELD_ABOVE) * g.height))
    k = FIELD_CELLS
    nz, nxs = top // k, (hi - lo) // k

    def coarse(a: np.ndarray) -> list[float]:
        block = a[: nz * k, lo : lo + nxs * k].reshape(nz, k, nxs, k).mean(axis=(1, 3))
        return [round(float(v) / trees.U_H, 3) for v in block.reshape(-1)]

    street = f["cplus"][: g.height, x0:x1]
    return {
        "cells_per_h": g.height,
        "window": {"x0": lo - x0, "x1": hi - x0, "top": top},
        "street_cplus": {
            "rows": int(street.shape[0]),
            "cols": int(street.shape[1]),
            "values": [round(float(v), 3) for v in street.reshape(-1)],
        },
        "flow_over_uh": {
            "rows": nz,
            "cols": nxs,
            "cells": k,
            "ux": coarse(f["ux"]),
            "uy": coarse(f["uy"]),
        },
    }


def run_street(key: str, height: int, schmidt: float, run: trees.Run) -> dict:
    p = preset(key)
    height_m = p["height_m"]["median"]
    aspect_hw = p["aspect_h_over_w"]["median"]
    g = cases.canyon_geometry(height, aspect_hw)
    width = g.width / g.height  # the grid's street width in units of H
    tree = local_tree(key)
    zone = trees.zone_in_metres(height_m)
    offsets = trees.lane_offsets(width)
    deep = replace(run, spin_up=run.spin_up * SPIN_UP_FACTOR)
    rows = []
    for name, crowns in designs(width, height_m, tree, zone.width).items():
        t0 = time.time()
        sim = trees.simulate_street(
            width, crowns, height, schmidt, deep, offsets=offsets, zone=zone, fields=True
        )
        row = {"design": name, "healthy": sim["healthy"]}
        if sim["healthy"]:
            row.update(
                {
                    "crowns": [asdict(c) for c in crowns],
                    "pavement": sim["pavement"],
                    "settling": sim["settling"],
                    "tracer_total_drift": round(sim["tracer_total_drift"], 4),
                    "steps": sim["steps"],
                    **_sample(g, sim["fields"]),
                }
            )
        rows.append(row)
        print(f"  {key} {name}: {row.get('pavement')} ({time.time() - t0:.0f}s)", flush=True)
    base = rows[0]
    for row in rows[1:]:
        if base["healthy"] and row["healthy"]:
            row["ratio"] = {k: round(row["pavement"][k] / base["pavement"][k], 4) for k in "AB"}
    r = deep.at(height)
    return {
        "name": f"{p['label_en']} at its measured shape",
        "method": (
            f"2D street, H/W {g.aspect:.2f} on the grid (measured median {aspect_hw:g}), "
            f"H = {height} cells for {height_m:g} m, Re {trees.REYNOLDS:g}, Cs "
            f"{trees.SMAGORINSKY}, Sc_t {schmidt}, {r.spin_up} steps spin-up, {r.average} "
            "averaged; trees: local tree "
            f"{tree['height_m']:g} m tall with a {tree['spread_m']:g} m crown, CODASC dense "
            f"crown per metre; hedge {trees.HEDGE['height_m']:g} m high, "
            f"{trees.HEDGE['width_m']:g} m wide, lambda {trees.HEDGE['lambda_per_m']:g} 1/m; "
            f"lanes at {[round(o, 4) for o in offsets]} H from the axis; breathing zone "
            f"{zone.width * height_m:.1f} m from each wall, {zone.z0 * height_m:.1f}-"
            f"{zone.z1 * height_m:.1f} m above the ground"
        ),
        "metric": "mean c+ in each pavement's breathing zone; A is the leeward side",
        "preset": key,
        "height_m": height_m,
        "aspect_h_over_w": round(g.aspect, 4),
        "height_cells": height,
        "width_cells": g.width,
        "schmidt": schmidt,
        "local_tree": tree,
        "zone_m": {
            "width": round(zone.width * height_m, 2),
            "z0": round(zone.z0 * height_m, 2),
            "z1": round(zone.z1 * height_m, 2),
        },
        "rows": rows,
        "passed": all(r["healthy"] for r in rows),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.streetruns")
    p.add_argument("street", help="preset key, e.g. wing_lok")
    p.add_argument("--height", type=int, default=96, help="cells per building height")
    p.add_argument("--schmidt", type=float, help="Sc_t; default: the calibration at --calibration")
    p.add_argument(
        "--calibration", default="trees/calibration_h48.json", help="results file with Sc_t"
    )
    p.add_argument("--quick", action="store_true", help="short coarse run, temporary output")
    p.add_argument("--out", type=Path, help="results root (default: results/)")
    args = p.parse_args(argv)
    kw = {"root": args.out} if args.out else {}
    if args.quick:
        import tempfile

        kw = {"root": args.out or Path(tempfile.mkdtemp(prefix="tvb-streetruns-"))}
    schmidt = args.schmidt or results.read(args.calibration, **kw)["schmidt"]
    run = trees.QUICK if args.quick else trees.FULL
    payload = run_street(args.street, 16 if args.quick else args.height, schmidt, run)
    path = results.write(f"streets/run_{args.street}.json", payload, GENERATED_BY, **kw)
    print(f"{'pass' if payload['passed'] else 'FAIL'}  {path}", flush=True)
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
