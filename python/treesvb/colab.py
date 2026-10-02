"""Plumbing shared by the Colab notebooks: runtime checks, run folders, manifests, checksums.

Every notebook follows BRIEF.md section 10: check for an A100, write outputs to a timestamped
folder on Google Drive, record a manifest with the git commit, parameters, seeds, versions, GPU,
wall time and the SHA-256 of every output, and finish by printing which files go where in the
repo. In smoke mode (TVB_SMOKE=1, used by CI) the same code runs on CPU with a local folder.

When the user brings files back, `python -m treesvb.colab verify <manifest>` checks them.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import Any

DRIVE_RUNS = Path("/content/drive/MyDrive/trees-vs-breath/runs")
MANIFEST_NAME = "manifest.json"
MANIFEST_SCHEMA = 1


def is_smoke() -> bool:
    return os.environ.get("TVB_SMOKE") == "1"


def utc_stamp(now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now(dt.UTC)
    return now.strftime("%Y%m%dT%H%M%SZ")


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def query_gpus() -> list[dict[str, str]]:
    """GPUs reported by nvidia-smi; empty when there is no NVIDIA driver."""
    fields = ["name", "memory.total", "driver_version"]
    try:
        out = subprocess.run(
            ["nvidia-smi", f"--query-gpu={','.join(fields)}", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    if out.returncode != 0:
        return []
    gpus = []
    for line in out.stdout.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == len(fields):
            gpus.append(dict(zip(fields, parts, strict=True)))
    return gpus


def package_versions(packages: Iterable[str]) -> dict[str, str]:
    versions = {"python": platform.python_version()}
    for name in packages:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = "not installed"
    return versions


def check_runtime(
    *, smoke: bool, packages: Iterable[str] = ("numpy",), gpus: list[dict[str, str]] | None = None
) -> dict[str, Any]:
    """Fail early, before any long job starts, unless the runtime has an A100 (or this is smoke)."""
    gpus = query_gpus() if gpus is None else gpus
    if not smoke and not any("A100" in g["name"] for g in gpus):
        found = ", ".join(g["name"] for g in gpus) or "no GPU"
        raise RuntimeError(
            f"This notebook needs an NVIDIA A100, but the runtime has {found}. "
            "In Colab choose Runtime > Change runtime type > A100 GPU, then run all cells again."
        )
    return {
        "smoke": smoke,
        "gpus": gpus,
        "platform": platform.platform(),
        "versions": package_versions(packages),
    }


def runs_root(smoke: bool) -> Path:
    if smoke:
        return Path(os.environ.get("TVB_RUNS_ROOT", "runs")).resolve()
    return DRIVE_RUNS


@dataclass(frozen=True)
class RunDir:
    notebook: str
    stamp: str
    path: Path

    @classmethod
    def create(
        cls, notebook: str, *, smoke: bool, root: Path | None = None, stamp: str | None = None
    ) -> RunDir:
        stamp = stamp or utc_stamp()
        path = (root or runs_root(smoke)) / notebook / stamp
        path.mkdir(parents=True, exist_ok=False)
        return cls(notebook, stamp, path)


def git_state(repo: Path) -> dict[str, Any]:
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
        ).stdout.strip()

    try:
        return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain"))}
    except (FileNotFoundError, subprocess.CalledProcessError):
        return {"commit": "unknown", "dirty": None}


def write_manifest(
    run: RunDir,
    *,
    repo: Path,
    parameters: Mapping[str, Any],
    seeds: Mapping[str, int],
    runtime: Mapping[str, Any],
    started: float,
    outputs: Mapping[str, str | None],
    manifest_dest: str | None = None,
) -> dict[str, Any]:
    """Hash every output and write manifest.json into the run folder.

    `outputs` maps a path inside the run folder to its destination in the repo, or to None
    for files that stay on Drive (datasets).
    """
    files = []
    for rel, dest in outputs.items():
        p = run.path / rel
        if not p.is_file():
            raise FileNotFoundError(f"Declared output {rel} was not written to {run.path}")
        files.append(
            {"path": rel, "bytes": p.stat().st_size, "sha256": sha256_file(p), "repo_path": dest}
        )
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "notebook": run.notebook,
        "run": run.stamp,
        "git": git_state(repo),
        "parameters": dict(parameters),
        "seeds": dict(seeds),
        "runtime": dict(runtime),
        "wall_time_s": round(time.time() - started, 3),
        "manifest_repo_path": manifest_dest,
        "outputs": files,
    }
    (run.path / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def download_instructions(run: RunDir, manifest: Mapping[str, Any]) -> str:
    """The text the last cell prints: what to download and where it goes in the repo."""
    try:
        shown = run.path.relative_to(DRIVE_RUNS.parent.parent)
        where = f"Google Drive, folder MyDrive/{shown}"
    except ValueError:
        where = str(run.path)
    moves = [(o["path"], o["repo_path"]) for o in manifest["outputs"] if o["repo_path"]]
    if manifest.get("manifest_repo_path"):
        moves.append((MANIFEST_NAME, manifest["manifest_repo_path"]))
    kept = [o["path"] for o in manifest["outputs"] if not o["repo_path"]]
    width = max((len(src) for src, _ in moves), default=0)
    lines = [f"Download from {where}", "and put each file at this path in the repo:"]
    lines += [f"  {src.ljust(width)}  ->  {dest}" for src, dest in moves]
    if kept:
        lines.append("Leave these on Drive (not committed): " + ", ".join(kept))
    lines.append('Then reply "done".')
    return "\n".join(lines)


def verify(manifest_path: Path, repo: Path) -> list[str]:
    """Problems found when checking returned files against their manifest; empty means all good."""
    manifest = json.loads(manifest_path.read_text())
    problems = []
    for o in manifest["outputs"]:
        if not o["repo_path"]:
            continue
        p = repo / o["repo_path"]
        if not p.is_file():
            problems.append(f"missing: {o['repo_path']}")
        elif (digest := sha256_file(p)) != o["sha256"]:
            problems.append(
                f"checksum mismatch: {o['repo_path']} ({digest[:12]} != {o['sha256'][:12]})"
            )
    return problems


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m treesvb.colab")
    sub = parser.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify", help="check returned Colab outputs against their manifest")
    v.add_argument("manifest", type=Path)
    v.add_argument("--repo", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    problems = verify(args.manifest, args.repo)
    for line in problems:
        print(line)
    if not problems:
        print(f"All outputs in {args.manifest} match their checksums.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(_main())
