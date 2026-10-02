"""Street-canyon studies behind the live solver's settings and the regime check (BRIEF.md 8.2).

    python -m treesvb.street sponge      # acoustic noise with and without absorbing layers
    python -m treesvb.street stability   # Reynolds number x Smagorinsky constant sweep
    python -m treesvb.street regimes     # vortex structure against H/W
    python -m treesvb.street all

Each writes results/street/<name>.json. Runs use the JAX solver in float32, as the browser does.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import replace

import numpy as np

from . import results
from .solver2d import analysis, cases

GENERATED_BY = "python -m treesvb.street"
U_REF = 0.05


def _solver(case):
    from .solver2d.jax_solver import JaxSolver

    s = JaxSolver(case.domain, case.params, np.float32)
    s.set_state(*cases.uniform_start(case))
    return s


def _interior(case, g) -> np.ndarray:
    """Fluid nodes outside the absorbing layers."""
    m = case.domain.fluid.copy()
    _, l_in, l_out, l_top = case.params.sponge or (0, g.height, 2 * g.height, g.height)
    m[:, : max(l_in, g.height)] = False
    m[:, case.domain.nx - max(l_out, 2 * g.height) :] = False
    m[case.domain.ny - max(l_top, g.height) :, :] = False
    return m


def sponge(quick: bool = False) -> dict:
    height, steps, every = (16, 12_000, 2000) if quick else (24, 40_000, 2000)
    g = cases.canyon_geometry(height, 1.0)
    base = cases.canyon(g, u_ref=U_REF, reynolds=20000.0, smagorinsky=0.17)
    rows = []
    for label, case in (
        (
            "without absorbing layers",
            replace(base, params=replace(base.params, sponge=(0.0, 0, 0, 0))),
        ),
        ("with absorbing layers", base),
    ):
        s = _solver(case)
        inner = _interior(base, g)
        series = []
        while s.time < steps:
            s.step(every)
            rho, ux, uy = s.macros()
            series.append(
                {
                    "step": s.time,
                    "rho_std": float(rho[inner].std()),
                    "max_speed_over_uref": float(np.hypot(ux, uy)[inner].max() / U_REF),
                }
            )
        late = series[len(series) // 2 :]
        rows.append(
            {
                "configuration": label,
                "sponge": list(case.params.sponge),
                "series": series,
                "mean_rho_std_second_half": float(np.mean([r["rho_std"] for r in late])),
                "mean_max_speed_second_half": float(
                    np.mean([r["max_speed_over_uref"] for r in late])
                ),
            }
        )
    # Vortex pressure scale: rho u^2 / cs^2 with u = 2 u_ref (the speed-up over the roofs).
    physical = (2 * U_REF) ** 2 * 3
    ratio = rows[0]["mean_rho_std_second_half"] / rows[1]["mean_rho_std_second_half"]
    return {
        "name": "Absorbing layers against sound trapped in the domain",
        "method": f"Street canyon H = {height} cells, H/W = 1, Re 20000, Cs 0.17, {steps} steps "
        "from uniform flow; density spread outside the layers every 2000 steps",
        "metric": "standard deviation of density outside the layers (pressure noise)",
        "vortex_pressure_scale": physical,
        "rows": rows,
        "noise_reduction_factor": ratio,
        "threshold": {"noise_reduction_factor_above": 3.0},
        "passed": ratio > 3.0,
    }


def stability(quick: bool = False) -> dict:
    height, steps = (16, 10_000) if quick else (24, 40_000)
    g = cases.canyon_geometry(height, 1.0)
    rows = []
    combos = [(re, cs) for re in (2000.0, 5000.0, 10000.0, 20000.0, 50000.0) for cs in (0.1, 0.17)]
    if quick:
        combos = [(20000.0, 0.17), (20000.0, 0.1)]
    for re, cs in combos:
        case = cases.canyon(g, u_ref=U_REF, reynolds=re, smagorinsky=cs)
        s = _solver(case)
        stable = True
        peak = 0.0
        while s.time < steps:
            s.step(1000)
            speed = s.max_speed()
            if not np.isfinite(speed) or speed >= 0.4:
                stable = False
                break
            peak = max(peak, speed)
        rows.append(
            {
                "reynolds": re,
                "smagorinsky": cs,
                "tau0": case.params.tau0,
                "steps_run": s.time,
                "stable": stable,
                "peak_speed_over_uref": peak / U_REF if stable else None,
            }
        )
    live = next(r for r in rows if r["reynolds"] == 20000.0 and r["smagorinsky"] == 0.17)
    return {
        "name": "Stability of the street-canyon solver",
        "method": f"Street canyon H = {height} cells, H/W = 1, {steps} steps from uniform flow, "
        "absorbing layers on; unstable means NaN or a speed of 0.4 lattice units",
        "rows": rows,
        "live_setting": {"reynolds": 20000.0, "smagorinsky": 0.17},
        "passed": bool(live["stable"]),
    }


def _regime_row(aspect: float, height: int, spin_up: int, average: int) -> dict:
    g = cases.canyon_geometry(height, aspect)
    case = cases.canyon(g, u_ref=U_REF, reynolds=20000.0, smagorinsky=0.17)
    s = _solver(case)
    s.step(spin_up)
    mean_u = np.zeros((g.top, g.nx))
    mean_v = np.zeros((g.top, g.nx))
    samples = 0
    while s.time < spin_up + average:
        s.step(200)
        _, ux, uy = s.macros()
        mean_u += ux
        mean_v += uy
        samples += 1
    mean_u /= samples
    mean_v /= samples
    x0, x1 = g.street
    vortices = analysis.canyon_vortices(mean_u, mean_v, x0, x1, g.height, min_strength=0.1)
    # Primary vortices: the strongest per height band, ordered bottom to top.
    vortices.sort(key=lambda v: v["z"])
    stacked = _stacked(vortices)
    floor = analysis.floor_reattachment(mean_u, x0, x1, rows=2)
    return {
        "aspect": aspect,
        "height_cells": height,
        "width_cells": g.width,
        "steps_spin_up": spin_up,
        "steps_averaged": average,
        "vortices": vortices,
        "stacked_primary_vortices": stacked,
        "floor_fraction_with_wind": floor,
    }


def _stacked(vortices: list[dict]) -> int:
    """Count counter-rotating cells stacked vertically: alternate rotation from bottom to top."""
    count = 0
    last = None
    for v in vortices:
        if v["rotation"] != last:
            count += 1
            last = v["rotation"]
    return count


def regimes(quick: bool = False) -> dict:
    height, spin_up, average = (16, 8_000, 4_000) if quick else (24, 40_000, 40_000)
    aspects = (0.3, 1.0, 2.0) if quick else (0.3, 0.5, 1.0, 2.0, 3.0)
    rows = [_regime_row(a, height, spin_up, average) for a in aspects]
    by = {r["aspect"]: r for r in rows}
    checks = [
        {
            "aspect": 1.0,
            "expectation": "Skimming flow: one vortex fills the street (Oke 1988; Liu, Barth "
            "and Leung 2004)",
            "observed": f"{by[1.0]['stacked_primary_vortices']} primary vortex cells; "
            f"{by[1.0]['floor_fraction_with_wind']:.0%} of the floor with the wind",
            "passed": by[1.0]["stacked_primary_vortices"] == 1
            and by[1.0]["floor_fraction_with_wind"] < 0.3,
        },
        {
            "aspect": 2.0,
            "expectation": "Two vertically stacked, counter-rotating vortices (Liu, Barth and "
            "Leung 2004)",
            "observed": f"{by[2.0]['stacked_primary_vortices']} stacked vortex cells",
            "passed": by[2.0]["stacked_primary_vortices"] >= 2,
        },
        {
            "aspect": 0.3,
            "expectation": "Outside skimming flow (H/W below 0.7, Oke 1988): the outer flow "
            "reaches the street floor",
            "observed": f"{by[0.3]['floor_fraction_with_wind']:.0%} of the floor with the wind",
            "passed": by[0.3]["floor_fraction_with_wind"] > 0.3,
        },
    ]
    if 3.0 in by:
        checks.append(
            {
                "aspect": 3.0,
                "expectation": "Very deep street: at least two stacked vortices",
                "observed": f"{by[3.0]['stacked_primary_vortices']} stacked vortex cells",
                "passed": by[3.0]["stacked_primary_vortices"] >= 2,
            }
        )
    return {
        "name": "Vortex structure against street aspect ratio",
        "method": f"Street canyon H = {height} cells, Re 20000, Cs 0.17, absorbing layers; "
        f"{spin_up} steps of spin-up then velocities averaged over {average} steps. Vortex "
        "centres are extrema of the averaged stream function inside the street holding at "
        "least 10% of its peak.",
        "sources": [
            "Oke (1988), via Buccolieri et al. (2020), arXiv 2005.10198",
            "Liu, Barth and Leung (2004), J. Appl. Meteorol. 43, 1410-1424",
        ],
        "rows": rows,
        "checks": checks,
        "passed": all(c["passed"] for c in checks),
    }


STUDIES = {"sponge": sponge, "stability": stability, "regimes": regimes}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m treesvb.street")
    parser.add_argument("study", choices=[*STUDIES, "all"])
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args(argv)
    names = list(STUDIES) if args.study == "all" else [args.study]
    failed = False
    for name in names:
        t0 = time.time()
        payload = STUDIES[name](args.quick)
        if args.quick:
            print(name, "pass" if payload["passed"] else "FAIL", f"{time.time() - t0:.0f}s")
        else:
            path = results.write(f"street/{name}.json", payload, GENERATED_BY)
            verdict = "pass" if payload["passed"] else "FAIL"
            print(f"{name:10s} {verdict}  {time.time() - t0:.0f}s  {path}")
        failed |= not payload["passed"]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
