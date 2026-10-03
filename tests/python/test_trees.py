"""Phase 2 physics: porous drag of crowns and hedges, the D2Q5 tracer, and the CODASC loader."""

from __future__ import annotations

import numpy as np
import pytest

from treesvb import codasc, trees
from treesvb.solver2d import cases, core
from treesvb.solver2d.domain import Domain
from treesvb.solver2d.lattice import CX, CY
from treesvb.solver2d.numpy_solver import NumpySolver, Params, Tracer

# Porous drag -----------------------------------------------------------------------------------


def test_implicit_drag_satisfies_the_force_balance() -> None:
    rng = np.random.default_rng(1)
    ny, nx = 6, 7
    d = Domain(nx, ny, left="periodic", right="periodic", bottom="periodic", top="periodic")
    drag = rng.uniform(0.0, 3.0, (ny, nx))
    cfg = core.make_config(d, Params(tau0=0.6, drag=drag))
    rho = rng.uniform(0.95, 1.05, (ny, nx))
    f = core.equilibrium(np, rho, rng.normal(0, 0.05, (ny, nx)), rng.normal(0, 0.05, (ny, nx)))
    _, ux, uy = core.macros(np, f, cfg)
    fx, fy = core.body_force(np, rho, ux, uy, cfg)
    # rho u = sum f c + F / 2 must hold with the drag evaluated at the returned velocity.
    mx = np.tensordot(CX, f, 1) + 0.5 * fx
    my = np.tensordot(CY, f, 1) + 0.5 * fy
    assert np.allclose(rho * ux, mx, atol=1e-14)
    assert np.allclose(rho * uy, my, atol=1e-14)


def test_porous_block_drag_balances_the_momentum_loss() -> None:
    """Across a block filling the channel, (p + rho u^2) falls by the total drag."""
    nx, ny, x0, depth, lam = 120, 3, 50, 8, 0.6
    drag = np.zeros((ny, nx))
    drag[:, x0 : x0 + depth] = lam
    d = Domain(nx, ny, left="inlet", right="outlet", bottom="periodic", top="periodic")
    s = NumpySolver(d, Params(tau0=0.6, inlet_u=np.full(ny, 0.05), drag=drag))
    s.set_state(np.ones((ny, nx)), np.full((ny, nx), 0.05), np.zeros((ny, nx)))
    s.step(12_000)
    rho, ux, _ = s.macros()
    a, b = x0 - 20, x0 + depth + 20
    loss = rho[:, a] / 3 + rho[:, a] * ux[:, a] ** 2 - rho[:, b] / 3 - rho[:, b] * ux[:, b] ** 2
    force = (0.5 * lam * rho * np.abs(ux) * ux)[:, x0 : x0 + depth].sum(axis=1)
    assert np.allclose(loss, force, rtol=5e-3)


def test_crown_drag_does_not_depend_on_grid_alignment() -> None:
    crown = cases.Crown(x0=0.29, x1=0.71, z0=1 / 3, z1=1.0, lam_h=9.6)
    for h in (17, 24, 31):
        g = cases.canyon_geometry(h, 1.0)
        total = cases.crown_drag(g, [crown]).sum()
        # lambda (1/cell) times the crown area (cells^2) = lam_h / H * 0.42 * (2/3) * H^2
        assert total == pytest.approx(9.6 * 0.42 * (2 / 3) * h, rel=1e-12)


def test_line_sources_keep_strength_and_position() -> None:
    g = cases.canyon_geometry(24, 1.0)
    offsets = (-0.267, -0.15, 0.15, 0.267)
    src = cases.line_sources(g, offsets, 1e-3)
    assert src.sum() == pytest.approx(1e-3, rel=1e-12)
    assert np.all(src[1:] == 0)
    centre = g.street[0] + 0.5 * g.width
    x = np.arange(g.nx) + 0.5
    left, right = x < centre, x >= centre
    for side, offs in ((left, offsets[:2]), (right, offsets[2:])):
        mean = (src[0, side] * x[side]).sum() / src[0, side].sum()
        assert mean == pytest.approx(centre + np.mean(offs) * g.height, abs=1e-9)


# Tracer ------------------------------------------------------------------------------------------


def test_tracer_is_conserved_with_sources_and_walls() -> None:
    nx, ny = 48, 24
    d = Domain(nx, ny, left="periodic", right="periodic", bottom="wall", top="wall")
    src = np.zeros((ny, nx))
    src[2, 10] = 1e-3
    src[15, 30] = 2e-3
    params = Params(tau0=0.51, smagorinsky=0.17, gravity=(1e-5, 0), tracer=Tracer(src, 1e-4, 0.7))
    s = NumpySolver(d, params)
    s.step(1000)
    injected = src.sum() * 1000
    assert abs(s.total_tracer() - injected) / injected < 1e-11


def test_tracer_pulse_spreads_like_the_exact_solution() -> None:
    n, diff, (ux0, uy0) = 64, 0.02, (0.05, 0.02)
    d = Domain(n, n, left="periodic", right="periodic", bottom="periodic", top="periodic")
    s = NumpySolver(d, Params(tau0=0.8, tracer=Tracer(np.zeros((n, n)), diff, 1.0)))
    s.set_state(np.ones((n, n)), np.full((n, n), ux0), np.full((n, n), uy0))
    y, x = np.mgrid[0:n, 0:n].astype(float)
    s0, x0 = 3.0, 20.0
    c0 = np.exp(-((x - x0) ** 2 + (y - x0) ** 2) / (2 * s0**2))
    s.g_post = core.tracer_equilibrium(np, c0, np.full((n, n), ux0), np.full((n, n), uy0))
    steps = 300
    s.step(steps)
    var = s0**2 + 2 * diff * (steps + 1)
    xc, yc = x0 + ux0 * (steps + 1), x0 + uy0 * (steps + 1)
    exact = s0**2 / var * np.exp(-((x - xc) ** 2 + (y - yc) ** 2) / (2 * var))
    c = s.concentration()
    assert np.sqrt(((c - exact) ** 2).sum() / (exact**2).sum()) < 0.02
    assert c.sum() == pytest.approx(c0.sum(), rel=1e-12)


def test_tracer_leaves_through_the_outlet_and_not_the_inlet() -> None:
    g = cases.canyon_geometry(6, 1.0)
    src = cases.line_sources(g, (0.0,), 1e-3)
    case = cases.canyon(g, u_ref=0.05, reynolds=500, smagorinsky=0.17, sources=src)
    s = NumpySolver(case.domain, case.params)
    s.set_state(*cases.uniform_start(case))
    s.step(3000)
    c = s.concentration()
    assert np.all(s.g_post[:, :, 0] == 0)
    assert c[:, -3:].sum() > 0
    assert s.total_tracer() < 3000 * 1e-3


@pytest.mark.parametrize("crowns", [(), (cases.Crown(0.25, 0.75, 1 / 3, 1.0, 9.6),)])
def test_numpy_and_jax_agree_with_crowns_and_tracer(crowns) -> None:
    """Same step code: NumPy in float64 and JAX in float32 differ only by rounding."""
    pytest.importorskip("jax")
    from treesvb.solver2d.jax_solver import JaxSolver

    g = cases.canyon_geometry(6, 1.0)
    src = cases.line_sources(g, (-0.267, -0.15, 0.15, 0.267), 1e-3)
    case = cases.canyon(g, 0.05, 2000, 0.17, exponent=0.3, crowns=crowns, sources=src, schmidt=0.7)
    a = NumpySolver(case.domain, case.params)
    b = JaxSolver(case.domain, case.params, np.float32)
    for s in (a, b):
        s.set_state(*cases.uniform_start(case))
        s.step(200)
    _, ua, va = a.macros()
    _, ub, vb = b.macros()
    assert max(np.abs(ua - ub).max(), np.abs(va - vb).max()) < 1e-4 * case.u_ref
    ca, cb = a.concentration(), b.concentration()
    assert np.abs(ca - cb).max() < 1e-4 * np.abs(ca).max()


# CODASC ------------------------------------------------------------------------------------------


def _grid_text(sep: str, quoted: bool = True) -> str:
    head = sep.join(f'"{h}"' if quoted else h for h in ("y/H", "z/H", "c+"))
    lines = [head]
    for z in (0.0, 0.5, 1.0):
        for y in (-1.0, -0.25, 0.25, 1.0):
            lines.append(sep.join(str(v) for v in (y, z, 10 * z + y)))
    return "\n".join(lines) + "\n"


@pytest.mark.parametrize("sep", ["\t", " ", ","])
def test_codasc_parser_reads_every_file_layout(sep: str) -> None:
    w = codasc.parse(_grid_text(sep))
    assert w.c.shape == (3, 4)
    assert np.allclose(w.centre(), [0.0, 5.0, 10.0])


def test_codasc_case_list_matches_the_checksums() -> None:
    assert len(codasc.CASES) == 28
    assert len(codasc.PERPENDICULAR) == 10
    assert set(codasc.read_sums()) == set(codasc.files())


# Study runs ------------------------------------------------------------------------------------


def test_run_length_scales_with_the_grid() -> None:
    """A finer grid needs proportionally more steps to cover the same flow-through times."""
    fine = trees.FULL.at(48)
    assert (fine.spin_up, fine.average, fine.every, fine.height) == (80_000, 640_000, 200, 48)
    assert trees.FULL.at(24) == trees.FULL
    odd = trees.QUICK.at(17)
    assert odd.spin_up % odd.every == 0 and odd.average % odd.every == 0


def test_street_run_reports_how_far_it_settled() -> None:
    sim = trees.simulate_street(1, [], 12, 0.7, trees.QUICK)
    assert sim["healthy"]
    assert sim["steps"] == trees.QUICK.spin_up + trees.QUICK.average
    assert 0.0 <= sim["settling"] < 2.0


def test_a_case_two_studies_share_runs_once() -> None:
    first = trees.simulate_street(1, [], 12, 0.7, trees.QUICK)
    assert trees.simulate_street(1.0, (), 12, 0.7, trees.QUICK) is first


# Measured streets ------------------------------------------------------------------------------


def test_breathing_zone_keeps_its_size_in_metres() -> None:
    assert trees.zone_in_metres(trees.FULL_SCALE_HEIGHT_M) == trees.CODASC_ZONE
    z = trees.zone_in_metres(48.88)
    assert z.width * 48.88 == pytest.approx(2.7)
    assert (z.z0 * 48.88, z.z1 * 48.88) == pytest.approx((0.9, 2.7))


def test_lanes_close_in_only_in_narrow_streets() -> None:
    assert trees.lane_offsets(1.0) == trees.SOURCE_OFFSETS
    assert trees.lane_offsets(2.0) == trees.SOURCE_OFFSETS
    assert trees.lane_offsets(0.25) == pytest.approx([o / 4 for o in trees.SOURCE_OFFSETS])


def test_breathing_zone_must_cover_a_cell() -> None:
    g = cases.canyon_geometry(8, 1.0)
    with pytest.raises(ValueError, match="breathing zone"):
        trees.pavement_exposure(g, np.ones((g.top, g.nx)), trees.Zone(0.01, 0.0, 0.01))


def test_measured_street_designs_are_sized_in_metres() -> None:
    from treesvb import streetruns

    width, height_m = 0.225, 48.88
    d = streetruns.designs(width, height_m, {"height_m": 10.0, "spread_m": 5.0})
    assert d["none"] == []
    (row,) = d["trees"]  # a narrow street holds one central row
    assert 0.5 * (row.x0 + row.x1) == pytest.approx(0.5 * width)
    assert (row.x1 - row.x0) * height_m == pytest.approx(5.0)
    assert (row.z0 * height_m, row.z1 * height_m) == pytest.approx((10 / 3, 10.0))
    # CODASC's dense crown per metre: lambda H 24 at 18 m.
    assert row.lam_h * 18.0 / height_m == pytest.approx(24.0)
    (hedge,) = d["hedge"]
    assert (hedge.x1 - hedge.x0) * height_m == pytest.approx(1.5)
    assert hedge.z1 * height_m == pytest.approx(2.5)
    wide = streetruns.designs(2.0, 18.0, {"height_m": 10.0, "spread_m": 5.0})["trees"]
    assert len(wide) == 2
