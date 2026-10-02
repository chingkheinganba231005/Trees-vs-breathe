import json

from treesvb import notebooks


def test_committed_notebooks_match_their_sources() -> None:
    assert notebooks.build(check=True) == []


def test_every_source_has_a_notebook_and_back() -> None:
    srcs = {p.stem for p in notebooks.sources()}
    built = {p.stem for p in notebooks.OUT.glob("[0-9][0-9]_*.ipynb")}
    assert srcs == built


def test_notebooks_are_committed_clean_and_target_an_a100() -> None:
    for path in notebooks.OUT.glob("[0-9][0-9]_*.ipynb"):
        nb = json.loads(path.read_text())
        assert nb["metadata"]["colab"]["gpuType"] == "A100"
        for cell in nb["cells"]:
            if cell["cell_type"] == "code":
                assert cell["outputs"] == [], path.name
                assert cell["execution_count"] is None, path.name


def test_first_code_cell_runs_nvidia_smi() -> None:
    for path in notebooks.OUT.glob("[0-9][0-9]_*.ipynb"):
        nb = json.loads(path.read_text())
        first = next(c for c in nb["cells"] if c["cell_type"] == "code")
        assert "".join(first["source"]).strip() == "!nvidia-smi", path.name


def test_no_token_in_notebooks() -> None:
    for path in [*notebooks.sources(), *notebooks.OUT.glob("*.ipynb")]:
        text = path.read_text().lower()
        for marker in ("ghp_", "github_pat_", "x-access-token"):
            assert marker not in text, f"{path.name} contains {marker}"
