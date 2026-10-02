"""Trees, hedges and fumes in the street: the phase 2 studies (BRIEF.md 8.3).

    python -m treesvb.trees calibrate   # turbulent Schmidt number on the tree-free CODASC case
    python -m treesvb.trees codasc      # the ten cross-wind CODASC cases against the wind tunnel
    python -m treesvb.trees all

Each writes results/trees/<name>.json. `--height` sets the grid (cells per building height);
`--quick` runs a short, coarse version for CI and writes to a temporary folder.

The comparison follows docs/codasc.md: concentrations at y = 0 on walls A and B, 0.042 H in
front of each wall, at z / H = 1/6 ... 5/6; c+ = C u_H H / Q_l with Q_l the total of the four line
sources per unit length (docs/assumptions.md A-006). At most one parameter is calibrated, the
turbulent Schmidt number, and only on the tree-free W/H = 1 case.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import codasc, results
from .solver2d import cases

GENERATED_BY = "python -m treesvb.trees"

#: CODASC crown model: lambda in 1/m at model scale and the building height H = 0.12 m
#: (Gromke 2008, pp. 41 and 45), so lambda H is dimensionless.
MODEL_HEIGHT_M = 0.12
#: Line sources at these distances from the street axis, in units of H (Gromke 2008, p. 42).
SOURCE_OFFSETS = (-0.267, -0.15, 0.15, 0.267)
#: Approach-flow power-law exponent (Gromke and Ruck 2012, p. 45, Eq. 2).
PROFILE_EXPONENT = 0.30
#: Taps 0.5 cm in front of the walls: x / H = 0.042 (Gromke 2008, p. 41).
TAP_DISTANCE = 0.042
#: Interior heights of the CODASC grid; the rows at z/H = 0 and 1 are left out (docs/codasc.md).
HEIGHTS = np.array([1, 2, 3, 4, 5]) / 6.0

#: Urban acceptance criteria of Hanna and Chang (2012), as restated in OSTI 1639930
#: (docs/sources.md).
HANNA_CHANG_URBAN = {"fb_abs_below": 0.67, "nmse_below": 6.0, "fac2_above": 0.3}

#: Lattice settings shared with the live street (apps/web/src/sim/streetSim.ts LIVE_FLOW), except
#: the roof-height speed, lowered so the power-law inflow stays below 0.08 at the domain top.
U_H = 0.045
REYNOLDS = 20000.0
SMAGORINSKY = 0.17
SOURCE_TOTAL = 1e-3  # tracer per step per unit length; c+ does not depend on it

#: Range from the RANS studies of this street (0.2-0.6, Gromke and Ruck 2012, p. 43) up to the
#: 1.0 used in Gromke (2008, p. 87).
SCHMIDT_CANDIDATES = (0.2, 0.3, 0.5, 0.7, 1.0)


@dataclass(frozen=True)
class Run:
    spin_up: int
    average: int
    every: int


FULL = Run(spin_up=40_000, average=80_000, every=200)
QUICK = Run(spin_up=3_000, average=2_000, every=100)


def metrics(observed: np.ndarray, predicted: np.ndarray) -> dict:
    """FB, NMSE and FAC2 as defined for the BOOT software (Chang and Hanna 2004).

    FB = (mean Co - mean Cp) / (0.5 (mean Co + mean Cp)), so a positive FB means the model
    predicts too little; NMSE = mean((Co - Cp)^2) / (mean Co mean Cp); FAC2 is the fraction of
    predictions within a factor of two of the observations.
    """
    co = np.asarray(observed, dtype=np.float64).reshape(-1)
    cp = np.asarray(predicted, dtype=np.float64).reshape(-1)
    mo, mp = co.mean(), cp.mean()
    ratio = cp / co
    return {
        "n": int(co.size),
        "fb": float((mo - mp) / (0.5 * (mo + mp))),
        "nmse": float(((co - cp) ** 2).mean() / (mo * mp)),
        "fac2": float(((ratio >= 0.5) & (ratio <= 2.0)).mean()),
    }


def meets_criteria(m: dict) -> bool:
    c = HANNA_CHANG_URBAN
    return (
        abs(m["fb"]) < c["fb_abs_below"]
        and m["nmse"] < c["nmse_below"]
        and m["fac2"] > c["fac2_above"]
    )


def crowns_for(case: codasc.Case) -> list[cases.Crown]:
    """CODASC crown blocks (docs/codasc.md); stand density 0.5 halves lambda (assumption A-007)."""
    if not case.has_trees:
        return []
    lam_h = case.lam * MODEL_HEIGHT_M * case.stand
    w = float(case.aspect)  # street width in units of H
    if case.aspect == 1:
        return [cases.Crown(0.25, 0.75, 1 / 3, 1.0, lam_h)]
    return [
        cases.Crown(0.29, 0.71, 1 / 3, 1.0, lam_h),
        cases.Crown(w - 0.71, w - 0.29, 1 / 3, 1.0, lam_h),
    ]


def build(case: codasc.Case, height: int, schmidt: float, reynolds: float = REYNOLDS):
    g = cases.canyon_geometry(height, 1.0 / case.aspect)
    src = cases.line_sources(g, SOURCE_OFFSETS, SOURCE_TOTAL)
    c = cases.canyon(
        g,
        u_ref=U_H,
        reynolds=reynolds,
        smagorinsky=SMAGORINSKY,
        exponent=PROFILE_EXPONENT,
        crowns=crowns_for(case),
        sources=src,
        schmidt=schmidt,
    )
    return g, c


def _interp_column(field: np.ndarray, xpos: float) -> np.ndarray:
    i = int(np.floor(xpos))
    w = xpos - i
    return (1.0 - w) * field[:, i] + w * field[:, i + 1]


def wall_profiles(g: cases.CanyonGeometry, cplus: np.ndarray) -> dict[str, np.ndarray]:
    """c+ at the CODASC taps; positions in cell-centre coordinates (wall faces at cell edges)."""
    x0, x1 = g.street
    d = TAP_DISTANCE * g.height
    z = HEIGHTS * g.height - 0.5
    rows = np.arange(g.top)
    return {
        "A": np.interp(z, rows, _interp_column(cplus, x0 + d - 0.5)),
        "B": np.interp(z, rows, _interp_column(cplus, x1 - d - 0.5)),
    }


def simulate(case: codasc.Case, height: int, schmidt: float, run: Run, reynolds=REYNOLDS) -> dict:
    """Spin up, then average the concentration; returns c+ at the taps and in the street."""
    from .solver2d.jax_solver import JaxSolver

    g, c = build(case, height, schmidt, reynolds)
    s = JaxSolver(c.domain, c.params, np.float32)
    s.set_state(*cases.uniform_start(c))
    t0 = time.time()
    s.step(run.spin_up)
    healthy = s.healthy()
    total = np.zeros((g.top, g.nx))
    samples = 0
    tracer_totals = []
    while healthy and s.time < run.spin_up + run.average:
        s.step(run.every)
        total += s.concentration()
        samples += 1
        if samples % 50 == 0:
            healthy = s.healthy()
            tracer_totals.append(s.total_tracer())
    if not healthy:
        return {"healthy": False, "steps": s.time}
    scale = U_H * g.height / SOURCE_TOTAL
    cplus = total / samples * scale
    walls = wall_profiles(g, cplus)
    x0, x1 = g.street
    street = cplus[: g.height, x0:x1]
    return {
        "healthy": True,
        "steps": s.time,
        "wall_time_s": round(time.time() - t0, 1),
        "model": {k: [round(float(v), 4) for v in walls[k]] for k in "AB"},
        # The tracer in the domain should level off once the average starts.
        "tracer_total_drift": float(
            (tracer_totals[-1] - tracer_totals[0]) / tracer_totals[-1]
            if len(tracer_totals) > 1
            else 0.0
        ),
        "street_cplus": {
            "rows": int(street.shape[0]),
            "cols": int(street.shape[1]),
            "values": [round(float(v), 3) for v in street.reshape(-1)],
        },
    }


def measured(case: codasc.Case) -> dict[str, list[float]]:
    out = {}
    for wall in "AB":
        data = codasc.load(case, wall)
        prof = data.centre()
        out[wall] = [round(float(v), 4) for v in np.interp(HEIGHTS, data.z, prof)]
    return out


def calibrate(height: int, run: Run) -> dict:
    """Pick the turbulent Schmidt number on the tree-free W/H = 1 case only."""
    case = codasc.Case(1, 90, 0.0, 0)
    obs = measured(case)
    rows = []
    for sc in SCHMIDT_CANDIDATES:
        sim = simulate(case, height, sc, run)
        row = {"schmidt": sc, "healthy": sim["healthy"]}
        if sim["healthy"]:
            pred = np.concatenate([sim["model"]["A"], sim["model"]["B"]])
            row.update(metrics(np.concatenate([obs["A"], obs["B"]]), pred))
            row["model"] = sim["model"]
        rows.append(row)
        print(f"  Sc_t {sc}: {row}", flush=True)
    ok = [r for r in rows if r["healthy"]]
    best = min(ok, key=lambda r: r["nmse"]) if ok else None
    return {
        "name": "Turbulent Schmidt number, calibrated on one CODASC case",
        "method": (
            f"Tree-free street W/H = 1, wind across, H = {height} cells, Re {REYNOLDS:g}, "
            f"Cs {SMAGORINSKY}, power-law inflow (exponent {PROFILE_EXPONENT}), "
            f"{run.spin_up} steps spin-up, {run.average} averaged; candidates "
            f"{list(SCHMIDT_CANDIDATES)}; the one with the lowest NMSE is kept"
        ),
        "metric": "NMSE of c+ on walls A and B at y = 0",
        "case": case.stem,
        "measured": obs,
        "rows": rows,
        "schmidt": best["schmidt"] if best else None,
        "passed": best is not None,
    }


def compare(height: int, run: Run, schmidt: float) -> dict:
    rows = []
    obs_all, pred_all = [], []
    for case in codasc.PERPENDICULAR:
        sim = simulate(case, height, schmidt, run)
        obs = measured(case)
        row = {
            "case": case.stem,
            "aspect_w_over_h": case.aspect,
            "stand_density": case.stand,
            "lambda_per_m": case.lam,
            "healthy": sim["healthy"],
            "measured": obs,
        }
        if sim["healthy"]:
            o = np.concatenate([obs["A"], obs["B"]])
            p = np.concatenate([sim["model"]["A"], sim["model"]["B"]])
            row.update(
                {k: sim[k] for k in ("model", "street_cplus", "tracer_total_drift", "steps")}
            )
            row["metrics"] = metrics(o, p)
            obs_all.append(o)
            pred_all.append(p)
        rows.append(row)
        print(f"  {case.stem}: {row.get('metrics')}", flush=True)
    overall = metrics(np.concatenate(obs_all), np.concatenate(pred_all)) if obs_all else None
    return {
        "name": "Concentrations against the CODASC wind tunnel, wind across the street",
        "method": (
            f"2D centre-plane model, H = {height} cells, Re {REYNOLDS:g}, Cs {SMAGORINSKY}, "
            f"Sc_t {schmidt} (results/trees/calibration.json), power-law inflow (exponent "
            f"{PROFILE_EXPONENT}), {run.spin_up} steps spin-up, {run.average} averaged; ten cases, "
            "walls A and B at y = 0, z/H = 1/6 to 5/6"
        ),
        "metric": "FB, NMSE and FAC2 of c+ against the Hanna and Chang (2012) urban criteria",
        "threshold": HANNA_CHANG_URBAN,
        "schmidt": schmidt,
        "heights": [round(float(z), 4) for z in HEIGHTS],
        "rows": rows,
        "overall": overall,
        "passed": bool(overall is not None and meets_criteria(overall)),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.trees")
    p.add_argument("study", choices=["calibrate", "codasc", "all"])
    p.add_argument("--height", type=int, default=24, help="cells per building height")
    p.add_argument("--quick", action="store_true", help="short coarse run, temporary output")
    args = p.parse_args(argv)
    run = QUICK if args.quick else FULL
    height = 12 if args.quick else args.height
    root = Path(tempfile.mkdtemp(prefix="tvb-trees-")) if args.quick else None
    kw = {"root": root} if root else {}
    failed = False
    studies = ["calibrate", "codasc"] if args.study == "all" else [args.study]
    schmidt = None
    for name in studies:
        t0 = time.time()
        if name == "calibrate":
            payload = calibrate(height, run)
            schmidt = payload["schmidt"]
            path = results.write("trees/calibration.json", payload, GENERATED_BY, **kw)
        else:
            if schmidt is None:
                schmidt = results.read("trees/calibration.json", **kw)["schmidt"]
            payload = compare(height, run, schmidt)
            path = results.write("trees/codasc.json", payload, GENERATED_BY, **kw)
        verdict = "pass" if payload["passed"] else "FAIL"
        print(f"{name:10s} {verdict}  {time.time() - t0:5.0f}s  {path}", flush=True)
        failed |= not payload["passed"]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
