"""Street-canyon studies behind the live solver's settings and the regime check (BRIEF.md 8.2).

    python -m treesvb.street sponge      # acoustic noise with and without absorbing layers
    python -m treesvb.street stability   # Reynolds number x Smagorinsky constant sweep
    python -m treesvb.street regimes     # vortex structure against H/W
    python -m treesvb.street upwind      # why the studied street has a street upwind of it
    python -m treesvb.street all

Each writes results/street/<name>.json. Runs use the JAX solver in float32, as the browser does.
"""

from __future__ import annotations

import argparse
import itertools
import sys
import time
from dataclasses import replace
from pathlib import Path

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
    strongest = max(vortices, key=lambda v: abs(v["psi"])) if vortices else None
    # The vortex nearest the roofs is the one the wind above drives.
    topmost = max(vortices, key=lambda v: v["z"]) if vortices else None
    # Averaged stream function inside the street, normalised by its peak, for the evidence chart.
    u = mean_u[: g.height, x0:x1]
    psi = np.cumsum(u, axis=0) - 0.5 * u
    psi = psi / np.abs(psi).max()
    return {
        "aspect": aspect,
        "height_cells": height,
        "width_cells": g.width,
        "steps_spin_up": spin_up,
        "steps_averaged": average,
        "vortices": vortices,
        "stacked_primary_vortices": stacked,
        "floor_fraction_with_wind": floor,
        "strongest_vortex_rotation": strongest["rotation"] if strongest else None,
        "top_vortex_rotation": topmost["rotation"] if topmost else None,
        "top_flow_over_uref": _top_flow(mean_u, g),
        "psi": {
            "rows": int(psi.shape[0]),
            "cols": int(psi.shape[1]),
            "note": "row 0 is the street floor; positive is anticlockwise",
            "values": [round(float(v), 3) for v in psi.reshape(-1)],
        },
    }


def _top_flow(mean_u: np.ndarray, g) -> float:
    """Mean along-wind speed over the top tenth of the street, over u_ref.

    Positive means the top of the street moves with the wind, as it does under a skimming flow.
    """
    x0, x1 = g.street
    rows = max(1, g.height // 10)
    return float(mean_u[g.height - rows : g.height, x0:x1].mean() / U_REF)


def _stacked(vortices: list[dict]) -> int:
    """Count counter-rotating cells stacked vertically: alternate rotation from bottom to top."""
    count = 0
    last = None
    for v in vortices:
        if v["rotation"] != last:
            count += 1
            last = v["rotation"]
    return count


#: H/W values of the regime study. H/W 3 is left to the Colab run at H = 48: at H = 24 its street
#: is 8 cells wide.
REGIME_ASPECTS = (0.3, 0.5, 1.0, 2.0)


def regimes(quick: bool = False, height: int | None = None, aspects=None) -> dict:
    height = height or (16 if quick else 24)
    spin_up, average = (8_000, 4_000) if quick else (40_000, 40_000)
    aspects = tuple(aspects) if aspects else ((0.3, 1.0, 2.0) if quick else REGIME_ASPECTS)
    rows = [_regime_row(a, height, spin_up, average) for a in aspects]
    by = {r["aspect"]: r for r in rows}
    checks = []
    if 1.0 in by:
        r = by[1.0]
        checks += [
            {
                "id": "skimming",
                "aspect": 1.0,
                "expectation": "Skimming flow: one vortex fills the street (Oke 1988; Liu, Barth "
                "and Leung 2004)",
                "observed": f"{r['stacked_primary_vortices']} primary vortex cells",
                "passed": r["stacked_primary_vortices"] == 1,
            },
            {
                "id": "rotation",
                "aspect": 1.0,
                "expectation": "The street vortex turns with the wind above it: clockwise for "
                "wind from the left, so the top of the street moves with the wind and the floor "
                "against it",
                "observed": f"strongest vortex {r['strongest_vortex_rotation']}; top of the "
                f"street at {r['top_flow_over_uref']:+.2f} u_ref",
                "passed": r["strongest_vortex_rotation"] == "clockwise"
                and r["top_flow_over_uref"] > 0,
            },
        ]
    for aspect, cid in ((2.0, "stacked"), (3.0, "deep")):
        if aspect not in by:
            continue
        r = by[aspect]
        checks.append(
            {
                "id": cid,
                "aspect": aspect,
                "expectation": "Vortices stacked one above the other, the upper one turning with "
                "the wind above (Liu, Barth and Leung 2004)",
                "observed": f"{r['stacked_primary_vortices']} stacked vortex cells; top vortex "
                f"{r['top_vortex_rotation']}",
                "passed": r["stacked_primary_vortices"] >= 2
                and r["top_vortex_rotation"] == "clockwise",
            }
        )
    wide = [a for a in (0.3, 0.5, 1.0) if a in by]
    if len(wide) >= 2:
        tops = [by[a]["top_flow_over_uref"] for a in wide]
        checks.append(
            {
                "id": "wake",
                "aspect": wide[0],
                "expectation": "The narrower the street, the less of the outer wind reaches into "
                "it (Oke 1988): the flow at the top of the street weakens from H/W "
                + " to ".join(f"{a:g}" for a in wide),
                "observed": ", ".join(f"{v:+.2f}" for v in tops) + " u_ref",
                "passed": all(a > b for a, b in itertools.pairwise(tops)),
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


def upwind(quick: bool = False) -> dict:
    """Why the studied street has streets upwind of it.

    In 2D the vortex shed from the upwind edge of the first block stays over the streets close
    behind it; its backward flow turns their mean vortex the wrong way. The studied street
    therefore starts at least cases.CLEAR_OF_LEADING_EDGE building heights behind the row's edge.
    Checked at H/W 1 and 2, each street alone and in the row the solver uses.
    """
    height, spin_up, average = (16, 8_000, 4_000) if quick else (24, 30_000, 30_000)
    rows = []
    for aspect in (1.0, 2.0):
        default = cases.canyon_geometry(height, aspect).streets
        for streets in (1, default):
            g = cases.canyon_geometry(height, aspect, streets=streets)
            case = cases.canyon(g, u_ref=U_REF, reynolds=20000.0, smagorinsky=0.17)
            s = _solver(case)
            s.step(spin_up)
            mean_u = np.zeros((g.top, g.nx))
            samples = 0
            while s.time < spin_up + average:
                s.step(200)
                mean_u += s.macros()[1]
                samples += 1
            mean_u /= samples
            x0, x1 = g.street
            vort = analysis.canyon_vortices(mean_u, mean_u * 0, x0, x1, g.height, 0.1)
            # The vortex nearest the top is the one the outer flow drives.
            top = max(vort, key=lambda v: v["z"]) if vort else None
            rows.append(
                {
                    "aspect": aspect,
                    "streets_in_row": streets,
                    "leading_edge_to_street_h": (x0 - g.upstream) / g.height,
                    "top_flow_over_uref": _top_flow(mean_u, g),
                    "top_vortex_rotation": top["rotation"] if top else None,
                    "centre_profile_over_uref": [
                        round(float(v), 3) for v in mean_u[: 2 * g.height, (x0 + x1) // 2] / U_REF
                    ],
                }
            )
    used = [r for r in rows if r["streets_in_row"] > 1]
    return {
        "name": "Streets upwind of the studied street",
        "method": f"Streets H/W 1 and 2, H = {height} cells, Re 20000, Cs 0.17; each studied "
        f"street alone and with the upwind streets the solver adds (at least "
        f"{cases.CLEAR_OF_LEADING_EDGE} H from the row's upwind edge); {spin_up} steps of "
        f"spin-up, velocities averaged over {average} steps",
        "metric": "mean along-wind speed over the top tenth of the studied street, over u_ref",
        "rows": rows,
        # The rotation of the vortex nearest the roofs decides; the top-of-street speed is
        # reported too, but it is near zero when that vortex's centre sits at roof height.
        "passed": all(r["top_vortex_rotation"] == "clockwise" for r in used),
    }


STUDIES = {"sponge": sponge, "stability": stability, "regimes": regimes, "upwind": upwind}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m treesvb.street")
    parser.add_argument("study", choices=[*STUDIES, "all"])
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--height", type=int, help="regimes: cells per building height")
    parser.add_argument("--aspects", type=float, nargs="*", help="regimes: H/W values")
    parser.add_argument("--tag", help="regimes: write street/regimes_<tag>.json")
    parser.add_argument("--out", type=Path, help="results root (default: results/)")
    args = parser.parse_args(argv)
    names = list(STUDIES) if args.study == "all" else [args.study]
    failed = False
    for name in names:
        t0 = time.time()
        if name == "regimes":
            payload = regimes(args.quick, args.height, args.aspects)
        else:
            payload = STUDIES[name](args.quick)
        if args.quick:
            # A quick run is too short and coarse for the physics checks; it only shows the code
            # runs. Verdicts come from the full runs committed in results/street/, which the
            # tests require to pass.
            verdict = "pass" if payload["passed"] else "not met (quick run, not checked)"
            print(name, verdict, f"{time.time() - t0:.0f}s")
            continue
        stem = f"{name}_{args.tag}" if args.tag and name == "regimes" else name
        kw = {"root": args.out} if args.out else {}
        path = results.write(f"street/{stem}.json", payload, GENERATED_BY, **kw)
        verdict = "pass" if payload["passed"] else "FAIL"
        print(f"{name:10s} {verdict}  {time.time() - t0:.0f}s  {path}")
        failed |= not payload["passed"]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
