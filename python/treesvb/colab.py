"""Plumbing shared by the Colab notebooks: runtime checks, run folders, manifests, checksums.

Every notebook follows BRIEF.md section 10: check for an A100, write outputs to a timestamped
folder on Google Drive, record a manifest with the git commit, parameters, seeds, versions, GPU,
wall time and the SHA-256 of every output, and finish by printing which files go where in the
repo. In smoke mode (TVB_SMOKE=1, used by CI) the same code runs on CPU with a local folder.

The hand-off is one zip: `hand_off` packs every file meant for the repo at its repo path,
together with the manifest, and starts a browser download when it runs inside Colab. The zip
also stays in the run folder on Drive. `python -m treesvb.colab unpack <zip>` checks every file
against the manifest before writing any of them into the repo; `verify <manifest>` re-checks
files already in place.
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
import zipfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path, PurePosixPath
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


def bundle_name(manifest: Mapping[str, Any]) -> str:
    return f"{manifest['notebook']}_{manifest['run']}.zip"


def pack(run: RunDir, manifest: Mapping[str, Any]) -> Path:
    """Zip the outputs meant for the repo, each at its repo path, with the manifest.

    Files that stay on Drive (repo_path None) are left out. The manifest goes in at its own repo
    path, or as manifest.json at the top when it has none.
    """
    bundle = run.path / bundle_name(manifest)
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for o in manifest["outputs"]:
            if o["repo_path"]:
                z.write(run.path / o["path"], o["repo_path"])
        z.write(run.path / MANIFEST_NAME, manifest.get("manifest_repo_path") or MANIFEST_NAME)
    return bundle


def offer_download(path: Path) -> bool:
    """Start a browser download of `path` when running in Colab; False anywhere else."""
    try:
        from google.colab import files  # only importable inside Colab
    except ImportError:
        return False
    try:
        files.download(str(path))
    except Exception as e:  # the zip is also on Drive, so a failed download is not fatal
        print(f"The browser download did not start ({e}).")
        return False
    return True


def where(run: RunDir) -> str:
    try:
        return f"Google Drive, folder MyDrive/{run.path.relative_to(DRIVE_RUNS.parent.parent)}"
    except ValueError:
        return str(run.path)


def download_instructions(
    run: RunDir, manifest: Mapping[str, Any], bundle: Path, *, downloading: bool
) -> str:
    """The text the last cell prints: the zip to send back and what it holds."""
    if downloading:
        lines = [
            f"Your browser is downloading {bundle.name}.",
            f"If no download appears, the same file is in {where(run)}.",
        ]
    else:
        lines = [f"Download {bundle.name} from {where(run)}."]
    with zipfile.ZipFile(bundle) as z:
        held = z.namelist()
    lines.append("Send the zip back unopened. It holds these files at their places in the repo:")
    lines += [f"  {name}" for name in held]
    kept = [o["path"] for o in manifest["outputs"] if not o["repo_path"]]
    if kept:
        lines.append("Leave these on Drive (not committed): " + ", ".join(kept))
    lines.append('Then reply "done" with the zip attached.')
    return "\n".join(lines)


def hand_off(run: RunDir, manifest: Mapping[str, Any]) -> Path:
    """Last step of every notebook: zip the outputs, start the download, print what to send."""
    bundle = pack(run, manifest)
    downloading = offer_download(bundle)
    print(download_instructions(run, manifest, bundle, downloading=downloading))
    return bundle


def _safe_repo_path(name: str) -> bool:
    p = PurePosixPath(name)
    return bool(name) and "\\" not in name and not p.is_absolute() and ".." not in p.parts


def unpack(bundle: Path, repo: Path) -> list[str]:
    """Check a returned zip against the manifest inside it, then write its files into the repo.

    Nothing is written unless every file is expected, has a safe relative path and matches its
    checksum. Returns the repo paths written; raises ValueError listing the problems otherwise.
    """
    with zipfile.ZipFile(bundle) as z:
        names = [i.filename for i in z.infolist() if not i.is_dir()]
        manifests = [n for n in names if PurePosixPath(n).name.endswith(MANIFEST_NAME)]
        if len(manifests) != 1:
            raise ValueError(f"expected one manifest in {bundle.name}, found {len(manifests)}")
        manifest_name = manifests[0]
        manifest = json.loads(z.read(manifest_name))
        expected = {o["repo_path"]: o["sha256"] for o in manifest["outputs"] if o["repo_path"]}

        problems = []
        if manifest_name != (manifest.get("manifest_repo_path") or MANIFEST_NAME):
            problems.append(f"manifest stored at an unexpected path: {manifest_name}")
        for name in names:
            if not _safe_repo_path(name):
                problems.append(f"unsafe path: {name}")
            elif name != manifest_name and name not in expected:
                problems.append(f"not in the manifest: {name}")
        for name, digest in expected.items():
            if name not in names:
                problems.append(f"missing: {name}")
            elif (got := hashlib.sha256(z.read(name)).hexdigest()) != digest:
                problems.append(f"checksum mismatch: {name} ({got[:12]} != {digest[:12]})")
        if problems:
            raise ValueError("; ".join(problems))

        written = []
        for name in [*expected, manifest_name]:
            dest = repo / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(z.read(name))
            written.append(name)
    return written


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
    u = sub.add_parser("unpack", help="check a Colab zip and write its files into the repo")
    u.add_argument("bundle", type=Path)
    u.add_argument("--repo", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    if args.cmd == "unpack":
        try:
            written = unpack(args.bundle, args.repo)
        except ValueError as e:
            print(f"Nothing written: {e}")
            return 1
        for name in written:
            print(f"wrote {name}")
        print(f"All {len(written)} files in {args.bundle.name} match the manifest.")
        return 0

    problems = verify(args.manifest, args.repo)
    for line in problems:
        print(line)
    if not problems:
        print(f"All outputs in {args.manifest} match their checksums.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(_main())
