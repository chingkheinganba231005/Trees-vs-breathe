"""Solver benchmarks (BRIEF.md section 8.1). Writes results/benchmarks/*.json.

    python -m treesvb.benchmarks            # full set, written to results/benchmarks/
    python -m treesvb.benchmarks --quick    # small grids, for CI; written to a temporary folder
    python -m treesvb.benchmarks --only cavity_re1000

Each result states its threshold and whether it passed, so the app and docs/validation.md read
the verdict from the file rather than recomputing it.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np

from . import results
from .reference import ghia1982
from .solver2d import NumpySolver, analysis, cases, core

GENERATED_BY = "python -m treesvb.benchmarks"


def _jax_solver():
    try:
        from .solver2d.jax_solver import JaxSolver
    except ImportError:  # JAX is optional; NumPy gives the same answers, more slowly.
        return None
    return JaxSolver


def run_to_steady(solver, check_every: int, tol: float, max_steps: int) -> tuple[int, bool]:
    """Step until the velocity changes by less than tol (absolute) over check_every steps."""
    _, ux, uy = solver.macros()
    while solver.time < max_steps:
        solver.step(check_every)
        _, ux2, uy2 = solver.macros()
        if not np.isfinite(ux2).all():
            return solver.time, False
        change = max(np.abs(ux2 - ux).max(), np.abs(uy2 - uy).max())
        ux, uy = ux2, uy2
        if change < tol:
            return solver.time, True
    return solver.time, False


def _r(a, digits: int = 5) -> list[float]:
    return [round(float(v), digits) for v in np.asarray(a).reshape(-1)]


def poiseuille(quick: bool) -> dict:
    heights = (16, 32) if quick else (16, 32, 64)
    rows = []
    for h in heights:
        c = cases.poiseuille(h)
        s = NumpySolver(c.domain, c.params)
        steps, ok = run_to_steady(s, 500, 1e-13, 400_000)
        _, ux, _ = s.macros()
        err = analysis.relative_l2(ux[:, 0], cases.poiseuille_exact(h, c))
        rows.append(
            {"height": h, "tau": c.params.tau0, "steps": steps, "converged": ok, "rel_l2": err}
        )
    order = float(np.log2(rows[0]["rel_l2"] / rows[1]["rel_l2"]))
    threshold = 0.01
    passed = all(r["rel_l2"] < threshold for r in rows if r["height"] >= 32) and all(
        r["converged"] for r in rows
    )
    return {
        "name": "Channel flow against the exact Poiseuille profile",
        "method": "Body-force-driven channel, half-way bounce-back walls, Guo forcing, float64",
        "metric": "relative L2 error of the velocity profile",
        "threshold": {"rel_l2_below": threshold, "for_height_at_least": 32},
        "rows": rows,
        "observed_order": order,
        "passed": passed,
    }


def cavity(reynolds: int, n: int, quick: bool) -> dict:
    c = cases.cavity(n, reynolds)
    jax_solver = _jax_solver()
    if jax_solver is not None:
        s, backend = jax_solver(c.domain, c.params, np.float32), "jax float32"
    else:
        s, backend = NumpySolver(c.domain, c.params), "numpy float64"
    t0 = time.time()
    # float32 round-off keeps the change per check near 1e-6 of the lid speed, so the steady
    # test uses 1e-4 of it: still 200 times finer than the 2% tolerance against Ghia.
    steps, ok = run_to_steady(s, 2000, 1e-4 * c.u_ref, 600_000)
    _, ux, uy = s.macros()
    yu, xv = analysis.cavity_centrelines(ux, uy, c.u_ref)
    tu, tv = ghia1982.TABLES[reynolds]
    cu = analysis.compare_with_table(yu, tu)
    cv = analysis.compare_with_table(xv, tv)
    threshold = {100: 0.02, 1000: 0.05}[reynolds]
    worst = max(cu["max_abs_error"], cv["max_abs_error"])
    return {
        "name": f"Lid-driven cavity at Re {reynolds} against Ghia et al. (1982)",
        "method": f"{n} x {n} nodes, lid speed {c.u_ref} (lattice), tau {c.params.tau0:.5f}, "
        f"BGK without sub-grid model, {backend}",
        "metric": "largest absolute difference from Ghia's centreline velocities, as a "
        "fraction of the lid speed",
        "threshold": {"max_abs_error_below": threshold},
        "reference": ghia1982.SOURCE,
        "reynolds": reynolds,
        "grid": n,
        "steps": steps,
        "converged": ok,
        "wall_time_s": round(time.time() - t0, 1),
        "u_vertical_centreline": cu,
        "v_horizontal_centreline": cv,
        # Full simulated profiles for the chart, wall values included.
        "profile_u": {"y": _r(yu[0]), "u": _r(yu[1])},
        "profile_v": {"x": _r(xv[0]), "v": _r(xv[1])},
        "max_abs_error": worst,
        "passed": bool(ok and worst < threshold),
    }


def conservation(quick: bool) -> dict:
    c = cases.cavity(32 if quick else 64, 100)
    s = NumpySolver(c.domain, c.params)
    m0 = s.total_mass()
    steps = 5000
    s.step(steps)
    drift = abs(s.total_mass() - m0) / m0
    threshold = 0.005
    return {
        "name": "Mass conservation in a closed cavity",
        "method": f"{c.domain.nx} x {c.domain.ny} lid-driven cavity, {steps} steps, float64",
        "metric": "relative change of total mass",
        "threshold": {"rel_change_below": threshold},
        "rel_change": drift,
        "passed": drift < threshold,
    }


def smagorinsky_shear(quick: bool) -> dict:
    """The closed-form relaxation time must give nu = nu0 + Cs^2 |S| in uniform shear."""
    cs = 0.17
    c = cases.couette(32, tau=0.51, lid=0.05, smagorinsky=cs)
    s = NumpySolver(c.domain, c.params)
    u = np.tile(cases.couette_exact(c)[:, None], (1, c.domain.nx))
    s.set_state(np.ones_like(u), u, np.zeros_like(u))
    s.step(500)
    strain = c.u_ref / c.domain.ny
    nu_t = (np.asarray(s.tau)[2:-2, 0] - 0.5) / 3.0 - c.params.nu0
    expected = cs**2 * strain
    err = float(np.abs(nu_t / expected - 1.0).max())
    threshold = 0.01
    return {
        "name": "Smagorinsky eddy viscosity in uniform shear",
        "method": "Couette flow started from its exact linear profile, Cs = 0.17, tau0 = 0.51, "
        "500 steps, float64; interior rows",
        "metric": "relative difference between the solver's eddy viscosity and Cs^2 |S|",
        "threshold": {"rel_error_below": threshold},
        "smagorinsky": cs,
        "strain_rate": strain,
        "expected_nu_t": expected,
        "rel_error": err,
        "passed": err < threshold,
    }


def force_stress(quick: bool) -> dict:
    """With Guo forcing, the corrected non-equilibrium flux must vanish when there is no strain."""
    from .solver2d import Domain, Params

    d = Domain(nx=4, ny=4, left="periodic", right="periodic", bottom="periodic", top="periodic")
    s = NumpySolver(d, Params(tau0=0.8, gravity=(1e-4, 5e-5)))
    s.step(200)
    f = s.pre_collision()
    rho, ux, uy = s.macros(f)
    fx, fy = rho * s.cfg["gx"], rho * s.cfg["gy"]
    feq = core.equilibrium(np, rho, ux, uy)
    from .solver2d.lattice import CX, CY

    fneq = f - feq
    k = (slice(None), 0, 0)
    pxx = float((CX * CX * fneq[k]).sum() + fx[0, 0] * ux[0, 0])
    pxy = float((CX * CY * fneq[k]).sum() + 0.5 * (fx[0, 0] * uy[0, 0] + fy[0, 0] * ux[0, 0]))
    scale = float(abs(fx[0, 0] * ux[0, 0]))
    ratio = max(abs(pxx), abs(pxy)) / scale
    threshold = 1e-6
    return {
        "name": "Force correction of the stress used by the sub-grid model",
        "method": "Fully periodic box under uniform force (zero strain), tau 0.8, 200 steps",
        "metric": "corrected non-equilibrium flux relative to F u",
        "threshold": {"ratio_below": threshold},
        "ratio": ratio,
        "passed": ratio < threshold,
    }


def agreement(quick: bool) -> dict:
    """NumPy float64 against JAX float32 on the same cases."""
    jax_solver = _jax_solver()
    rows = []
    specs = [
        (cases.cavity(32, 100), 2000),
        (cases.poiseuille(16), 2000),
        # Turbulent flow: float32 and float64 runs part ways over time, so compare the start-up.
        (cases.canyon(cases.canyon_geometry(8, 1.0)), 500),
    ]
    if jax_solver is None:
        return {"name": "NumPy against JAX", "skipped": "JAX not installed", "passed": True}
    for c, steps in specs:
        a = NumpySolver(c.domain, c.params)
        b = jax_solver(c.domain, c.params, np.float32)
        a.step(steps)
        b.step(steps)
        _, ua, va = a.macros()
        _, ub, vb = b.macros()
        diff = float(max(np.abs(ua - ub).max(), np.abs(va - vb).max()) / c.u_ref)
        rows.append({"case": c.name, "steps": steps, "max_abs_diff_over_uref": diff})
    threshold = 0.005
    return {
        "name": "NumPy (float64) against JAX (float32)",
        "method": "Same step code on both backends; velocity fields after a fixed number of steps",
        "metric": "largest velocity difference as a fraction of the reference speed",
        "threshold": {"max_abs_diff_over_uref_below": threshold},
        "rows": rows,
        "passed": all(r["max_abs_diff_over_uref"] < threshold for r in rows),
    }


BENCHMARKS: dict[str, Callable[[bool], dict]] = {
    "poiseuille": poiseuille,
    "cavity_re100": lambda q: cavity(100, 64 if q else 128, q),
    "cavity_re1000": lambda q: cavity(1000, 128, q),
    "conservation": conservation,
    "smagorinsky_shear": smagorinsky_shear,
    "force_stress": force_stress,
    "numpy_jax_agreement": agreement,
}
QUICK_SKIP = {"cavity_re1000"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m treesvb.benchmarks")
    parser.add_argument("--quick", action="store_true", help="small grids, temporary output")
    parser.add_argument("--only", nargs="*", choices=sorted(BENCHMARKS))
    parser.add_argument("--out", type=Path, help="results root (default: results/)")
    args = parser.parse_args(argv)

    names = args.only or [n for n in BENCHMARKS if not (args.quick and n in QUICK_SKIP)]
    root = args.out or (Path(tempfile.mkdtemp(prefix="tvb-bench-")) if args.quick else None)
    failed = []
    for name in names:
        t0 = time.time()
        payload = BENCHMARKS[name](args.quick)
        path = results.write(
            f"benchmarks/{name}.json", payload, GENERATED_BY, **({"root": root} if root else {})
        )
        verdict = "pass" if payload["passed"] else "FAIL"
        print(f"{name:22s} {verdict}  {time.time() - t0:6.1f}s  {path}", flush=True)
        if not payload["passed"]:
            failed.append(name)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
