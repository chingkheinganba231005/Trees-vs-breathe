"""Typical roadside tree near each street preset, from Hong Kong Government tree records.

Sources, on the CSDI Portal of the Hong Kong Government (terms in docs/sources.md):

- Tree (HyD) (Highways Department, dataset hyd_rcd_1632210213867_60179): roadside trees with
  trunk diameter at breast height (DBH), no height or crown spread.
- Information on trees in major recreational sites of Country Parks (Agriculture, Fisheries and
  Conservation Department, afcd_rcd_1728897424022_55263): trees with measured height, DBH and
  crown spread.

    python -m treesvb.hktrees fetch     # data/hk_trees/
    python -m treesvb.hktrees check     # verify against data/hk_trees/SHA256SUMS
    python -m treesvb.hktrees measure   # results/streets/trees.json

Method. The Highways Department trees within LOCAL_RADIUS_M of a stretch give the trunk sizes
of roadside trees in that part of town; the middle half of their DBH is the local range. The
AFCD trees whose DBH falls in that range give height and crown spread. Country-park trees grow
in more open ground than street trees, so this is an estimate of a tree of local roadside trunk
size, not a measurement of the street's own trees (docs/assumptions.md A-014). Trees within
ON_STREET_M of the stretch's centreline are counted as the street's own.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import sys
from pathlib import Path

import numpy as np

from . import hkstreets, results

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data" / "hk_trees"
SUMS = DATA / "SHA256SUMS"
GENERATED_BY = "python -m treesvb.hktrees measure"

HYD_ID = "hyd_rcd_1632210213867_60179"
AFCD_ID = "afcd_rcd_1728897424022_55263"

#: Radius around a stretch's centre for the local roadside trees, m.
LOCAL_RADIUS_M = 1000.0
#: A tree this close to the centreline stands in the street itself, m.
ON_STREET_M = 25.0
#: Fewest matched AFCD trees for an estimate.
MIN_MATCHED = 30


def _station_xy() -> dict[str, tuple[float, float]]:
    stations = hkstreets._load("stations.geojson")
    return {
        f["properties"]["NAME_EN"]: tuple(f["geometry"]["coordinates"])
        for f in stations["features"]
    }


def _stretch(st: hkstreets.Street) -> list[np.ndarray]:
    centreline = hkstreets._load(f"{st.key}_centreline.geojson")
    return hkstreets.stretch_paths(centreline, _station_xy().get(st.station or ""), st)


def _centre(paths: list[np.ndarray]) -> np.ndarray:
    pts = np.concatenate(paths)
    return 0.5 * (pts.min(axis=0) + pts.max(axis=0))


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, sort_keys=True) + "\n")


def _extracts() -> list[Path]:
    return sorted([*DATA.glob("*.json"), *DATA.glob("*.geojson")])


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch() -> list[Path]:
    written = []
    afcd = hkstreets._query_all(
        AFCD_ID,
        {
            "where": "Height_m IS NOT NULL AND DBH_mm IS NOT NULL AND Crown_Spread_m IS NOT NULL",
            "outFields": "Tree_Species,Height_m,DBH_mm,Crown_Spread_m",
            "returnGeometry": "false",
        },
    )
    path = DATA / "afcd_trees.json"
    _write(path, {"features": [f["attributes"] for f in afcd]})
    written.append(path)
    for st in hkstreets.STREETS:
        cx, cy = _centre(_stretch(st))
        r = LOCAL_RADIUS_M
        hyd = hkstreets._query_all(
            HYD_ID,
            {
                "where": "1=1",
                "geometry": f"{cx - r:.1f},{cy - r:.1f},{cx + r:.1f},{cy + r:.1f}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": str(hkstreets.HK1980),
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "TREE_ID,DBH,SPECIES_NAME,ROAD_NAME,LU_HMD",
            },
        )
        path = DATA / f"{st.key}_hyd_trees.geojson"
        _write(path, hkstreets._to_geojson(hyd))
        written.append(path)
    SUMS.write_text("".join(f"{_sha256(p)}  {p.name}\n" for p in _extracts()))
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


def _spread(v: np.ndarray) -> dict[str, float]:
    p25, p50, p75 = np.percentile(v, [25, 50, 75])
    return {k: round(float(x), 2) for k, x in (("median", p50), ("p25", p25), ("p75", p75))}


def distance_to_paths(points: np.ndarray, paths: list[np.ndarray]) -> np.ndarray:
    """Shortest distance from each point to any of the polylines."""
    best = np.full(len(points), np.inf)
    for path in paths:
        for a, b in itertools.pairwise(path):
            d = b - a
            ln2 = float(d @ d)
            if ln2 == 0:
                continue
            t = np.clip(((points - a) @ d) / ln2, 0.0, 1.0)
            best = np.minimum(best, np.linalg.norm(points - (a + t[:, None] * d), axis=1))
    return best


def local_tree(dbh_mm: np.ndarray, afcd: list[dict]) -> dict:
    """Height and crown spread of AFCD trees whose DBH lies in the middle half of `dbh_mm`."""
    lo, hi = np.percentile(dbh_mm, [25, 75])
    match = [t for t in afcd if lo <= t["DBH_mm"] <= hi]
    out = {"dbh_mm": _spread(dbh_mm), "roadside_trees": len(dbh_mm), "matched": len(match)}
    if len(match) >= MIN_MATCHED:
        out["height_m"] = _spread(np.array([t["Height_m"] for t in match], dtype=float))
        out["crown_spread_m"] = _spread(np.array([t["Crown_Spread_m"] for t in match], dtype=float))
    return out


def measure() -> dict:
    afcd = [
        t
        for t in json.loads((DATA / "afcd_trees.json").read_text())["features"]
        if t["Height_m"] > 0 and t["DBH_mm"] > 0 and t["Crown_Spread_m"] > 0
    ]
    rows = []
    for st in hkstreets.STREETS:
        paths = _stretch(st)
        hyd = json.loads((DATA / f"{st.key}_hyd_trees.geojson").read_text())["features"]
        xy = np.array([f["geometry"]["coordinates"] for f in hyd], dtype=float).reshape(-1, 2)
        dbh = np.array([f["properties"]["DBH"] or 0 for f in hyd], dtype=float)
        centre = _centre(paths)
        near = (np.linalg.norm(xy - centre, axis=1) <= LOCAL_RADIUS_M) & (dbh > 0)
        on_street = near & (distance_to_paths(xy, paths) <= ON_STREET_M) if len(xy) else near
        row = {
            "key": st.key,
            "trees_on_stretch": int(on_street.sum()),
            **local_tree(dbh[near], afcd),
        }
        rows.append(row)
        print(f"{st.key}: {json.dumps(row)}", flush=True)
    return {
        "name": "Typical roadside tree near each street preset",
        "method": (
            f"Highways Department trees within {LOCAL_RADIUS_M:g} m of each stretch: middle half "
            "of trunk diameter (DBH). AFCD country-park trees with DBH in that range: median and "
            f"middle half of measured height and crown spread. Trees within {ON_STREET_M:g} m of "
            "the stretch centreline counted as on the stretch. An estimate, not a measurement of "
            "the street's own trees (A-014)"
        ),
        "sources": [
            "Highways Department, Tree (HyD), CSDI Portal dataset " + HYD_ID,
            "Agriculture, Fisheries and Conservation Department, Information on trees in major "
            "recreational sites of Country Parks, CSDI Portal dataset " + AFCD_ID,
        ],
        "afcd_trees": len(afcd),
        "data_sha256": {p.name: _sha256(p) for p in _extracts()},
        "rows": rows,
        "passed": all("height_m" in r for r in rows),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.hktrees")
    p.add_argument("command", choices=["fetch", "check", "measure"])
    args = p.parse_args(argv)
    if args.command == "fetch":
        for path in fetch():
            print(f"wrote {path.relative_to(REPO)}")
        return 0
    if args.command == "check":
        problems = check()
        print("\n".join(problems) or "All tree extracts match their checksums.")
        return 1 if problems else 0
    payload = measure()
    print(f"wrote {results.write('streets/trees.json', payload, GENERATED_BY)}")
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
