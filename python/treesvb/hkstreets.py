"""Hong Kong street presets: street width and building height measured from government open data.

Sources, all on the CSDI Portal of the Hong Kong Government (terms in docs/sources.md):

- Building (Lands Department, dataset landsd_rcd_1637211194312_35158): footprints of every
  building block with its base and top level in metres above Principal Datum.
- Road Centreline (Lands Department, landsd_rcd_1637310758814_80061).
- Air Quality Monitoring Network of Hong Kong (Environmental Protection Department,
  epd_rcd_1629267205214_40635): station positions, used to centre the measured stretches.

    python -m treesvb.hkstreets fetch     # download extracts into data/hk_streets/
    python -m treesvb.hkstreets check     # verify them against data/hk_streets/SHA256SUMS
    python -m treesvb.hkstreets measure   # results/streets/presets.json

Method. Points are taken along the stretch's centreline every SAMPLE_M metres. From each, a ray
goes out at right angles to the street on both sides; the first building outline it crosses is
the street wall on that side. W is the distance between the two walls; H is the mean, over the two
sides, of the tallest building whose outline the ray meets within FRONT_TOLERANCE_M of that wall
(height: top level minus base level). A point is left out when a side has no building
within MAX_RAY_M, or when a wall is much further away than is typical for the stretch (an opening:
a junction, a lane, a set-back plaza). The preset takes the median over the remaining points.
All coordinates are in the Hong Kong 1980 Grid (EPSG:2326), in metres.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import results

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data" / "hk_streets"
SUMS = DATA / "SHA256SUMS"
GENERATED_BY = "python -m treesvb.hkstreets measure"

SERVICE = "https://portal.csdi.gov.hk/server/rest/services/common/{}/FeatureServer/0/query"
BUILDING_ID = "landsd_rcd_1637211194312_35158"
CENTRELINE_ID = "landsd_rcd_1637310758814_80061"
STATIONS_ID = "epd_rcd_1629267205214_40635"
HK1980 = 2326

#: Spacing of the measuring points along the centreline, m.
SAMPLE_M = 5.0
#: How far a ray looks for a street wall, m.
MAX_RAY_M = 60.0
#: A wall closer than this to the centreline means the point sits under or inside a structure.
MIN_WALL_M = 1.5
#: Outlines this close behind the first one belong to the same street front. The data split many
#: buildings into a podium and a tower block whose street-side outlines nearly coincide, and the
#: stated position accuracy is 0.015 m to 1.5 m (dataset metadata), so twice the worst case.
FRONT_TOLERANCE_M = 3.0
#: A side further than this many times its median distance is an opening, not a street wall.
OPENING_FACTOR = 1.6
#: Margin around a stretch when fetching buildings, m.
FETCH_MARGIN_M = MAX_RAY_M + 10.0


@dataclass(frozen=True)
class Street:
    key: str
    #: Name as written in the Road Centreline data.
    name: str
    label_en: str
    label_tc: str
    #: Monitoring station the stretch is centred on, or None for the whole street.
    station: str | None = None
    #: Half the stretch length along the street, m, when centred on a station.
    half_length_m: float | None = None


# The three streets chosen by the user on 2026-10-03 (docs/progress.md, Q-004).
STREETS = (
    Street("wing_lok", "WING LOK STREET", "Wing Lok Street, Sheung Wan", "上環永樂街"),
    Street(
        "nathan_mong_kok",
        "NATHAN ROAD",
        "Nathan Road, Mong Kok",
        "旺角彌敦道",
        station="Mong Kok Air Quality Monitoring Station",
        half_length_m=150.0,
    ),
    Street(
        "yen_chow",
        "YEN CHOW STREET",
        "Yen Chow Street, Sham Shui Po",
        "深水埗欽州街",
        station="Sham Shui Po Air Quality Monitoring Station",
        half_length_m=150.0,
    ),
)


# Fetching ------------------------------------------------------------------------------------


def _query(dataset: str, params: dict[str, str]) -> dict:
    """One page of an ArcGIS FeatureServer query, as Esri JSON in the Hong Kong 1980 Grid."""
    q = {"outSR": str(HK1980), "f": "json", "outFields": "*", **params}
    url = SERVICE.format(dataset) + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": "trees-vs-breath (research)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        doc = json.load(r)
    if "error" in doc:
        raise RuntimeError(f"{dataset}: {doc['error']}")
    return doc


def _query_all(dataset: str, params: dict[str, str]) -> list[dict]:
    """Every feature of a query, following the service's page limit."""
    features: list[dict] = []
    while True:
        doc = _query(dataset, {**params, "resultOffset": str(len(features))})
        features += doc.get("features", [])
        if not doc.get("exceededTransferLimit"):
            return features


def _to_geojson(features: list[dict]) -> dict:
    """Esri JSON features to a GeoJSON collection, keeping the Hong Kong 1980 Grid coordinates."""
    out = []
    for f in features:
        g = f.get("geometry") or {}
        if "rings" in g:
            geom = {"type": "Polygon", "coordinates": g["rings"]}
        elif "paths" in g:
            geom = {"type": "MultiLineString", "coordinates": g["paths"]}
        elif "x" in g:
            geom = {"type": "Point", "coordinates": [g["x"], g["y"]]}
        else:
            continue
        out.append({"type": "Feature", "properties": f["attributes"], "geometry": geom})
    return {
        "type": "FeatureCollection",
        # Not WGS84 as plain GeoJSON assumes: metres in the Hong Kong 1980 Grid.
        "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{HK1980}"}},
        "features": out,
    }


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, sort_keys=True) + "\n")


def fetch() -> list[Path]:
    """Download the stations, the centrelines and the buildings around each stretch."""
    written = []
    stations = _query_all(STATIONS_ID, {"where": "1=1"})
    path = DATA / "stations.geojson"
    _write(path, _to_geojson(stations))
    written.append(path)
    station_xy = {
        s["attributes"]["NAME_EN"]: (s["geometry"]["x"], s["geometry"]["y"]) for s in stations
    }
    for st in STREETS:
        lines = _query_all(CENTRELINE_ID, {"where": f"ENGLISHSTREETNAME = '{st.name}'"})
        path = DATA / f"{st.key}_centreline.geojson"
        _write(path, _to_geojson(lines))
        written.append(path)
        paths = stretch_paths(_to_geojson(lines), station_xy.get(st.station or ""), st)
        pts = np.concatenate(paths)
        lo, hi = pts.min(axis=0) - FETCH_MARGIN_M, pts.max(axis=0) + FETCH_MARGIN_M
        envelope = ",".join(f"{v:.1f}" for v in (*lo, *hi))
        buildings = _query_all(
            BUILDING_ID,
            {
                "where": "1=1",
                "geometry": envelope,
                "geometryType": "esriGeometryEnvelope",
                "inSR": str(HK1980),
                "spatialRel": "esriSpatialRelIntersects",
            },
        )
        path = DATA / f"{st.key}_buildings.geojson"
        _write(path, _to_geojson(buildings))
        written.append(path)
    SUMS.write_text("".join(f"{_sha256(p)}  {p.name}\n" for p in sorted(DATA.glob("*.geojson"))))
    return written


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check() -> list[str]:
    """Problems with the committed extracts; empty when every checksum matches."""
    problems = []
    for line in SUMS.read_text().splitlines():
        digest, name = line.split()
        p = DATA / name
        if not p.exists():
            problems.append(f"missing: {name}")
        elif _sha256(p) != digest:
            problems.append(f"checksum mismatch: {name}")
    return problems


# Geometry ------------------------------------------------------------------------------------


def _chain(paths: list[np.ndarray]) -> list[np.ndarray]:
    """Join centreline pieces that meet end to start into longer polylines."""
    pieces = [p.copy() for p in paths]
    joined = True
    while joined:
        joined = False
        for i in range(len(pieces)):
            for j in range(len(pieces)):
                if i == j:
                    continue
                a, b = pieces[i], pieces[j]
                if np.linalg.norm(a[-1] - b[0]) < 0.5:
                    pieces[i] = np.vstack([a, b[1:]])
                elif np.linalg.norm(a[-1] - b[-1]) < 0.5:
                    pieces[i] = np.vstack([a, b[::-1][1:]])
                else:
                    continue
                del pieces[j]
                joined = True
                break
            if joined:
                break
    return pieces


def _clip_near(path: np.ndarray, centre: np.ndarray, half_length: float) -> np.ndarray | None:
    """The part of a polyline within half_length (measured along it) of its point nearest centre."""
    seg = np.diff(path, axis=0)
    lengths = np.linalg.norm(seg, axis=1)
    s = np.concatenate([[0.0], np.cumsum(lengths)])
    # Nearest point on the polyline to the centre, as a distance along it.
    best, best_s = np.inf, 0.0
    for k, (a, d, ln) in enumerate(zip(path[:-1], seg, lengths, strict=True)):
        if ln == 0:
            continue
        t = float(np.clip(np.dot(centre - a, d) / ln**2, 0.0, 1.0))
        dist = float(np.linalg.norm(a + t * d - centre))
        if dist < best:
            best, best_s = dist, s[k] + t * ln
    if best > 100.0:
        return None
    return _between(path, s, best_s - half_length, best_s + half_length)


def _between(path: np.ndarray, s: np.ndarray, s0: float, s1: float) -> np.ndarray:
    """The polyline between distances s0 and s1 along it."""
    s0, s1 = max(s0, 0.0), min(s1, s[-1])
    xs = np.concatenate([[s0], s[(s > s0) & (s < s1)], [s1]])
    return np.column_stack([np.interp(xs, s, path[:, 0]), np.interp(xs, s, path[:, 1])])


def stretch_paths(
    centreline: dict, station: tuple[float, float] | None, street: Street
) -> list[np.ndarray]:
    """Centreline polylines of the stretch: the whole street, or the part around its station."""
    raw = [
        np.asarray(line, dtype=float)
        for f in centreline["features"]
        for line in f["geometry"]["coordinates"]
    ]
    paths = _chain(raw)
    if street.station is None:
        return paths
    if station is None or street.half_length_m is None:
        raise ValueError(f"{street.key}: station {street.station!r} not found")
    clipped = [_clip_near(p, np.asarray(station), street.half_length_m) for p in paths]
    return [c for c in clipped if c is not None and len(c) >= 2]


def building_edges(buildings: dict) -> tuple[np.ndarray, np.ndarray]:
    """Every edge of every building outline, (E, 4) as x1 y1 x2 y2, and the height of its building.

    Height is the top level minus the base level. Blocks without both levels are left out.
    """
    edges, heights = [], []
    for f in buildings["features"]:
        p = f["properties"]
        top, base = p.get("TopHeight"), p.get("BaseHeight")
        if top is None or base is None or top <= base:
            continue
        for ring in f["geometry"]["coordinates"]:
            r = np.asarray(ring, dtype=float)
            e = np.column_stack([r[:-1], r[1:]])
            edges.append(e)
            heights.append(np.full(len(e), top - base))
    if not edges:
        return np.zeros((0, 4)), np.zeros(0)
    return np.concatenate(edges), np.concatenate(heights)


def first_hit(
    origin: np.ndarray, direction: np.ndarray, edges: np.ndarray, heights: np.ndarray
) -> tuple[float, float] | None:
    """Distance to the first building edge along a ray, and the height of the street front there.

    The height is that of the tallest block whose outline the ray meets within FRONT_TOLERANCE_M
    of the first one, so a tower standing on the street line counts, not only its podium.
    """
    a, b = edges[:, :2], edges[:, 2:]
    e = b - a
    denom = direction[0] * e[:, 1] - direction[1] * e[:, 0]
    w = a - origin
    with np.errstate(divide="ignore", invalid="ignore"):
        t = (w[:, 0] * e[:, 1] - w[:, 1] * e[:, 0]) / denom
        u = (w[:, 0] * direction[1] - w[:, 1] * direction[0]) / denom
    ok = (np.abs(denom) > 1e-12) & (t > 0) & (t <= MAX_RAY_M) & (u >= 0) & (u <= 1)
    if not ok.any():
        return None
    t0 = float(t[ok].min())
    front = ok & (t <= t0 + FRONT_TOLERANCE_M)
    return t0, float(heights[front].max())


def sample_points(path: np.ndarray, spacing: float) -> tuple[np.ndarray, np.ndarray]:
    """Points every `spacing` metres along a polyline, with the unit tangent at each."""
    seg = np.diff(path, axis=0)
    lengths = np.linalg.norm(seg, axis=1)
    keep = lengths > 0
    seg, lengths, starts = seg[keep], lengths[keep], path[:-1][keep]
    s = np.concatenate([[0.0], np.cumsum(lengths)])
    pos = np.arange(spacing / 2, s[-1], spacing)
    k = np.clip(np.searchsorted(s, pos, side="right") - 1, 0, len(seg) - 1)
    tangent = seg[k] / lengths[k, None]
    points = starts[k] + tangent * (pos - s[k])[:, None]
    return points, tangent


def profile(paths: Sequence[np.ndarray], buildings: dict) -> list[dict]:
    """Street wall distance and building height on both sides at every measuring point."""
    edges, heights = building_edges(buildings)
    rows = []
    for path in paths:
        points, tangents = sample_points(path, SAMPLE_M)
        for p, t in zip(points, tangents, strict=True):
            left = np.array([-t[1], t[0]])
            hits = [first_hit(p, d, edges, heights) for d in (left, -left)]
            rows.append(
                {
                    "x": round(float(p[0]), 2),
                    "y": round(float(p[1]), 2),
                    "bearing_deg": round(float(np.degrees(np.arctan2(t[0], t[1])) % 180.0), 1),
                    "left": None if hits[0] is None else [round(v, 2) for v in hits[0]],
                    "right": None if hits[1] is None else [round(v, 2) for v in hits[1]],
                }
            )
    return rows


def summarise(rows: list[dict]) -> dict:
    """Median street width, building height and H/W over the points that see two street walls."""
    both = [
        r
        for r in rows
        if r["left"] and r["right"] and min(r["left"][0], r["right"][0]) >= MIN_WALL_M
    ]
    if not both:
        return {"points": len(rows), "used": 0}
    dl = np.median([r["left"][0] for r in both])
    dr = np.median([r["right"][0] for r in both])
    used = [
        r
        for r in both
        if r["left"][0] <= OPENING_FACTOR * dl and r["right"][0] <= OPENING_FACTOR * dr
    ]
    w = np.array([r["left"][0] + r["right"][0] for r in used])
    h = np.array([(r["left"][1] + r["right"][1]) / 2 for r in used])
    hl = np.array([r["left"][1] for r in used])
    hr = np.array([r["right"][1] for r in used])
    ratio = h / w

    def q(v: np.ndarray) -> dict[str, float]:
        p25, p50, p75 = np.percentile(v, [25, 50, 75])
        return {k: round(float(v), 2) for k, v in (("median", p50), ("p25", p25), ("p75", p75))}

    # Bearing of the street axis, 0-180 degrees clockwise from grid north, as a circular mean of
    # the doubled angle so that 179 and 1 average to 0, not 90.
    b = np.radians([2 * r["bearing_deg"] for r in used])
    bearing = (np.degrees(np.arctan2(np.sin(b).mean(), np.cos(b).mean())) / 2) % 180.0
    return {
        "points": len(rows),
        "used": len(used),
        "width_m": q(w),
        "height_m": q(h),
        "height_left_m": q(hl),
        "height_right_m": q(hr),
        "aspect_h_over_w": q(ratio),
        "bearing_deg": round(float(bearing), 1),
    }


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text())


def measure() -> dict:
    """Measure every stretch from the committed extracts."""
    stations = _load("stations.geojson")
    station_xy = {
        f["properties"]["NAME_EN"]: tuple(f["geometry"]["coordinates"])
        for f in stations["features"]
    }
    rows = []
    for st in STREETS:
        centreline = _load(f"{st.key}_centreline.geojson")
        paths = stretch_paths(centreline, station_xy.get(st.station or ""), st)
        prof = profile(paths, _load(f"{st.key}_buildings.geojson"))
        summary = summarise(prof)
        rows.append(
            {
                "key": st.key,
                "label_en": st.label_en,
                "label_tc": st.label_tc,
                "street_name": st.name,
                "centred_on": st.station,
                "stretch_length_m": round(float(sum(_length(p) for p in paths)), 1),
                **summary,
                "profile": prof,
            }
        )
        print(f"{st.key}: {json.dumps({k: v for k, v in summary.items()})}", flush=True)
    return {
        "name": "Hong Kong street presets measured from Lands Department data",
        "method": (
            f"Points every {SAMPLE_M:g} m along the Lands Department road centreline; rays at "
            f"right angles to the street up to {MAX_RAY_M:g} m find the first building outline on "
            "each side (Lands Department Building data). W: distance between the two walls; H: "
            "mean over the two sides of the tallest block (top level minus base level) whose "
            "outline lies "
            f"within {FRONT_TOLERANCE_M:g} m of the wall. Points with a side open to "
            f"{MAX_RAY_M:g} m, a wall nearer than {MIN_WALL_M:g} m, or a wall more than "
            f"{OPENING_FACTOR:g} times the stretch's median distance are left out; medians over "
            "the rest"
        ),
        "sources": [
            "Lands Department, Building, CSDI Portal dataset " + BUILDING_ID,
            "Lands Department, Road Centreline, CSDI Portal dataset " + CENTRELINE_ID,
            "Environmental Protection Department, Air Quality Monitoring Network of Hong Kong, "
            "CSDI Portal dataset " + STATIONS_ID,
        ],
        "data_sha256": {p.name: _sha256(p) for p in sorted(DATA.glob("*.geojson"))},
        "rows": rows,
        "passed": all(r.get("used", 0) >= 10 for r in rows),
    }


def _length(path: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.hkstreets")
    p.add_argument("command", choices=["fetch", "check", "measure"])
    args = p.parse_args(argv)
    if args.command == "fetch":
        for path in fetch():
            print(f"wrote {path.relative_to(REPO)}")
        return 0
    if args.command == "check":
        problems = check()
        print("\n".join(problems) or "All street extracts match their checksums.")
        return 1 if problems else 0
    payload = measure()
    path = results.write("streets/presets.json", payload, GENERATED_BY)
    print(f"wrote {path}")
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
