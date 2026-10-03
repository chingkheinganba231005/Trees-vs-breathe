"""Trees, hedges and fumes in the street: the phase 2 studies (BRIEF.md 8.3).

    python -m treesvb.trees calibrate   # turbulent Schmidt number on the tree-free CODASC case
    python -m treesvb.trees codasc      # the ten cross-wind CODASC cases against the wind tunnel
    python -m treesvb.trees directions  # trees raise, hedges lower pavement exposure?
    python -m treesvb.trees reynolds    # does pavement exposure move when Re doubles?
    python -m treesvb.trees resolution  # the same cases on a grid twice as fine
    python -m treesvb.trees all

Each writes results/trees/<name>.json under `--out` (default results/). `--height` sets the grid
(cells per building height); `--quick` runs a short, coarse version and writes to a temporary
folder. The Colab notebook colab/01_reference_2d.ipynb runs the full set on an A100.

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

#: Full-scale building height of the CODASC street: 0.12 m at scale 1:150 (Gromke and Ruck 2012,
#: p. 44), used to put full-scale hedge sizes into units of H.
FULL_SCALE_HEIGHT_M = 18.0
#: Hedge of Gromke et al. (2016), as tabulated by Abhijith et al. (2017, Table 3): 2.5 m high,
#: 1.5 m wide, pressure-loss coefficient 3.34 1/m; the single hedge in the middle of the street
#: reduced concentrations most.
HEDGE = {"height_m": 2.5, "width_m": 1.5, "lambda_per_m": 3.34}
#: Pavement breathing zone (docs/assumptions.md A-010), units of H from each wall and the ground.
PAVEMENT_WIDTH = 0.15
BREATHING = (0.05, 0.15)


@dataclass(frozen=True)
class Zone:
    """Pavement breathing zone in units of H: width from each wall, bottom and top."""

    width: float
    z0: float
    z1: float


CODASC_ZONE = Zone(PAVEMENT_WIDTH, *BREATHING)


def zone_in_metres(height_m: float) -> Zone:
    """A-010's zone kept at its full-scale size (2.7 m wide, 0.9-2.7 m high) in a street
    `height_m` tall, rather than at its proportions of H (docs/assumptions.md A-016)."""
    s = FULL_SCALE_HEIGHT_M / height_m
    return Zone(PAVEMENT_WIDTH * s, BREATHING[0] * s, BREATHING[1] * s)


def lane_offsets(width: float) -> tuple[float, ...]:
    """CODASC's lanes in a street `width` H wide: its positions at W >= H, closing in with the
    width in narrower streets (A-012; laneOffsets in apps/web/src/sim/greenery.ts)."""
    return tuple(o * min(1.0, width) for o in SOURCE_OFFSETS)


@dataclass(frozen=True)
class Run:
    """Run length in steps for a grid of `height` cells per building height.

    The lattice inflow speed is fixed, so the flow needs steps in proportion to the grid: `at`
    rescales the run so that a finer grid covers the same number of flow-through times H / u_H.
    """

    spin_up: int
    average: int
    every: int
    height: int

    def at(self, height: int) -> Run:
        def steps(n: int) -> int:
            return max(self.every, round(n * height / self.height / self.every) * self.every)

        return Run(steps(self.spin_up), steps(self.average), self.every, height)


#: The second Colab run averaged 80 000 steps and the halves of that window still differed by
#: 12-150% (docs/codasc.md); four times the window halves the scatter if it falls as 1/sqrt(T).
FULL = Run(spin_up=40_000, average=320_000, every=200, height=24)
QUICK = Run(spin_up=3_000, average=2_000, every=100, height=12)


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


def central_hedge(aspect: int) -> list[cases.Crown]:
    """The hedge of HEDGE on the street axis, between the inner traffic lanes."""
    h = HEDGE["height_m"] / FULL_SCALE_HEIGHT_M
    half = 0.5 * HEDGE["width_m"] / FULL_SCALE_HEIGHT_M
    lam_h = HEDGE["lambda_per_m"] * FULL_SCALE_HEIGHT_M
    mid = 0.5 * aspect
    return [cases.Crown(mid - half, mid + half, 0.0, h, lam_h)]


def build(
    aspect: float,
    crowns,
    height: int,
    schmidt: float,
    reynolds: float = REYNOLDS,
    offsets: tuple[float, ...] = SOURCE_OFFSETS,
):
    """A street of width `aspect` H with the CODASC sources, inflow and the given crowns."""
    g = cases.canyon_geometry(height, 1.0 / aspect)
    src = cases.line_sources(g, offsets, SOURCE_TOTAL)
    c = cases.canyon(
        g,
        u_ref=U_H,
        reynolds=reynolds,
        smagorinsky=SMAGORINSKY,
        exponent=PROFILE_EXPONENT,
        crowns=crowns,
        sources=src,
        schmidt=schmidt,
    )
    return g, c


def pavement_exposure(
    g: cases.CanyonGeometry, cplus: np.ndarray, zone: Zone = CODASC_ZONE
) -> dict[str, float]:
    """Mean c+ in the breathing zone over each pavement: A is the leeward side."""
    x0, x1 = g.street
    xc = np.arange(g.nx) + 0.5
    zc = np.arange(g.top) + 0.5
    rows = (zc >= zone.z0 * g.height) & (zc <= zone.z1 * g.height)
    width = zone.width * g.height
    a = (xc >= x0) & (xc <= x0 + width)
    b = (xc <= x1) & (xc >= x1 - width)
    if not (rows.any() and a.any() and b.any()):
        raise ValueError("the breathing zone covers no cell centre on this grid")
    return {
        "A": float(cplus[np.ix_(rows, a)].mean()),
        "B": float(cplus[np.ix_(rows, b)].mean()),
    }


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
    """A CODASC configuration; see simulate_street."""
    return simulate_street(case.aspect, crowns_for(case), height, schmidt, run, reynolds)


#: Runs already done in this process. The solver is deterministic on given hardware (the second
#: Colab run repeated the first to the last digit), so a case that two studies share runs once.
_RUNS: dict = {}


def simulate_street(
    aspect: float,
    crowns,
    height: int,
    schmidt: float,
    run: Run,
    reynolds=REYNOLDS,
    *,
    offsets: tuple[float, ...] = SOURCE_OFFSETS,
    zone: Zone = CODASC_ZONE,
    fields: bool = False,
) -> dict:
    """Spin up, then average the concentration; c+ at the taps, on the pavements, in the street.

    The average is also kept for its first and second halves: `settling` is the largest relative
    difference between them on the two pavements and over the street, so a run that has not
    reached a steady state shows it. With `fields`, the result also holds the mean c+ and mean
    velocity over the whole grid as arrays under "fields" (not JSON; the caller samples them).
    """
    key = (float(aspect), tuple(crowns), height, schmidt, run, reynolds, offsets, zone, fields)
    if key not in _RUNS:
        _RUNS[key] = _simulate_street(
            aspect, crowns, height, schmidt, run, reynolds, offsets, zone, fields
        )
    return _RUNS[key]


def _simulate_street(aspect, crowns, height, schmidt, run, reynolds, offsets, zone, fields):
    from .solver2d.jax_solver import JaxSolver

    run = run.at(height)
    g, c = build(aspect, crowns, height, schmidt, reynolds, offsets)
    s = JaxSolver(c.domain, c.params, np.float32)
    s.set_state(*cases.uniform_start(c))
    t0 = time.time()
    s.step(run.spin_up)
    healthy = s.healthy()
    halves = [np.zeros((g.top, g.nx)), np.zeros((g.top, g.nx))]
    counts = [0, 0]
    flow = [np.zeros((g.top, g.nx)), np.zeros((g.top, g.nx))]
    tracer_totals = []
    while healthy and s.time < run.spin_up + run.average:
        s.step(run.every)
        half = int(s.time - run.spin_up > run.average // 2)
        halves[half] += s.concentration()
        counts[half] += 1
        if fields:
            _, ux, uy = s.macros()
            flow[0] += ux
            flow[1] += uy
        if sum(counts) % 50 == 0:
            healthy = s.healthy()
            tracer_totals.append(s.total_tracer())
    if not healthy:
        return {"healthy": False, "steps": s.time}
    scale = U_H * g.height / SOURCE_TOTAL
    cplus = (halves[0] + halves[1]) / sum(counts) * scale
    walls = wall_profiles(g, cplus)
    x0, x1 = g.street
    street = cplus[: g.height, x0:x1]

    def summary(field: np.ndarray) -> dict[str, float]:
        return {
            **pavement_exposure(g, field, zone),
            "street": float(field[: g.height, x0:x1].mean()),
        }

    first, second = (summary(h / n * scale) for h, n in zip(halves, counts, strict=True))
    settling = max(abs(second[k] - first[k]) / (0.5 * (second[k] + first[k])) for k in first)
    out = {
        "healthy": True,
        "steps": s.time,
        "wall_time_s": round(time.time() - t0, 1),
        "model": {k: [round(float(v), 4) for v in walls[k]] for k in "AB"},
        "pavement": {k: round(v, 4) for k, v in pavement_exposure(g, cplus, zone).items()},
        "settling": round(float(settling), 4),
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
    if fields:
        n = sum(counts)
        out["fields"] = {"cplus": cplus, "ux": flow[0] / n, "uy": flow[1] / n, "geometry": g}
    return out


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
            f"{run.at(height).spin_up} steps spin-up, {run.at(height).average} averaged; "
            "candidates "
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
                {
                    k: sim[k]
                    for k in ("model", "street_cplus", "tracer_total_drift", "settling", "steps")
                }
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
            f"Sc_t {schmidt} (calibrated at this resolution), power-law inflow (exponent "
            f"{PROFILE_EXPONENT}), {run.at(height).spin_up} steps spin-up, "
            f"{run.at(height).average} averaged; ten cases, "
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


def directions(height: int, run: Run, schmidt: float) -> dict:
    """The direction of the effect, against Abhijith et al. (2017) and the cited studies.

    Trees: the CODASC crown (W/H 1, lambda 200 1/m, dense) should raise exposure on the leeward
    pavement, as CODASC itself shows. Hedge: one central hedge in a broad street (W/H 2) should
    lower it, as Gromke et al. (2016) measured (largest area-averaged reduction 61%, via
    Abhijith et al. 2017, Table 3).
    """
    pairs = [
        ("trees", 1, crowns_for(codasc.Case(1, 90, 1.0, 200)), "up"),
        ("hedge", 2, central_hedge(2), "down"),
    ]
    rows = []
    for name, aspect, crowns, expected in pairs:
        base = simulate_street(aspect, [], height, schmidt, run)
        green = simulate_street(aspect, crowns, height, schmidt, run)
        if not (base["healthy"] and green["healthy"]):
            rows.append({"case": name, "healthy": False, "passed": False})
            continue
        ratio = {k: green["pavement"][k] / base["pavement"][k] for k in "AB"}
        leeward = ratio["A"]
        ok = leeward > 1.0 if expected == "up" else leeward < 1.0
        rows.append(
            {
                "case": name,
                "aspect_w_over_h": aspect,
                "expected_leeward": expected,
                "pavement_without": base["pavement"],
                "pavement_with": green["pavement"],
                "ratio": {k: round(v, 4) for k, v in ratio.items()},
                "passed": ok,
            }
        )
        print(f"  {name}: {rows[-1]}", flush=True)
    return {
        "name": "Direction of the effect: trees and a hedge on the pavements",
        "method": (
            f"2D street, H = {height} cells, Re {REYNOLDS:g}, Sc_t {schmidt}; trees: CODASC "
            "crown at W/H 1 (lambda 200 1/m, dense); hedge: 2.5 m high, 1.5 m wide, lambda "
            "3.34 1/m in the middle of a W/H 2 street (Gromke et al. 2016 via Abhijith et al. "
            f"2017, Table 3), full-scale H = {FULL_SCALE_HEIGHT_M:g} m; exposure: mean c+ within "
            f"{PAVEMENT_WIDTH} H of each wall, {BREATHING[0]}-{BREATHING[1]} H above the ground"
        ),
        "metric": "pavement exposure with the trees or hedge over exposure without",
        "sources": [
            "Abhijith et al. (2017), Atmos. Environ. 162, 71-86, pp. 4, 8, 15 and Table 3",
            "Gromke et al. (2016), Atmos. Environ. 139, 75-86, as summarised in Table 3 above",
        ],
        "rows": rows,
        "passed": all(r["passed"] for r in rows),
    }


def reynolds(height: int, run: Run, schmidt: float) -> dict:
    """Pavement exposure at Re 20 000 and 40 000 (assumption A-004)."""
    threshold = 0.10
    rows = []
    for case in (codasc.Case(1, 90, 0.0, 0), codasc.Case(1, 90, 1.0, 200)):
        sims = {
            re: simulate(case, height, schmidt, run, reynolds=re) for re in (REYNOLDS, 2 * REYNOLDS)
        }
        if not all(s["healthy"] for s in sims.values()):
            rows.append({"case": case.stem, "healthy": False, "passed": False})
            continue
        lo, hi = sims[REYNOLDS]["pavement"], sims[2 * REYNOLDS]["pavement"]
        change = {k: abs(hi[k] / lo[k] - 1.0) for k in "AB"}
        rows.append(
            {
                "case": case.stem,
                "pavement": {f"{REYNOLDS:g}": lo, f"{2 * REYNOLDS:g}": hi},
                "relative_change": {k: round(v, 4) for k, v in change.items()},
                "passed": max(change.values()) < threshold,
            }
        )
        print(f"  {case.stem}: {rows[-1]}", flush=True)
    return {
        "name": "Reynolds-number sensitivity of pavement exposure",
        "method": (
            f"CODASC W/H 1 without trees and with the dense crown (lambda 200 1/m), H = {height} "
            f"cells, Sc_t {schmidt}, Re {REYNOLDS:g} and {2 * REYNOLDS:g}"
        ),
        "metric": "relative change of pavement exposure when Re doubles",
        "threshold": {"relative_change_below": threshold},
        "rows": rows,
        "passed": all(r["passed"] for r in rows),
    }


def resolution(height: int, run: Run, schmidt: float) -> dict:
    """The comparison at twice the grid resolution, for two cases (informational)."""
    rows = []
    for case in (codasc.Case(1, 90, 0.0, 0), codasc.Case(1, 90, 1.0, 200)):
        obs = measured(case)
        o = np.concatenate([obs["A"], obs["B"]])
        row = {"case": case.stem, "measured": obs}
        for h in (height, 2 * height):
            sim = simulate(case, h, schmidt, run)
            if sim["healthy"]:
                p = np.concatenate([sim["model"]["A"], sim["model"]["B"]])
                row[f"h{h}"] = {"model": sim["model"], "metrics": metrics(o, p)}
            else:
                row[f"h{h}"] = {"healthy": False}
        rows.append(row)
        print(f"  {case.stem}: done", flush=True)
    return {
        "name": "Grid resolution of the CODASC comparison",
        "method": (
            f"Two CODASC cases at H = {height} and {2 * height} cells, Sc_t {schmidt}, run "
            "lengths scaled with the grid so both cover the same flow-through times"
        ),
        "metric": "FB, NMSE and FAC2 at each resolution",
        "rows": rows,
        "passed": all(all("model" in r[k] for k in r if k.startswith("h")) for r in rows),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.trees")
    p.add_argument("study", choices=[*STUDIES, "all"])
    p.add_argument("--height", type=int, default=24, help="cells per building height")
    p.add_argument("--quick", action="store_true", help="short coarse run, temporary output")
    p.add_argument("--out", type=Path, help="results root (default: results/)")
    p.add_argument("--schmidt", type=float, help="use this Sc_t instead of the calibration result")
    p.add_argument("--tag", help="suffix for the output names, e.g. h48 -> codasc_h48.json")
    args = p.parse_args(argv)
    suffix = f"_{args.tag}" if args.tag else ""
    run = QUICK if args.quick else FULL
    height = 12 if args.quick else args.height
    root = args.out or (Path(tempfile.mkdtemp(prefix="tvb-trees-")) if args.quick else None)
    kw = {"root": root} if root else {}
    failed = False
    names = list(STUDIES) if args.study == "all" else [args.study]
    schmidt = args.schmidt
    for name in names:
        t0 = time.time()
        if name == "calibrate":
            payload = calibrate(height, run)
            schmidt = payload["schmidt"]
        else:
            if schmidt is None:
                schmidt = results.read(f"trees/calibration{suffix}.json", **kw)["schmidt"]
            payload = STUDIES[name](height, run, schmidt)
        payload["height_cells"] = height
        path = results.write(f"trees/{OUTPUT[name]}{suffix}.json", payload, GENERATED_BY, **kw)
        verdict = "pass" if payload["passed"] else "FAIL"
        print(f"{name:10s} {verdict}  {time.time() - t0:5.0f}s  {path}", flush=True)
        failed |= not payload["passed"]
    return 1 if failed else 0


STUDIES = {
    "calibrate": calibrate,
    "codasc": compare,
    "directions": directions,
    "reynolds": reynolds,
    "resolution": resolution,
}
OUTPUT = {
    "calibrate": "calibration",
    "codasc": "codasc",
    "directions": "directions",
    "reynolds": "reynolds",
    "resolution": "resolution",
}


if __name__ == "__main__":
    sys.exit(main())
