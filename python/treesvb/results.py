"""Writing results/*.json with provenance, so every number shown can be traced to a computation."""

from __future__ import annotations

import contextlib
import datetime as dt
import json
import platform
import subprocess
from importlib import metadata
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
RESULTS = REPO / "results"
SCHEMA = 1


def _git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(REPO), *args], capture_output=True, text=True, check=True
        ).stdout.strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return ""


def _code_state() -> tuple[str, bool]:
    return (
        _git("rev-parse", "HEAD") or "unknown",
        # Results computed from uncommitted code are flagged, so they can be regenerated.
        bool(_git("status", "--porcelain", "--", "python", "apps/web/src")),
    )


# The code a run used is the code at process start, not at the moment a long run finishes.
_START = _code_state()


def provenance(generated_by: str, packages: tuple[str, ...] = ("numpy", "jax")) -> dict[str, Any]:
    versions = {"python": platform.python_version()}
    for p in packages:
        with contextlib.suppress(metadata.PackageNotFoundError):
            versions[p] = metadata.version(p)
    return {
        "schema": SCHEMA,
        "generated_by": generated_by,
        "generated_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": _START[0],
        "dirty": _START[1],
        "platform": platform.platform(),
        "versions": versions,
    }


def write(relpath: str, payload: dict[str, Any], generated_by: str, root: Path = RESULTS) -> Path:
    path = root / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {**provenance(generated_by), **payload}
    path.write_text(json.dumps(doc, indent=2, allow_nan=False) + "\n")
    return path


def read(relpath: str, root: Path = RESULTS) -> dict[str, Any]:
    return json.loads((root / relpath).read_text())
