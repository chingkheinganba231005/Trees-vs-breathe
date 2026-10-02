import datetime as dt
import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from treesvb import colab

REPO = Path(__file__).resolve().parents[2]


def test_sha256_matches_hashlib(tmp_path: Path) -> None:
    p = tmp_path / "x.bin"
    data = bytes(range(256)) * 5000
    p.write_bytes(data)
    assert colab.sha256_file(p, chunk=4096) == hashlib.sha256(data).hexdigest()


def test_utc_stamp_format() -> None:
    when = dt.datetime(2026, 10, 2, 13, 5, 9, tzinfo=dt.UTC)
    assert colab.utc_stamp(when) == "20261002T130509Z"


def test_runtime_check_refuses_non_a100_outside_smoke() -> None:
    t4 = [{"name": "Tesla T4", "memory.total": "15360 MiB", "driver_version": "550"}]
    with pytest.raises(RuntimeError, match="needs an NVIDIA A100"):
        colab.check_runtime(smoke=False, gpus=t4)
    with pytest.raises(RuntimeError, match="no GPU"):
        colab.check_runtime(smoke=False, gpus=[])


def test_runtime_check_accepts_a100_and_smoke() -> None:
    a100 = [{"name": "NVIDIA A100-SXM4-80GB", "memory.total": "81920 MiB", "driver_version": "550"}]
    assert colab.check_runtime(smoke=False, gpus=a100)["gpus"] == a100
    info = colab.check_runtime(smoke=True, gpus=[], packages=["numpy", "surely-not-installed"])
    assert info["versions"]["surely-not-installed"] == "not installed"
    assert info["versions"]["numpy"]


def make_run(tmp_path: Path) -> tuple[colab.RunDir, dict]:
    run = colab.RunDir.create(
        "99_test", smoke=True, root=tmp_path / "runs", stamp="20261002T000000Z"
    )
    (run.path / "a.json").write_text('{"a": 1}\n')
    (run.path / "big.npz").write_bytes(b"\0" * 100)
    manifest = colab.write_manifest(
        run,
        repo=REPO,
        parameters={"grid": 8},
        seeds={"numpy": 1},
        runtime={"smoke": True},
        started=0.0,
        outputs={"a.json": "results/test/a.json", "big.npz": None},
        manifest_dest="results/test/manifest.json",
    )
    return run, manifest


def test_manifest_records_outputs(tmp_path: Path) -> None:
    run, manifest = make_run(tmp_path)
    on_disk = json.loads((run.path / "manifest.json").read_text())
    assert on_disk == manifest
    assert manifest["schema"] == colab.MANIFEST_SCHEMA
    assert len(manifest["git"]["commit"]) in (40, 7) or manifest["git"]["commit"] == "unknown"
    by_path = {o["path"]: o for o in manifest["outputs"]}
    assert by_path["a.json"]["sha256"] == hashlib.sha256(b'{"a": 1}\n').hexdigest()
    assert by_path["big.npz"]["repo_path"] is None


def test_manifest_requires_declared_outputs(tmp_path: Path) -> None:
    run = colab.RunDir.create("99_test", smoke=True, root=tmp_path, stamp="s")
    with pytest.raises(FileNotFoundError):
        colab.write_manifest(
            run,
            repo=REPO,
            parameters={},
            seeds={},
            runtime={},
            started=0.0,
            outputs={"no.json": None},
        )


def test_run_dir_never_reuses_a_folder(tmp_path: Path) -> None:
    colab.RunDir.create("n", smoke=True, root=tmp_path, stamp="s")
    with pytest.raises(FileExistsError):
        colab.RunDir.create("n", smoke=True, root=tmp_path, stamp="s")


def test_download_instructions_list_moves_and_kept_files(tmp_path: Path) -> None:
    run, manifest = make_run(tmp_path)
    text = colab.download_instructions(run, manifest)
    assert "a.json" in text and "results/test/a.json" in text
    assert "manifest.json" in text and "results/test/manifest.json" in text
    assert "Leave these on Drive (not committed): big.npz" in text
    assert text.endswith('Then reply "done".')


def test_download_instructions_show_drive_folder() -> None:
    run = colab.RunDir("03_dataset", "s", colab.DRIVE_RUNS / "03_dataset" / "s")
    manifest = {"outputs": [], "manifest_repo_path": None}
    assert "MyDrive/trees-vs-breath/runs/03_dataset/s" in colab.download_instructions(run, manifest)


def test_verify_catches_missing_and_changed_files(tmp_path: Path) -> None:
    run, _ = make_run(tmp_path)
    repo = tmp_path / "repo"
    manifest_path = run.path / "manifest.json"
    assert colab.verify(manifest_path, repo) == ["missing: results/test/a.json"]

    dest = repo / "results/test/a.json"
    dest.parent.mkdir(parents=True)
    dest.write_text('{"a": 1}\n')
    assert colab.verify(manifest_path, repo) == []

    dest.write_text('{"a": 2}\n')
    [problem] = colab.verify(manifest_path, repo)
    assert problem.startswith("checksum mismatch: results/test/a.json")


def test_verify_cli_exit_codes(tmp_path: Path) -> None:
    run, _ = make_run(tmp_path)
    args = ["verify", str(run.path / "manifest.json"), "--repo", str(tmp_path / "empty")]
    assert colab._main(args) == 1


def test_git_state_of_non_repo(tmp_path: Path) -> None:
    assert colab.git_state(tmp_path)["commit"] == "unknown"


def test_git_state_reads_commit(tmp_path: Path) -> None:
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(tmp_path),
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "x",
        ],
        check=True,
    )
    state = colab.git_state(tmp_path)
    assert len(state["commit"]) == 40
    assert state["dirty"] is False
