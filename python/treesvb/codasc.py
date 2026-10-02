"""CODASC wind-tunnel concentrations (Gromke and Ruck, KIT) for the phase 2 comparison.

    python -m treesvb.codasc fetch     # download into data/codasc/raw/ and verify checksums
    python -m treesvb.codasc check     # verify files already downloaded
    python -m treesvb.codasc record    # (re)write data/codasc/SHA256SUMS after a deliberate update

The CODASC terms allow scientific, non-commercial use with a citation but no modification of the
material, so the raw files are fetched rather than committed. The repository keeps the file list
and checksums in data/codasc/SHA256SUMS; the files land in data/codasc/raw/ (git-ignored).

Case set-up, from Gromke (2008, dissertation, KIT) and Gromke and Ruck (2012, Boundary-Layer
Meteorol. 144, 41-64); see docs/codasc.md for page references:
- two blocks of height H and depth H, street length 10 H, street width W = H or 2 H;
- four line sources at street level, at x/H = +-0.15 and +-0.267 from the street axis;
- concentrations measured 0.042 H in front of wall A (leeward wall of the upwind block for wind
  perpendicular to the street) and wall B (windward wall of the downwind block);
- c+ = c u_H H / Q_l, with u_H the approach-flow speed at roof height.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

BASE_URL = "https://www.umweltaerodynamik.de/bilder-originale/CODA/"
"""Where http://www.codasc.de redirects to (checked 2026-10-02)."""

CITATION = (
    "CODASC data base, Laboratory of Building- and Environmental Aerodynamics, IfH, "
    "Karlsruhe Institute of Technology"
)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "codasc"
RAW = DATA / "raw"
SUMS = DATA / "SHA256SUMS"

APPROACH_FLOW_PAGE = "approaching flow wind tunnel.htm"

_SEP = re.compile(r"[\s,]+")


@dataclass(frozen=True)
class Case:
    """One street-canyon configuration. Stand density 0 and crown lambda 0 mean no trees."""

    aspect: int  # W/H, 1 or 2
    angle: int  # wind direction against the street axis in degrees: 90, 45 or 0
    stand: float  # planting density rho_s: 0, 0.5 or 1
    lam: int  # crown pressure-loss coefficient in 1/m at model scale: 0, 80 or 200

    @property
    def stem(self) -> str:
        stand = f"{self.stand:.1f}".replace(".", ",")
        return f"{self.aspect}_{self.angle:02d}_{stand}_{self.lam:03d}"

    def filename(self, wall: str) -> str:
        return f"{self.stem}_{wall}.txt"

    @property
    def has_trees(self) -> bool:
        return self.lam > 0


def _cases() -> list[Case]:
    out = []
    for aspect in (1, 2):
        for angle in (90, 45, 0):
            out.append(Case(aspect, angle, 0.0, 0))
            for stand in (1.0, 0.5):
                for lam in (80, 200):
                    # Not measured: W/H 2, wind along the street, lambda 80 (CODASC table).
                    if aspect == 2 and angle == 0 and lam == 80:
                        continue
                    out.append(Case(aspect, angle, stand, lam))
    return out


CASES = _cases()
"""The 28 configurations in the CODASC data base table."""

PERPENDICULAR = [c for c in CASES if c.angle == 90]
"""The 10 cases with wind across the street, the only ones a 2D model can represent."""


def files() -> list[str]:
    """Every file fetched: the wall data of all cases and the approach-flow page."""
    names = [c.filename(w) for c in CASES for w in "AB"]
    return [*sorted(names), APPROACH_FLOW_PAGE]


def _url(name: str) -> str:
    folder = "" if name.endswith(".htm") else "conzdata_dat/"
    return BASE_URL + urllib.parse.quote(folder + name)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_sums(path: Path = SUMS) -> dict[str, str]:
    """File name -> SHA-256 from a sha256sum-style file (two spaces between hash and name)."""
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            digest, name = line.split("  ", 1)
            out[name] = digest
    return out


def write_sums(sums: dict[str, str], path: Path = SUMS) -> None:
    header = [
        f"# SHA-256 of the CODASC files fetched by python -m treesvb.codasc, from {BASE_URL}",
        f"# Terms: scientific non-commercial use; cite: {CITATION}. Files are not committed.",
    ]
    body = [f"{sums[n]}  {n}" for n in sorted(sums)]
    path.write_text("\n".join(header + body) + "\n", encoding="utf-8")


def fetch(force: bool = False) -> list[str]:
    """Download missing files and verify them. Returns the names of files that do not match."""
    RAW.mkdir(parents=True, exist_ok=True)
    expected = read_sums() if SUMS.exists() else {}
    bad = []
    for name in files():
        target = RAW / name
        if force or not target.exists():
            with urllib.request.urlopen(_url(name), timeout=60) as r:
                target.write_bytes(r.read())
        digest = _sha256(target.read_bytes())
        if name in expected and expected[name] != digest:
            bad.append(name)
    return bad


def check() -> list[str]:
    """Names of files that are missing or do not match SHA256SUMS."""
    expected = read_sums()
    return [
        n
        for n, d in expected.items()
        if not (RAW / n).exists() or _sha256((RAW / n).read_bytes()) != d
    ]


def record() -> None:
    write_sums({n: _sha256((RAW / n).read_bytes()) for n in files()})


@dataclass(frozen=True)
class WallData:
    """c+ on one wall: c[k, j] at height z[k] / H and along-street position y[j] / H."""

    y: np.ndarray
    z: np.ndarray
    c: np.ndarray

    def centre(self) -> np.ndarray:
        """c+ against height at the street centre, y = 0.

        The files hold a 100 x 7 grid with y = 0 midway between two columns, so the profile is
        their mean.
        """
        j = int(np.searchsorted(self.y, 0.0))
        return 0.5 * (self.c[:, j - 1] + self.c[:, j])


def parse(text: str) -> WallData:
    """Parse a CODASC wall file: a header line, then y/H, z/H, c+.

    Most files separate the columns with tabs; some use spaces or commas.
    """
    lines = text.strip().splitlines()
    head = [h.strip('"') for h in _SEP.split(lines[0].strip())]
    if head != ["y/H", "z/H", "c+"]:
        raise ValueError(f"unexpected CODASC header {head}")
    rows = np.array([[float(v) for v in _SEP.split(ln.strip())] for ln in lines[1:]])
    y = np.unique(rows[:, 0])
    z = np.unique(rows[:, 1])
    c = np.full((z.size, y.size), np.nan)
    c[np.searchsorted(z, rows[:, 1]), np.searchsorted(y, rows[:, 0])] = rows[:, 2]
    if np.isnan(c).any():
        raise ValueError("CODASC file is not a full grid")
    return WallData(y, z, c)


def load(case: Case, wall: str, raw: Path = RAW) -> WallData:
    return parse((raw / case.filename(wall)).read_text(encoding="latin-1"))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.codasc", description=__doc__.split("\n")[0])
    p.add_argument("command", choices=["fetch", "check", "record"])
    p.add_argument("--force", action="store_true", help="download again even if present")
    args = p.parse_args(argv)
    if args.command == "record":
        record()
        print(f"wrote {SUMS.relative_to(ROOT)}")
        return 0
    bad = fetch(args.force) if args.command == "fetch" else check()
    for name in bad:
        print(f"MISMATCH or missing: {name}", file=sys.stderr)
    if not bad:
        print(f"{len(files())} CODASC files in {RAW.relative_to(ROOT)} match SHA256SUMS")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
