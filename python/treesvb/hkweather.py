"""Weather presets for the heat model from Hong Kong Observatory daily data at King's Park.

    python -m treesvb.hkweather fetch     # data/hk_weather/
    python -m treesvb.hkweather check     # verify against data/hk_weather/SHA256SUMS
    python -m treesvb.hkweather measure   # results/weather/presets.json

Daily maximum, minimum and mean air temperature, mean relative humidity, global solar radiation
and mean wind speed at King's Park, Kowloon, the station closest to the Nathan Road and Yen Chow
Street presets that records all six. Source: Hong Kong Observatory via DATA.GOV.HK (terms in
docs/sources.md). Only days marked complete ("C") are used.

Two presets (BRIEF.md 6.5):

- very hot day: the day with the highest daily maximum temperature on record at King's Park
  with all six values complete;
- typical July day: the July day of 1991-2020 closest to that period's July means of all six
  values, each difference scaled by the standard deviation.

The hours of a day are rebuilt from these daily values in apps/web/src/sun/weather.ts
(docs/assumptions.md).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np

from . import results

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data" / "hk_weather"
SUMS = DATA / "SHA256SUMS"
GENERATED_BY = "python -m treesvb.hkweather measure"

_API = "https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?rformat=csv&station=KP"
_CIS = "https://data.weather.gov.hk/weatherAPI/cis/csvfile/KP/ALL"

#: element: (file name, URL, unit)
ELEMENTS = {
    "tmax_c": ("kp_tmax.csv", f"{_API}&dataType=CLMMAXT", "C"),
    "tmin_c": ("kp_tmin.csv", f"{_API}&dataType=CLMMINT", "C"),
    "tmean_c": ("kp_tmean.csv", f"{_API}&dataType=CLMTEMP", "C"),
    "rh_pct": ("kp_rh.csv", f"{_CIS}/daily_KP_RH_ALL.csv", "%"),
    "gsr_mj_m2": ("kp_gsr.csv", f"{_CIS}/daily_KP_GSR_ALL.csv", "MJ/m2"),
    "wind_kmh": ("kp_wind.csv", f"{_CIS}/daily_KP_WSPD_ALL.csv", "km/h"),
}
TYPICAL_PERIOD = (1991, 2020)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch() -> list[Path]:
    DATA.mkdir(parents=True, exist_ok=True)
    written = []
    for name, url, _ in ELEMENTS.values():
        req = urllib.request.Request(url, headers={"User-Agent": "treesvb"})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
        path = DATA / name
        path.write_bytes(body)
        written.append(path)
    SUMS.write_text("".join(f"{_sha256(p)}  {p.name}\n" for p in sorted(DATA.glob("*.csv"))))
    return written


def check() -> list[str]:
    problems = []
    for line in SUMS.read_text().splitlines():
        digest, name = line.split()
        p = DATA / name
        if not p.exists():
            problems.append(f"missing: {name}")
        elif _sha256(p) != digest:
            problems.append(f"checksum mismatch: {name}")
    return problems


def parse(text: str) -> dict[tuple[int, int, int], float]:
    """Complete daily values keyed by (year, month, day); other rows are skipped."""
    out = {}
    for row in csv.reader(io.StringIO(text.lstrip("﻿"))):
        if len(row) < 5 or not row[0].strip().isdigit():
            continue
        if row[4].strip() != "C":
            continue
        try:
            out[(int(row[0]), int(row[1]), int(row[2]))] = float(row[3])
        except ValueError:
            continue
    return out


def load() -> dict[str, dict[tuple[int, int, int], float]]:
    return {
        key: parse((DATA / name).read_text(encoding="utf-8-sig"))
        for key, (name, _, _) in ELEMENTS.items()
    }


def complete_days(series: dict[str, dict]) -> list[tuple[int, int, int]]:
    days = set.intersection(*(set(s) for s in series.values()))
    return sorted(days)


def _day(series: dict[str, dict], d: tuple[int, int, int]) -> dict:
    return {
        "date": f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}",
        **{k: series[k][d] for k in ELEMENTS},
    }


def hottest(series: dict[str, dict]) -> dict:
    days = complete_days(series)
    d = max(days, key=lambda x: (series["tmax_c"][x], x))
    return _day(series, d)


def typical_july(series: dict[str, dict]) -> tuple[dict, dict]:
    lo, hi = TYPICAL_PERIOD
    days = [d for d in complete_days(series) if d[1] == 7 and lo <= d[0] <= hi]
    values = np.array([[series[k][d] for k in ELEMENTS] for d in days])
    mean, sd = values.mean(axis=0), values.std(axis=0)
    dist = (((values - mean) / sd) ** 2).sum(axis=1)
    d = days[int(np.argmin(dist))]
    stats = {
        "days": len(days),
        "mean": {k: round(float(m), 3) for k, m in zip(ELEMENTS, mean, strict=True)},
        "sd": {k: round(float(s), 3) for k, s in zip(ELEMENTS, sd, strict=True)},
    }
    return _day(series, d), stats


def measure() -> dict:
    series = load()
    hot = hottest(series)
    typical, stats = typical_july(series)
    return {
        "name": "Weather presets for the heat model",
        "method": (
            "Hong Kong Observatory daily values at King's Park (complete days only): the day "
            "with the highest daily maximum temperature on record, and the July day of "
            f"{TYPICAL_PERIOD[0]}-{TYPICAL_PERIOD[1]} closest to that period's July means of "
            "all six elements, each difference scaled by its standard deviation"
        ),
        "station": "King's Park",
        "units": {k: unit for k, (_, _, unit) in ELEMENTS.items()},
        "sources": {k: url for k, (_, url, _) in ELEMENTS.items()},
        "attribution": "Hong Kong Observatory, Government of the Hong Kong SAR, via DATA.GOV.HK",
        "data_sha256": {p.name: _sha256(p) for p in sorted(DATA.glob("*.csv"))},
        "complete_days": len(complete_days(series)),
        "presets": [
            {"key": "very_hot", **hot},
            {"key": "typical_july", **typical, "july_statistics": stats},
        ],
        "passed": True,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.hkweather")
    p.add_argument("command", choices=["fetch", "check", "measure"])
    args = p.parse_args(argv)
    if args.command == "fetch":
        for path in fetch():
            print(f"wrote {path.relative_to(REPO)}")
        return 0
    if args.command == "check":
        problems = check()
        print("\n".join(problems) or "All weather extracts match their checksums.")
        return 1 if problems else 0
    payload = measure()
    print(json.dumps(payload["presets"], indent=1))
    print(f"wrote {results.write('weather/presets.json', payload, GENERATED_BY)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
