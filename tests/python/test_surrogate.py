"""The surrogate's pieces: the field model's input, scores, the guard and the float16 export."""

from __future__ import annotations

import numpy as np
import pytest

from treesvb import dataset, surrogate


def test_field_input_draws_each_block_with_its_area():
    aspect = 0.5  # W = 2 H
    blocks = np.array([[0.5, 1.0, 0.25, 0.75, 100.0], [0.0, 0.0, 0.0, 0.0, 0.0]])
    x = surrogate.field_input(aspect, blocks)
    assert x.shape == (len(surrogate.FIELD_INPUTS), dataset.FIELD_ROWS, dataset.FIELD_COLS)
    cover, drag = x[1], x[0]
    # The block covers a quarter of the width and half the height of the street.
    assert cover.mean() == pytest.approx(0.25 * 0.5)
    assert drag.max() == pytest.approx(np.log10(100.0) / 2.5)
    assert np.allclose(x[2], 0.25)
    assert x[3][0, 0] == pytest.approx(0.5 / dataset.FIELD_COLS)


def test_scores_of_a_perfect_and_a_doubled_prediction():
    t = np.array([1.0, 2.0, 4.0, 8.0])
    assert surrogate.scores(t, t) == {
        "n": 4,
        "r2": 1.0,
        "median_relative_error": 0.0,
        "fac2": 1.0,
    }
    s = surrogate.scores(t, 2.0001 * t)
    assert s["fac2"] == 0.0
    assert s["median_relative_error"] == pytest.approx(1.0001)


def test_noise_floor_is_the_median_half_difference():
    data = {
        "kind": np.array([1, 1, 2, 0]),
        "exposure": np.array(
            [
                [[1.0, 1.0], [1.0, 1.0]],
                [[1.0, 1.0], [3.0, 3.0]],
                [[2.0, 2.0], [2.0, 2.0]],
                [[9.0, 9.0], [1.0, 1.0]],  # bare street: left out
            ]
        ),
    }
    # Relative half differences 0, 0.5 and 0 on both pavements.
    assert surrogate.noise_floor(data, "exposure") == 0.0


def test_guard_accepts_training_points_and_refuses_far_ones():
    rng = np.random.default_rng(0)
    n = len(dataset.FEATURES)
    # Two tight clusters: the box spans both, but the middle is far from every sample.
    x = np.concatenate([0.1 + 0.02 * rng.random((150, n)), 0.9 + 0.02 * rng.random((150, n))])
    g = surrogate.guard(x)
    assert surrogate.inside(g, x).mean() >= surrogate.GUARD_QUANTILE - 0.01
    outside_box = x[:1].copy()
    outside_box[0, 0] = 2.0
    assert not surrogate.inside(g, outside_box)[0]
    middle = np.full((1, n), 0.5)
    assert not surrogate.inside(g, middle)[0]


def test_float16_weights_give_the_same_answers():
    pytest.importorskip("torch")
    pytest.importorskip("onnxruntime")
    import torch

    torch.manual_seed(0)
    model = surrogate.mlp(len(dataset.FEATURES), 4).eval()
    x = np.random.default_rng(1).random((7, len(dataset.FEATURES))).astype(np.float32)

    def export(path):
        surrogate.export(model, x[:2], path, "features", "outputs")
        return surrogate.run_onnx(path, x)

    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        y = export(Path(tmp) / "m.onnx")
        size = (Path(tmp) / "m.onnx").stat().st_size
    with torch.no_grad():
        ref = model(torch.tensor(x)).numpy()
    assert np.allclose(y, ref, rtol=1e-2, atol=1e-3)
    params = sum(p.numel() for p in model.parameters())
    assert size < 2.5 * params + 4096  # two bytes per weight, plus the graph
