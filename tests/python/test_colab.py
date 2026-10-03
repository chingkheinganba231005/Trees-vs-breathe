import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import types
import zipfile
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


def test_pack_holds_repo_files_and_manifest_only(tmp_path: Path) -> None:
    run, manifest = make_run(tmp_path)
    bundle = colab.pack(run, manifest)
    assert bundle == run.path / "99_test_20261002T000000Z.zip"
    with zipfile.ZipFile(bundle) as z:
        assert sorted(z.namelist()) == ["results/test/a.json", "results/test/manifest.json"]
        assert z.read("results/test/a.json") == b'{"a": 1}\n'


def test_offer_download_is_a_no_op_outside_colab(tmp_path: Path) -> None:
    assert colab.offer_download(tmp_path / "x.zip") is False


def fake_colab(monkeypatch: pytest.MonkeyPatch, download) -> None:
    google = types.ModuleType("google")
    google.colab = types.ModuleType("google.colab")
    google.colab.files = types.SimpleNamespace(download=download)
    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.colab", google.colab)


def test_offer_download_uses_colab_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    fake_colab(monkeypatch, calls.append)
    assert colab.offer_download(tmp_path / "x.zip") is True
    assert calls == [str(tmp_path / "x.zip")]


def test_failed_download_falls_back_to_drive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def refuse(path: str) -> None:
        raise RuntimeError("browser blocked it")

    fake_colab(monkeypatch, refuse)
    run, manifest = make_run(tmp_path)
    bundle = colab.hand_off(run, manifest)
    out = capsys.readouterr().out
    assert "The browser download did not start (browser blocked it)." in out
    assert f"Download {bundle.name} from {run.path}." in out


def test_download_instructions_name_the_zip_and_its_contents(tmp_path: Path) -> None:
    run, manifest = make_run(tmp_path)
    bundle = colab.pack(run, manifest)
    text = colab.download_instructions(run, manifest, bundle, downloading=True)
    assert text.startswith("Your browser is downloading 99_test_20261002T000000Z.zip.")
    assert "  results/test/a.json" in text and "  results/test/manifest.json" in text
    assert "Leave these on Drive (not committed): big.npz" in text
    assert text.endswith('Then reply "done" with the zip attached.')
    quiet = colab.download_instructions(run, manifest, bundle, downloading=False)
    assert quiet.startswith(f"Download 99_test_20261002T000000Z.zip from {run.path}.")


def test_drive_folder_is_named() -> None:
    run = colab.RunDir("03_dataset", "s", colab.DRIVE_RUNS / "03_dataset" / "s")
    assert colab.where(run) == "Google Drive, folder MyDrive/trees-vs-breath/runs/03_dataset/s"


def test_unpack_writes_checked_files(tmp_path: Path) -> None:
    run, manifest = make_run(tmp_path)
    bundle = colab.pack(run, manifest)
    repo = tmp_path / "repo"
    assert colab.unpack(bundle, repo) == ["results/test/a.json", "results/test/manifest.json"]
    assert (repo / "results/test/a.json").read_text() == '{"a": 1}\n'
    assert colab.verify(repo / "results/test/manifest.json", repo) == []
    assert colab._main(["unpack", str(bundle), "--repo", str(repo)]) == 0


def rezip(bundle: Path, out: Path, change: dict[str, bytes | None]) -> Path:
    """Copy a zip, replacing (bytes) or dropping (None) the named members."""
    with zipfile.ZipFile(bundle) as src, zipfile.ZipFile(out, "w") as dst:
        for name in src.namelist():
            if name not in change:
                dst.writestr(name, src.read(name))
        for name, data in change.items():
            if data is not None:
                dst.writestr(name, data)
    return out


@pytest.mark.parametrize(
    ("change", "problem"),
    [
        ({"results/test/a.json": b'{"a": 2}\n'}, "checksum mismatch: results/test/a.json"),
        ({"results/test/a.json": None}, "missing: results/test/a.json"),
        ({"results/test/extra.json": b"{}"}, "not in the manifest: results/test/extra.json"),
        ({"../outside.json": b"{}"}, "unsafe path: ../outside.json"),
        ({"/abs.json": b"{}"}, "unsafe path: /abs.json"),
    ],
)
def test_unpack_refuses_bad_zips_and_writes_nothing(
    tmp_path: Path, change: dict[str, bytes | None], problem: str
) -> None:
    run, manifest = make_run(tmp_path)
    bad = rezip(colab.pack(run, manifest), tmp_path / "bad.zip", change)
    repo = tmp_path / "repo"
    with pytest.raises(ValueError, match=re.escape(problem)):
        colab.unpack(bad, repo)
    assert not repo.exists() and not (tmp_path / "outside.json").exists()
    assert colab._main(["unpack", str(bad), "--repo", str(repo)]) == 1


def test_unpack_needs_exactly_one_manifest(tmp_path: Path) -> None:
    run, manifest = make_run(tmp_path)
    bundle = colab.pack(run, manifest)
    no_manifest = rezip(bundle, tmp_path / "none.zip", {"results/test/manifest.json": None})
    with pytest.raises(ValueError, match="expected one manifest"):
        colab.unpack(no_manifest, tmp_path / "repo")


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


def test_returned_results_match_their_latest_manifest() -> None:
    """Files brought back from Colab are committed as they arrived; a later run may replace them."""
    manifests = [json.loads(p.read_text()) for p in REPO.glob("results/**/*.manifest.json")]
    latest: dict[str, str] = {}
    for m in sorted(manifests, key=lambda m: m["run"]):
        latest.update({o["repo_path"]: o["sha256"] for o in m["outputs"] if o["repo_path"]})
    assert latest, "no manifests found"
    for path, digest in latest.items():
        assert colab.sha256_file(REPO / path) == digest, path
