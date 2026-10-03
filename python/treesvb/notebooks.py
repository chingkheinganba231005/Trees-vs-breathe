"""Build the Colab notebooks from their jupytext sources, and run them in CPU smoke mode.

Sources live in colab/src/*.py (percent format) so reviews see plain Python diffs. The .ipynb
files in colab/ are generated, committed without outputs, and opened in Colab.

    python -m treesvb.notebooks build          # regenerate colab/*.ipynb
    python -m treesvb.notebooks check          # fail if any .ipynb is out of date
    python -m treesvb.notebooks smoke [name]   # execute with TVB_SMOKE=1 on CPU (CI does this)
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "colab" / "src"
OUT = REPO / "colab"

# Colab reads these to preselect a high-memory A100 runtime when the notebook opens.
COLAB_METADATA = {
    "accelerator": "GPU",
    "colab": {"gpuType": "A100", "machine_shape": "hm", "provenance": []},
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
}


def sources() -> list[Path]:
    return sorted(SRC.glob("[0-9][0-9]_*.py"))


def render(src: Path) -> str:
    import jupytext
    import nbformat

    nb = jupytext.read(src)
    nb.metadata = dict(COLAB_METADATA)
    for i, cell in enumerate(nb.cells):
        # Stable ids keep regenerated notebooks byte-identical.
        cell["id"] = f"cell-{i:02d}"
        cell["metadata"] = {}
        if cell["cell_type"] == "code":
            cell["outputs"] = []
            cell["execution_count"] = None
    nbformat.validate(nb)
    return nbformat.writes(nb, version=4) + "\n"


def build(check: bool = False) -> list[str]:
    stale = []
    for src in sources():
        target = OUT / f"{src.stem}.ipynb"
        text = render(src)
        if check:
            if not target.exists() or target.read_text() != text:
                stale.append(target.name)
        else:
            target.write_text(text)
    return stale


def smoke(names: list[str] | None = None, timeout: int = 900) -> None:
    import nbformat
    from nbclient import NotebookClient

    from treesvb import colab

    notebooks = sorted(OUT.glob("[0-9][0-9]_*.ipynb"))
    if names:
        notebooks = [p for p in notebooks if p.stem in names or p.stem[:2] in names]
    if not notebooks:
        raise SystemExit("No notebooks matched.")
    with tempfile.TemporaryDirectory(prefix="tvb-smoke-") as tmp:
        # The kernel inherits this process's environment.
        os.environ.update(TVB_SMOKE="1", TVB_REPO=str(REPO), TVB_RUNS_ROOT=str(Path(tmp) / "runs"))
        for path in notebooks:
            print(f"smoke: {path.name}", flush=True)
            nb = nbformat.read(path, as_version=4)
            client = NotebookClient(
                nb, timeout=timeout, kernel_name="python3", resources={"metadata": {"path": tmp}}
            )
            client.execute()
            # Echo the last cell (the hand-off text) so CI logs show it.
            last = next(c for c in reversed(nb.cells) if c.cell_type == "code")
            for out in last.get("outputs", []):
                if out.get("output_type") == "stream":
                    print(out["text"], end="")
            # Unpack the zip the notebook made, the same way a real one is brought back.
            [bundle] = (Path(tmp) / "runs" / path.stem).glob("*/*.zip")
            written = colab.unpack(bundle, Path(tmp) / "repo" / path.stem)
            print(f"smoke: {bundle.name} unpacks to {len(written)} files", flush=True)
            print(f"smoke: {path.name} ok", flush=True)


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m treesvb.notebooks")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build")
    sub.add_parser("check")
    s = sub.add_parser("smoke")
    s.add_argument("names", nargs="*", help="notebook stems or two-digit prefixes")
    args = parser.parse_args(argv)

    if args.cmd == "build":
        build()
        return 0
    if args.cmd == "check":
        stale = build(check=True)
        for name in stale:
            print(f"out of date: colab/{name} (run python -m treesvb.notebooks build)")
        return 1 if stale else 0
    smoke(args.names or None)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
