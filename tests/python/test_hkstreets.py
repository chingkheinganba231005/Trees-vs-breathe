"""Street presets: the ray measurement on synthetic streets, and the committed extracts."""

from __future__ import annotations

import numpy as np
import pytest

from treesvb import hkstreets as h


def block(x0: float, y0: float, x1: float, y1: float, base: float, top: float) -> dict:
    ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    return {
        "type": "Feature",
        "properties": {"BaseHeight": base, "TopHeight": top},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def collection(*features: dict) -> dict:
    return {"type": "FeatureCollection", "features": list(features)}


def test_straight_canyon_gives_its_width_and_height() -> None:
    # A street along y = 0, 12 m wall to wall: 30 m buildings north, 18 m south.
    buildings = collection(
        block(-100, 5, 100, 25, base=4.0, top=34.0),
        block(-100, -27, 100, -7, base=4.0, top=22.0),
    )
    path = np.array([[-50.0, 0.0], [50.0, 0.0]])
    s = h.summarise(h.profile([path], buildings))
    assert s["used"] == s["points"] == 20
    assert s["width_m"]["median"] == pytest.approx(12.0)
    assert s["height_m"]["median"] == pytest.approx(24.0)
    assert s["aspect_h_over_w"]["median"] == pytest.approx(2.0)
    assert s["bearing_deg"] == pytest.approx(90.0)


def test_tower_on_the_street_front_counts_not_its_podium() -> None:
    # A 12 m podium on the street line with a 60 m tower 2 m behind its front, and a tower
    # set back 10 m that does not count.
    buildings = collection(
        block(-100, 5, 100, 25, base=0.0, top=12.0),
        block(-100, 7, 100, 20, base=0.0, top=60.0),
        block(-100, -30, 100, -5, base=0.0, top=20.0),
        block(-100, -40, 100, -15, base=0.0, top=90.0),
    )
    s = h.summarise(h.profile([np.array([[-50.0, 0.0], [50.0, 0.0]])], buildings))
    assert s["height_left_m"]["median"] == pytest.approx(60.0)
    assert s["height_right_m"]["median"] == pytest.approx(20.0)


def test_openings_and_open_sides_are_left_out() -> None:
    # A side street cuts the north wall between x = -10 and 10; beyond it, nothing.
    buildings = collection(
        block(-100, 5, -10, 25, base=0.0, top=30.0),
        block(10, 5, 100, 25, base=0.0, top=30.0),
        block(-100, -25, 100, -5, base=0.0, top=30.0),
    )
    rows = h.profile([np.array([[-50.0, 0.0], [50.0, 0.0]])], buildings)
    s = h.summarise(rows)
    assert s["used"] == s["points"] - 4
    assert s["width_m"]["median"] == pytest.approx(10.0)


def test_stretch_around_a_station_is_clipped_along_the_street() -> None:
    street = h.Street("t", "T", "t", "t", station="S", half_length_m=50.0)
    line = {"features": [{"geometry": {"coordinates": [[[0.0, 0.0], [300.0, 0.0]]]}}]}
    [part] = h.stretch_paths(line, (120.0, 30.0), street)
    assert part[0] == pytest.approx([70.0, 0.0])
    assert part[-1] == pytest.approx([170.0, 0.0])


def test_centreline_pieces_are_joined_end_to_end() -> None:
    a = np.array([[0.0, 0.0], [10.0, 0.0]])
    b = np.array([[20.0, 0.0], [10.0, 0.0]])
    [joined] = h._chain([a, b])
    assert joined[0] == pytest.approx([0.0, 0.0]) and joined[-1] == pytest.approx([20.0, 0.0])


def test_committed_extracts_match_their_checksums() -> None:
    assert h.check() == []
