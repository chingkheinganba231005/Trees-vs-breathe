"""Weather presets from Hong Kong Observatory daily values."""

from __future__ import annotations

import pytest

from treesvb import hkweather

CSV = (
    '﻿"Maximum Temperature (C) - King\'s Park"\n'
    "Year,Month,Day,Value,data Completeness\n"
    "2017,8,21,35.0,C\n"
    "2017,8,22,36.9,C\n"
    "2017,8,23,***,\n"
    "2017,8,24,37.5,#\n"
    '"C data Complete"\n'
)


def test_parse_keeps_only_complete_days() -> None:
    v = hkweather.parse(CSV)
    assert v == {(2017, 8, 21): 35.0, (2017, 8, 22): 36.9}


def _series(rows: dict[tuple[int, int, int], tuple[float, ...]]) -> dict:
    return {k: {d: r[i] for d, r in rows.items()} for i, k in enumerate(hkweather.ELEMENTS)}


def test_presets_pick_the_hottest_and_the_most_typical_day() -> None:
    rows = {
        (2000, 7, 1): (31.0, 26.0, 28.5, 80.0, 18.0, 9.0),
        (2000, 7, 2): (33.0, 27.0, 30.0, 70.0, 25.0, 5.0),
        (2000, 7, 3): (29.0, 25.0, 27.0, 90.0, 10.0, 13.0),
        (2017, 8, 22): (36.9, 27.0, 31.0, 75.0, 18.3, 8.3),
    }
    s = _series(rows)
    assert hkweather.hottest(s)["date"] == "2017-08-22"
    typical, stats = hkweather.typical_july(s)
    assert typical["date"] == "2000-07-01"
    assert stats["days"] == 3


@pytest.mark.skipif(not hkweather.SUMS.exists(), reason="weather extracts not fetched")
def test_weather_extracts_match_their_checksums() -> None:
    assert hkweather.check() == []
