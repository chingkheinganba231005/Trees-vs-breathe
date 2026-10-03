"""The surrogate's training data: designs, sampling, the batched run and what is stored."""

from __future__ import annotations

import json
from dataclasses import replace

import numpy as np
import pytest

from treesvb import dataset, trees
from treesvb.dataset import Design
from treesvb.solver2d import cases


def test_two_rows_that_meet_become_one_canopy():
    d = Design(1.0, "trees", rows=2, gap=0.3, width=0.5, z0=0.2, z1=0.8, lam_h=20.0)
    [one] = dataset.elements(d, 1.0)
    assert (one.x0, one.x1) == pytest.approx((0.05, 0.95))
    apart = dataset.elements(replace(d, width=0.2), 1.0)
    assert [x for c in apart for x in (c.x0, c.x1)] == pytest.approx([0.2, 0.4, 0.6, 0.8])


def test_shift_moves_the_layout_up_to_the_wall_and_no_further():
    d = Design(0.5, "hedge", rows=1, width=0.1, z1=0.1, lam_h=60.0)
    # A street 2 H wide; the hedge sits at 0.95-1.05, with 0.95 H of room on either side.
    for shift, x0 in ((-1.0, 0.0), (-0.5, 0.475), (0.0, 0.95), (1.0, 1.9)):
        [c] = dataset.elements(replace(d, shift=shift), 2.0)
        assert c.x0 == pytest.approx(x0)
        assert c.x1 - c.x0 == pytest.approx(0.1)


def test_a_layout_wider_than_the_street_is_cut_at_the_walls():
    d = Design(2.0, "trees", rows=1, width=1.2, z0=0.1, z1=1.0, lam_h=10.0, shift=0.7)
    [c] = dataset.elements(d, 0.5)
    assert (c.x0, c.x1) == (0.0, 0.5)


def test_features_describe_the_blocks_as_shares_of_the_width():
    d = Design(0.5, "trees", rows=2, gap=0.4, width=0.2, z0=0.1, z1=0.6, lam_h=100.0)
    f = dataset.features(0.5, dataset.elements(d, 2.0))
    expected = [0.5, 2, 0.15, 0.25, 0.75, 0.85, 0.1, 0.6, 2.0]
    assert f == pytest.approx(expected)
    assert dataset.features(1.0, []) == pytest.approx([1.0] + [0.0] * 8)


def test_latin_hypercube_has_one_point_per_stratum_on_every_axis():
    u = dataset.lhs(40, 5, np.random.default_rng(1))
    assert u.shape == (40, 5)
    for axis in u.T:
        assert sorted(np.floor(axis * 40).astype(int)) == list(range(40))


def test_a_block_gives_every_street_shape_one_full_batch_within_the_ranges():
    plan = dataset.FULL
    designs = dataset.sample_block(plan, plan.aspects, 3)
    assert len(designs) == plan.batch * len(plan.aspects)
    for a in plan.aspects:
        mine = [d for d in designs if d.aspect == a]
        assert [sum(d.kind == k for d in mine) for k in dataset.KINDS] == [
            plan.bare,
            plan.trees,
            plan.hedges,
        ]
    t = [d for d in designs if d.kind == "trees"]
    lo, hi, _ = dataset.TREE_RANGES["width"]
    assert all(lo <= d.width <= hi for d in t)
    assert all(0.1 * d.z1 <= d.z0 <= 0.7 * d.z1 for d in t)
    assert {d.rows for d in t} == {1, 2}
    h = [d for d in designs if d.kind == "hedge"]
    assert all(d.z0 == 0 and d.rows == 1 for d in h)
    # The same seed gives the same block; another seed another one.
    assert dataset.sample_block(plan, plan.aspects, 3) == designs
    assert dataset.sample_block(plan, plan.aspects, 4) != designs


def test_pavements_from_the_band_match_pavement_exposure():
    g = cases.canyon_geometry(24, 0.7)
    field = np.random.default_rng(0).random((g.top, g.nx))
    x0, x1 = g.street
    band = field[: g.height][dataset.band_rows(g.height)][:, x0:x1].mean(axis=0)
    a, b = dataset.pavements(band, g.width, g.height, trees.PAVEMENT_WIDTH)
    ref = trees.pavement_exposure(g, field)
    assert (a, b) == pytest.approx((ref["A"], ref["B"]))


def test_resampling_keeps_constant_and_linear_fields():
    h, w = 24, 40
    assert np.allclose(dataset.to_street_grid(np.full((h, w), 3.0)), 3.0)
    ramp = np.tile(np.arange(w) + 0.5, (h, 1))  # value = distance from the wall in cells
    out = dataset.to_street_grid(ramp)
    x = (np.arange(dataset.FIELD_COLS) + 0.5) / dataset.FIELD_COLS * w
    inner = (x >= 0.5) & (x <= w - 0.5)
    assert np.allclose(out[:, inner], x[inner])
    assert out.shape == (dataset.FIELD_ROWS, dataset.FIELD_COLS)


def _reference(design, plan, schmidt, seed):
    """The same run through JaxSolver, stepped and averaged by hand."""
    from treesvb.solver2d.jax_solver import JaxSolver

    g = cases.canyon_geometry(plan.height, design.aspect)
    case = dataset.live_case(g, schmidt)
    drag = cases.crown_drag(g, dataset.elements(design, g.width / g.height))
    case = replace(case, params=replace(case.params, drag=drag))
    s = JaxSolver(case.domain, case.params, np.float32)
    s.f_post = dataset.initial_states(case, [seed])[0]
    r = plan.run.at(plan.height)
    s.step(r.spin_up)
    acc = np.zeros((g.top, g.nx))
    n = r.average // r.every
    for _ in range(n):
        s.step(r.every)
        acc += s.concentration()
    return acc / n * dataset.U_REF * plan.height / dataset.SOURCE_TOTAL, g


def test_batched_run_matches_the_solver_run_by_run():
    plan = replace(dataset.SMOKE, run=trees.Run(spin_up=60, average=80, every=20, height=8))
    designs = [
        Design(1.0, "trees", rows=1, width=0.5, z0=0.3, z1=0.9, lam_h=24.0),
        Design(1.0, "none"),
    ]
    out = dataset.run_batch(designs, 0.5, plan, [11, 12])
    assert out["healthy"].all()
    for k, d in enumerate(designs):
        cplus, g = _reference(d, plan, 0.5, [11, 12][k])
        x0, x1 = g.street
        street = cplus[: g.height, x0:x1]
        band = street[dataset.band_rows(g.height)].mean(axis=0)
        expected = dataset.pavements(band, g.width, g.height, trees.PAVEMENT_WIDTH)
        got = out["exposure"][k].mean(axis=0)
        assert got == pytest.approx(expected, rel=2e-4, abs=1e-6)
        field = dataset.to_street_grid(street)
        assert np.allclose(out["fields"][k, 0], field, rtol=2e-3, atol=1e-3)
    assert out["features"][1] == pytest.approx([g.aspect] + [0.0] * 8)


def test_smoke_run_writes_blocks_and_a_summary(tmp_path):
    progress = dataset.run(tmp_path / "run", dataset.SMOKE, 0.5, budget_s=0, max_blocks=1)
    assert set(progress["blocks"]) == {"test", "ood", "train_000"}
    blocks = dataset.load(tmp_path / "run")
    train = blocks["train_000"]
    n = dataset.SMOKE.batch * len(dataset.SMOKE.aspects)
    assert train["fields"].shape == (n, 4, dataset.FIELD_ROWS, dataset.FIELD_COLS)
    assert train["fields"].dtype == np.float16
    assert train["exposure"].shape == (n, 2, 2)
    assert (np.sort(train["index"]) == np.arange(n)).all()
    # Resuming finds the finished blocks and runs nothing again.
    again = dataset.run(tmp_path / "run", dataset.SMOKE, 0.5, budget_s=0, max_blocks=1)
    assert again["blocks"] == progress["blocks"]
    payload = dataset.summary(tmp_path / "run")
    json.dumps(payload, allow_nan=False)
    assert payload["train_runs"] == n
    assert [r["aspect"] for r in payload["bare"]] == list(dataset.SMOKE.aspects)
    assert set(payload["files"]) == {"test.npz", "ood.npz", "train_000.npz"}
