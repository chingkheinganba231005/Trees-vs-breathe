"""Typical roadside trees: the matching step and the committed extracts."""

from __future__ import annotations

import numpy as np
import pytest

from treesvb import hktrees


def test_local_tree_uses_the_middle_half_of_roadside_trunks() -> None:
    dbh = np.array([100.0, 200.0, 300.0, 400.0, 500.0])
    # Trunks in 200-400 mm are 8 m tall with 4 m crowns; the others would pull the answer away.
    afcd = [{"DBH_mm": d, "Height_m": 8.0, "Crown_Spread_m": 4.0} for d in range(200, 401, 5)]
    afcd += [{"DBH_mm": 900.0, "Height_m": 30.0, "Crown_Spread_m": 20.0}] * 50
    out = hktrees.local_tree(dbh, afcd)
    assert out["dbh_mm"]["p25"] == pytest.approx(200.0)
    assert out["dbh_mm"]["p75"] == pytest.approx(400.0)
    assert out["height_m"]["median"] == pytest.approx(8.0)
    assert out["crown_spread_m"]["median"] == pytest.approx(4.0)


def test_too_few_matches_give_no_estimate() -> None:
    one = [{"DBH_mm": 150.0, "Height_m": 5.0, "Crown_Spread_m": 3.0}]
    out = hktrees.local_tree(np.array([100.0, 200.0]), one)
    assert "height_m" not in out


def test_distance_to_a_polyline() -> None:
    path = np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]])
    pts = np.array([[5.0, 3.0], [13.0, 5.0], [-4.0, 0.0]])
    assert hktrees.distance_to_paths(pts, [path]) == pytest.approx([3.0, 3.0, 4.0])


def test_committed_extracts_match_their_checksums() -> None:
    assert hktrees.check() == []
