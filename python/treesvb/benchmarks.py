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
from .solver2d.domain import Domain
from .solver2d.numpy_solver import Params, Tracer

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


def porous_lambda(quick: bool) -> dict:
    """A porous block across a channel must give back its pressure-loss coefficient.

    CODASC defines lambda = Delta p / (p_dyn d) for a sample that fills a duct (docs/codasc.md),
    so this is the test the crown model must pass before it is compared with CODASC. The block
    spans the channel; walls are periodic so there is no wall friction. Two numbers per run:
    the momentum balance (p + rho u^2 upstream minus downstream against the summed drag), which
    checks that the drag is applied as specified, and lambda by CODASC's definition, which also
    contains the weakly compressible error of the lattice (density falls across the block, so the
    speed inside rises); that error should shrink as u^2.
    """
    nx, ny, x0, depth = 240, 3, 100, 12
    specs = [(4.8, 0.05), (12.0, 0.05), (12.0, 0.025)]
    rows = []
    for lam_d, u in specs:
        lam = lam_d / depth
        drag = np.zeros((ny, nx))
        drag[:, x0 : x0 + depth] = lam
        d = Domain(nx, ny, left="inlet", right="outlet", bottom="periodic", top="periodic")
        s = NumpySolver(d, Params(tau0=0.6, inlet_u=np.full(ny, u), drag=drag))
        s.set_state(np.ones((ny, nx)), np.full((ny, nx), u), np.zeros((ny, nx)))
        a, b = x0 - 30, x0 + depth + 30
        history: list[float] = []
        # Sound bounces between the inlet and the outlet and decays slowly; step until both
        # measures stop moving.
        while s.time < 80_000:
            s.step(1000)
            rho, ux, _ = s.macros()
            ra, rb, ua, ub = rho[:, a].mean(), rho[:, b].mean(), ux[:, a].mean(), ux[:, b].mean()
            dp = (ra - rb) / 3.0
            force = float((0.5 * lam * rho * np.abs(ux) * ux)[:, x0 : x0 + depth].sum() / ny)
            balance = float((dp + ra * ua**2 - rb * ub**2) / force)
            history.append(balance)
            if len(history) > 3 and max(abs(h - balance) for h in history[-4:]) < 2e-4:
                break
        rows.append(
            {
                "lambda_times_depth": lam_d,
                "inflow_speed": u,
                "steps": s.time,
                "momentum_balance": balance,
                "lambda_ratio": float(dp / (0.5 * ra * ua**2 * depth) / lam),
            }
        )
    bal, err = 2e-3, 0.05
    by_u = {
        r["inflow_speed"]: abs(r["lambda_ratio"] - 1)
        for r in rows
        if r["lambda_times_depth"] == 12.0
    }
    scaling = by_u[0.05] / by_u[0.025] if 0.025 in by_u else None
    return {
        "name": "Porous block: drag and pressure-loss coefficient",
        "method": (
            f"Channel {nx} x {ny} (periodic across), porous block {depth} cells deep, tau 0.6, "
            "stepped until the momentum balance changes by less than 2e-4 over 3000 steps, "
            "float64; lambda d = 4.8 and 12 match the CODASC crowns (80 and 200 1/m over "
            "0.5 H = 0.06 m)"
        ),
        "metric": "momentum balance over drag, and measured over set lambda",
        "threshold": {
            "momentum_balance_within": bal,
            "lambda_ratio_within": err,
            "error_ratio_halving_u_between": [3.0, 5.0],
        },
        "rows": rows,
        "error_ratio_halving_u": scaling,
        "passed": all(abs(r["momentum_balance"] - 1) < bal for r in rows)
        and all(abs(r["lambda_ratio"] - 1) < err for r in rows)
        and (scaling is None or 3.0 < scaling < 5.0),
    }


def tracer_conservation(quick: bool) -> dict:
    """With walls all round and sources inside, the tracer total must equal what was injected."""
    nx, ny = (48, 24) if quick else (96, 48)
    d = Domain(nx, ny, left="periodic", right="periodic", bottom="wall", top="wall")
    src = np.zeros((ny, nx))
    src[2, nx // 5] = 1e-3
    src[ny // 2, nx // 2] = 2e-3
    tracer = Tracer(src, 1e-4, 0.7)
    s = NumpySolver(d, Params(tau0=0.51, smagorinsky=0.17, gravity=(1e-5, 0), tracer=tracer))
    steps = 2000
    s.step(steps)
    injected = float(src.sum() * steps)
    err = abs(s.total_tracer() - injected) / injected
    threshold = 1e-10
    return {
        "name": "Tracer conservation with sources and walls",
        "method": (
            f"{nx} x {ny} channel, periodic along, walls across, force-driven with the "
            f"Smagorinsky model on, two point sources, {steps} steps, float64"
        ),
        "metric": "relative difference between tracer in the domain and tracer injected",
        "threshold": {"rel_error_below": threshold},
        "rel_error": err,
        "passed": err < threshold,
    }


def tracer_pulse(quick: bool) -> dict:
    """A Gaussian pulse in uniform flow must drift and spread like the exact solution."""
    n = 64 if quick else 128
    rows = []
    for diff, (ux0, uy0) in ((0.02, (0.0, 0.0)), (0.02, (0.05, 0.02)), (0.005, (0.05, 0.02))):
        d = Domain(n, n, left="periodic", right="periodic", bottom="periodic", top="periodic")
        s = NumpySolver(d, Params(tau0=0.8, tracer=Tracer(np.zeros((n, n)), diff, 1.0)))
        s.set_state(np.ones((n, n)), np.full((n, n), ux0), np.full((n, n), uy0))
        y, x = np.mgrid[0:n, 0:n].astype(float)
        s0, x0 = 4.0, n * 5 / 16
        c0 = np.exp(-((x - x0) ** 2 + (y - x0) ** 2) / (2 * s0**2))
        s.g_post = core.tracer_equilibrium(np, c0, np.full((n, n), ux0), np.full((n, n), uy0))
        steps = n * 4
        s.step(steps)
        # concentration() streams once more, so the pulse has moved steps + 1 times.
        var = s0**2 + 2 * diff * (steps + 1)
        xc, yc = x0 + ux0 * (steps + 1), x0 + uy0 * (steps + 1)
        exact = s0**2 / var * np.exp(-((x - xc) ** 2 + (y - yc) ** 2) / (2 * var))
        c = s.concentration()
        rows.append(
            {
                "diffusivity": diff,
                "velocity": [ux0, uy0],
                "steps": steps,
                "rel_l2": float(np.sqrt(((c - exact) ** 2).sum() / (exact**2).sum())),
                "mass_change": float(abs(c.sum() / c0.sum() - 1)),
            }
        )
    threshold = 0.03
    return {
        "name": "Tracer pulse against the exact advection-diffusion solution",
        "method": f"{n} x {n} periodic box, uniform flow, Gaussian pulse, D2Q5 BGK, float64",
        "metric": "relative L2 error of the concentration field",
        "threshold": {"rel_l2_below": threshold},
        "rows": rows,
        "passed": all(r["rel_l2"] < threshold and r["mass_change"] < 1e-12 for r in rows),
    }


def _shear_layer_survives(n: int, reynolds: float, regularise: bool, times: float) -> float | None:
    """Run the double shear layer; None if it stays bounded, else the time t U / L it failed."""
    from .solver2d import Domain, Params

    u0 = 0.05
    d = Domain(n, n, bottom="periodic", top="periodic")
    s = NumpySolver(d, Params(tau0=0.5 + 3.0 * u0 * n / reynolds), regularise=regularise)
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n
    k, delta = 80.0, 0.05
    ux = u0 * np.where(y <= 0.5, np.tanh(k * (y - 0.25)), np.tanh(k * (0.75 - y)))
    uy = u0 * delta * np.sin(2.0 * np.pi * (x + 0.25))
    s.set_state(np.ones((n, n)), ux, uy)
    steps = round(times * n / u0)
    chunk = max(1, steps // 40)
    while s.time < steps:
        s.step(chunk)
        if not s.healthy():
            return round(s.time * u0 / n, 3)
    return None


def _street_flicker(height: int, regularise: bool) -> dict:
    """Step-to-step flicker of the street flow: |u(t) - (u(t-1) + u(t+1)) / 2| over u_H."""
    from dataclasses import replace

    from . import trees

    _, c = trees.build(1, trees.crowns_for(trees.codasc.Case(1, 90, 1.0, 200)), height, 0.2)
    c = replace(c, params=replace(c.params, tracer=None))
    jax_solver = _jax_solver()
    if jax_solver is not None:
        s = jax_solver(c.domain, c.params, np.float32, regularise=regularise)
    else:
        s = NumpySolver(c.domain, c.params, np.float32, regularise=regularise)
    s.set_state(*cases.uniform_start(c))
    s.step(20_000 * height // 24)
    u = []
    for _ in range(3):
        s.step(1)
        u.append(s.macros()[1])
    fluid = c.domain.fluid
    p2 = np.abs(u[1] - 0.5 * (u[0] + u[2]))[fluid] / trees.U_H
    return {
        "healthy": s.healthy(),
        "mean": round(float(p2.mean()), 5),
        "max": round(float(p2.max()), 4),
    }


def collision_margin(quick: bool) -> dict:
    """The regularised collision must stay bounded wherever plain BGK does, and flicker less.

    The thin double shear layer of Minion and Brown (1997) rolls up into vortices with steep
    gradients; with no sub-grid model and a viscosity near zero it is under-resolved on purpose, the
    situation of the street near tau = 1/2. The street itself (CODASC W/H 1 with the dense crown)
    shows how much the flow flickers from step to step, which plain BGK does most at sharp corners.
    """
    n = 32 if quick else 64
    times = 2.0
    rows = []
    for re in (1e4, 3e4, 1e5, 1e6, 1e7):
        row = {"reynolds": re, "tau0": round(0.5 + 3.0 * 0.05 * n / re, 8)}
        for name, reg in (("bgk", False), ("regularised", True)):
            failed = _shear_layer_survives(n, re, reg, times)
            row[name] = {"stable": failed is None, "failed_at": failed}
        rows.append(row)
    height = 12 if quick else 24
    flicker = {
        name: _street_flicker(height, reg) for name, reg in (("bgk", False), ("regularised", True))
    }
    ok = all(r["regularised"]["stable"] or not r["bgk"]["stable"] for r in rows)
    calm = (
        flicker["regularised"]["healthy"] and flicker["regularised"]["max"] <= flicker["bgk"]["max"]
    )
    return {
        "name": "Stability margin of the collision near tau = 1/2",
        "method": (
            f"Thin double shear layer of Minion and Brown (1997), kappa 80, delta 0.05, on a "
            f"periodic {n} x {n} grid, u0 = 0.05, no sub-grid model, float64, run for {times:g} "
            "times L / u0; plain BGK against the regularised collision every solver runs. Street "
            f"flicker: CODASC W/H 1 with the dense crown at H = {height} cells, Re 20000, Cs 0.17, "
            f"after {20_000 * height // 24} steps"
        ),
        "metric": (
            "shear layer: bounded (finite, speed below 0.4) to the end, or the time t u0 / L it "
            "failed; street: |u(t) - (u(t-1) + u(t+1)) / 2| over u_H, mean and largest over the "
            "fluid nodes"
        ),
        "threshold": {
            "regularised_stable_wherever_bgk_is": True,
            "street_flicker_not_above_bgk": True,
        },
        "sources": [
            "Minion, M. L. and Brown, D. L. (1997), J. Comput. Phys. 138, 734-765",
            "Latt, J. and Chopard, B. (2006), Math. Comput. Simul. 72, 165-168",
            "Dellar, P. J. (2001), Phys. Rev. E 64, 031203",
        ],
        "grid": n,
        "rows": rows,
        "street_flicker": flicker,
        "passed": bool(ok and calm),
    }


BENCHMARKS: dict[str, Callable[[bool], dict]] = {
    "poiseuille": poiseuille,
    "cavity_re100": lambda q: cavity(100, 64 if q else 128, q),
    "cavity_re1000": lambda q: cavity(1000, 128, q),
    "conservation": conservation,
    "smagorinsky_shear": smagorinsky_shear,
    "force_stress": force_stress,
    "numpy_jax_agreement": agreement,
    "porous_lambda": porous_lambda,
    "tracer_conservation": tracer_conservation,
    "tracer_pulse": tracer_pulse,
    "collision_margin": collision_margin,
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
