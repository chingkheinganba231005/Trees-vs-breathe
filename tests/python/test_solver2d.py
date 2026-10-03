import json
from pathlib import Path

import numpy as np
import pytest

from treesvb.benchmarks import force_stress, smagorinsky_shear
from treesvb.solver2d import Domain, NumpySolver, Params, analysis, build_stream_map, cases, core
from treesvb.solver2d.lattice import CS2, CX, CY, MIRROR_Y, OPP, Q, W

REPO = Path(__file__).resolve().parents[2]


# Lattice -----------------------------------------------------------------------------------


def test_lattice_symmetries() -> None:
    assert np.isclose(W.sum(), 1.0)
    assert np.allclose((W * CX).sum(), 0) and np.allclose((W * CY).sum(), 0)
    assert np.isclose((W * CX * CX).sum(), CS2)
    assert np.isclose((W * CX * CY).sum(), 0)
    assert np.all(OPP[OPP] == np.arange(Q))
    assert np.all(MIRROR_Y[MIRROR_Y] == np.arange(Q))


def test_equilibrium_moments() -> None:
    rng = np.random.default_rng(1)
    rho = 1 + 0.01 * rng.standard_normal((3, 4))
    ux, uy = 0.05 * rng.standard_normal((2, 3, 4))
    feq = core.equilibrium(np, rho, ux, uy)
    cx, cy = CX[:, None, None], CY[:, None, None]
    assert np.allclose(feq.sum(0), rho)
    assert np.allclose((cx * feq).sum(0), rho * ux)
    assert np.allclose((cy * feq).sum(0), rho * uy)
    assert np.allclose((cx * cx * feq).sum(0), rho * CS2 + rho * ux * ux)
    assert np.allclose((cx * cy * feq).sum(0), rho * ux * uy)


# Streaming map -------------------------------------------------------------------------------


def gather(d: Domain, f: np.ndarray) -> np.ndarray:
    src, add = build_stream_map(d)
    return f.reshape(-1)[src.reshape(-1)].reshape(f.shape) + add


def test_fully_periodic_map_is_a_shift() -> None:
    d = Domain(nx=5, ny=4, left="periodic", right="periodic", bottom="periodic", top="periodic")
    f = np.random.default_rng(0).random((Q, 4, 5))
    out = gather(d, f)
    for i in range(Q):
        assert np.array_equal(out[i], np.roll(f[i], (CY[i], CX[i]), axis=(0, 1)))


def test_bottom_wall_bounces_back() -> None:
    d = Domain(nx=3, ny=3)
    f = np.random.default_rng(0).random((Q, 3, 3))
    out = gather(d, f)
    # Direction 2 (up) at the bottom row comes from below the wall: it is direction 4 reflected.
    assert np.array_equal(out[2, 0], f[4, 0])
    assert np.array_equal(out[5, 0], f[7, 0])
    assert np.array_equal(out[6, 0], f[8, 0])


def test_moving_lid_adds_momentum() -> None:
    d = Domain(nx=3, ny=3, top="moving", lid_velocity=0.1)
    _, add = build_stream_map(d)
    # Direction 8 (+x, down) enters from the lid and gains 2 w rho0 (c.u) / cs^2.
    assert np.allclose(add[8, -1], 2 * W[8] * 0.1 / CS2)
    assert np.allclose(add[7, -1], -2 * W[7] * 0.1 / CS2)
    assert np.allclose(add[:, :-1], 0)


def test_free_slip_top_reflects_specularly() -> None:
    d = Domain(nx=4, ny=3, top="freeslip")
    f = np.random.default_rng(0).random((Q, 3, 4))
    out = gather(d, f)
    top = 2
    assert np.array_equal(out[4, top], f[2, top])
    # Direction 7 (-x, down) at x comes from direction 6 (-x, up) leaving x + 1.
    assert np.array_equal(out[7, top], np.roll(f[6, top], -1))
    assert np.array_equal(out[8, top], np.roll(f[5, top], 1))


def test_inlet_and_outlet_columns_are_held_for_extrapolation() -> None:
    d = Domain(nx=5, ny=3, left="inlet", right="outlet", bottom="wall", top="freeslip")
    f = np.random.default_rng(0).random((Q, 3, 5))
    out = gather(d, f)
    assert np.array_equal(out[:, :, 0], f[:, :, 0])
    assert np.array_equal(out[:, :, -1], f[:, :, -1])
    # The node next to the outlet pulls direction 3 (-x) from the outlet column.
    assert np.array_equal(out[3, :, -2], f[3, :, -1])


def test_outlet_holds_unit_density_and_neighbour_velocity() -> None:
    c = cases.canyon(cases.canyon_geometry(6, 1.0))
    s = NumpySolver(c.domain, c.params)
    s.set_state(*cases.uniform_start(c))
    s.step(50)
    before = s.f_post.copy()
    s.step(1)
    rho_nb = before[:, :, -2].sum(0)
    ux_nb = (CX[:, None] * before[:, :, -2]).sum(0) / rho_nb
    rho_out = s.f_post[:, :, -1].sum(0)
    ux_out = (CX[:, None] * s.f_post[:, :, -1]).sum(0) / rho_out
    assert np.allclose(rho_out, 1.0)
    assert np.allclose(ux_out, ux_nb)


def test_sponge_only_acts_in_its_layers() -> None:
    c = cases.canyon(cases.canyon_geometry(8, 1.0))
    sigma = core.sponge_field(c.domain, c.params.sponge)
    g = cases.canyon_geometry(8, 1.0)
    assert (
        sigma[:, g.height + 1 : c.domain.nx - 2 * g.height - 1][: c.domain.ny - g.height - 1].max()
        == 0
    )
    assert np.isclose(sigma.max(), cases.SPONGE_SIGMA)
    assert (sigma[c.domain.solid] == 0).all()


def test_solid_nodes_and_neighbours() -> None:
    solid = np.zeros((4, 5), bool)
    solid[0:2, 2] = True
    d = Domain(nx=5, ny=4, solid=solid)
    f = np.random.default_rng(0).random((Q, 4, 5))
    out = gather(d, f)
    # Node (y=0, x=3) pulls direction 1 (+x) from the solid at x=2: bounce-back of direction 3.
    assert out[1, 0, 3] == f[3, 0, 3]
    # Solid nodes hold their value.
    assert np.array_equal(out[:, 0, 2], f[:, 0, 2])


@pytest.mark.parametrize(
    "case",
    [
        cases.cavity(9, 100),
        cases.poiseuille(7),
        cases.couette(6, 0.6),
        cases.canyon(cases.canyon_geometry(6, 1.0)),
        cases.canyon(cases.canyon_geometry(6, 3.0)),
    ],
    ids=lambda c: c.name,
)
def test_split_streaming_equals_the_map(case) -> None:
    f = np.random.default_rng(2).random((Q, case.domain.ny, case.domain.nx))
    cfg = core.make_config(case.domain, case.params, np, np.float64)
    assert np.array_equal(core.stream(np, f, cfg), gather(case.domain, f))


def test_domain_validation() -> None:
    with pytest.raises(ValueError):
        Domain(nx=3, ny=3, left="inlet", right="periodic")
    with pytest.raises(ValueError):
        Domain(nx=3, ny=3, top="sideways")
    with pytest.raises(ValueError):
        NumpySolver(Domain(nx=3, ny=3, left="inlet", right="outlet"), Params(tau0=0.6))


# Physics --------------------------------------------------------------------------------------


def test_poiseuille_is_second_order() -> None:
    errs = []
    for h in (8, 16):
        c = cases.poiseuille(h)
        s = NumpySolver(c.domain, c.params)
        s.step(6000 if h == 8 else 9000)
        _, ux, _ = s.macros()
        exact = cases.poiseuille_exact(h, c)
        errs.append(np.linalg.norm(ux[:, 0] - exact) / np.linalg.norm(exact))
    assert errs[1] < 0.005
    assert 1.8 < np.log2(errs[0] / errs[1]) < 2.2


def test_mass_is_conserved_in_a_closed_box() -> None:
    c = cases.cavity(16, 100)
    s = NumpySolver(c.domain, c.params)
    m0 = s.total_mass()
    s.step(500)
    assert abs(s.total_mass() - m0) / m0 < 1e-12


def test_smagorinsky_gives_nu0_plus_cs2_strain() -> None:
    assert smagorinsky_shear(quick=True)["rel_error"] < 1e-3


def test_force_correction_of_stress() -> None:
    assert force_stress(quick=True)["ratio"] < 1e-8


def test_regularised_collision_matches_bgk_moments() -> None:
    """Mass, momentum and stress after collision are BGK's; only higher moments are dropped."""
    rng = np.random.default_rng(3)
    ny, nx = 5, 6
    d = Domain(nx, ny, left="periodic", right="periodic", bottom="periodic", top="periodic")
    cfg = core.make_config(d, Params(tau0=0.52, smagorinsky=0.17, gravity=(2e-5, -1e-5)))
    f = core.equilibrium(np, np.ones((ny, nx)), np.full((ny, nx), 0.04), np.zeros((ny, nx)))
    f = f * (1.0 + rng.normal(0.0, 0.02, f.shape))
    rho, ux, uy = core.macros(np, f, cfg)
    fx, fy = core.body_force(np, rho, ux, uy, cfg)
    feq = core.equilibrium(np, rho, ux, uy)
    p = core.flux(np, f, feq)
    tau = core.relaxation_time(np, p, rho, ux, uy, fx, fy, cfg)
    source = core.guo_source(np, tau, ux, uy, fx, fy)
    bgk = f - (f - feq) / tau + source
    reg = feq + (1.0 - 1.0 / tau) * core.regularised_neq(np, p, fx, fy) + source
    for coef in (np.ones(Q), CX, CY, CX * CX, CY * CY, CX * CY):
        assert np.allclose(np.tensordot(coef, reg, 1), np.tensordot(coef, bgk, 1), atol=1e-14)
    third = CX * CX * CY
    assert not np.allclose(np.tensordot(third, reg, 1), np.tensordot(third, bgk, 1), atol=1e-8)


def test_regularised_collision_outlasts_bgk() -> None:
    from treesvb.benchmarks import collision_margin

    r = collision_margin(quick=True)
    assert r["passed"]
    assert any(not row["bgk"]["stable"] and row["regularised"]["stable"] for row in r["rows"])


def test_canyon_runs_and_stays_healthy() -> None:
    c = cases.canyon(cases.canyon_geometry(8, 1.0))
    s = NumpySolver(c.domain, c.params)
    s.step(400)
    assert s.healthy()
    _, ux, _ = s.macros()
    # Flow above the roofs runs with the wind.
    assert ux[c.domain.ny - 2, c.domain.nx // 2] > 0


def test_numpy_and_jax_agree() -> None:
    pytest.importorskip("jax")
    from treesvb.solver2d.jax_solver import JaxSolver

    c = cases.cavity(24, 100)
    a = NumpySolver(c.domain, c.params)
    b = JaxSolver(c.domain, c.params, np.float32)
    a.step(300)
    b.step(300)
    _, ua, va = a.macros()
    _, ub, vb = b.macros()
    assert max(np.abs(ua - ub).max(), np.abs(va - vb).max()) < 1e-4 * c.u_ref


def test_jax_batches_with_vmap() -> None:
    jax = pytest.importorskip("jax")
    from treesvb.solver2d.jax_solver import run, run_batch

    jnp = jax.numpy
    cfgs = [
        core.make_config(c.domain, c.params, jnp, jnp.float32)
        for c in (cases.cavity(12, 100), cases.cavity(12, 400))
    ]
    stacked = jax.tree.map(lambda *a: jnp.stack(a), *cfgs)
    f0 = jnp.stack([core.initial_state(jnp, cfg, jnp.float32) for cfg in cfgs])
    batch = run_batch(f0, stacked, 50)
    for k, cfg in enumerate(cfgs):
        single = run(f0[k], cfg, 50)
        assert np.allclose(np.asarray(batch[k]), np.asarray(single), atol=1e-7)


# Committed results ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    sorted((REPO / "results/benchmarks").glob("*.json"))
    + sorted((REPO / "results/street").glob("*.json")),
    ids=str,
)
def test_committed_results_pass_and_carry_provenance(path: Path) -> None:
    doc = json.loads(path.read_text())
    for key in ("schema", "generated_by", "generated_at", "commit", "versions", "passed"):
        assert key in doc, key
    assert doc["passed"] is True
    assert doc["dirty"] is False, "regenerate from committed code"


def test_vortex_detector_ignores_a_checkerboard() -> None:
    """Two stacked counter-rotating cells plus an odd-even mode: two vortices, upper clockwise."""
    ny, nx = 24, 12
    y, x = np.mgrid[0:ny, 0:nx] + 0.5
    u = (2 * np.pi / ny) * np.cos(2 * np.pi * y / ny) * np.sin(np.pi * x / nx)
    u = u + 0.05 * ((-1.0) ** np.arange(nx))[None, :] + 0.05 * ((-1.0) ** np.arange(ny))[:, None]
    found = sorted(analysis.canyon_vortices(u, 0 * u, 0, nx, ny, 0.1), key=lambda v: v["z"])
    assert [v["rotation"] for v in found] == ["anticlockwise", "clockwise"]
    assert abs(found[0]["z"] - 0.25) < 0.05 and abs(found[1]["z"] - 0.75) < 0.05
