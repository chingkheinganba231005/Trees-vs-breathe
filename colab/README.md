# Colab notebooks

Heavy GPU work runs on the user's Colab Pro A100 (80 GB). The notebooks import the repo's Python package (`python/treesvb`), so there is one source of truth for the physics.

| Notebook | Purpose | A100 time | Outputs | Status |
| --- | --- | --- | --- | --- |
| `00_setup_check.ipynb` | Checks the runtime, Drive, run folder, manifest and hand-off | 2 min | `results/colab/00_setup_check*.json` | Ready |
| `01_reference_2d.ipynb` | CODASC calibration and comparison, direction checks for trees and a hedge, Reynolds sensitivity, grid resolution at 24 and 48 cells; Wing Lok Street at its measured shape; deep streets at 48 cells | about 3.3 h (run 20261003T085700Z) | `results/trees/*.json` (48 cells: `*_h48.json`), `results/streets/run_wing_lok.json`, `results/street/regimes_h48.json` (the brief's `results/reference2d/` is named after the studies instead) | Three runs on 2026-10-03; the last is in the repo |
| `02_codasc_3d.ipynb` | 3D LES of 2–4 CODASC cases | 1–3 h | `results/codasc3d/*.json`, `apps/web/public/data/3d/*.bin` | Phase 4 |
| `03_dataset.ipynb` | The live street over Latin-hypercube blocks of designs, batched per street shape (`python -m treesvb.dataset`) | about 2 h (`BUDGET_MIN`) | Dataset on Drive; `results/dataset/summary.json` and the manifest with each block's checksum | Ready |
| `04_train_surrogate.ipynb` | MLP ensemble and U-Net: train, evaluate, export | 30–60 min | `apps/web/public/models/*.onnx`, `results/surrogate/metrics.json` | Phase 4 |
| `05_street_atlas.ipynb` | Many real streets through the surrogate (stretch) | 30 min | `apps/web/public/data/atlas.json` | Stretch |

## Running one

1. Open the notebook in Colab: File → Upload notebook, or File → Open notebook → GitHub, and paste the notebook's GitHub URL.
2. Runtime → Change runtime type → A100 GPU.
3. Runtime → Run all. The first cell runs `nvidia-smi`; the runtime check stops the notebook with a clear message if the GPU is not an A100.
4. Keep the tab open. The last cell packs every file meant for the repo, with the manifest, into one zip (`<notebook>_<UTC timestamp>.zip`) and your browser downloads it. The same zip stays in `MyDrive/trees-vs-breath/runs/<notebook>/<UTC timestamp>/` in case the download does not start. Send the zip back unopened and reply "done". It is unpacked with `python -m treesvb.colab unpack <zip>`, which checks every file against the manifest before writing any of them.

## Rules every notebook follows

- First cell `!nvidia-smi`, then a runtime check that requires an A100 and prints library versions.
- Pinned installs for anything Colab does not already provide at the needed version.
- Code comes from a fresh clone of this public repo. No token ever appears in a notebook.
- Outputs go to `/content/drive/MyDrive/trees-vs-breath/runs/<notebook>/<UTC timestamp>/`, with a `manifest.json` holding the git commit, parameters, seeds, versions, GPU, wall time and the SHA-256 of every output.
- The last cell calls `colab.hand_off`: one zip of the files for the repo, each at its repo path, plus the manifest, downloaded to the user's computer.
- A CPU smoke mode (`TVB_SMOKE=1`: tiny grid, few runs, local folder) that CI executes on every push.
- Committed artifacts stay small: each model at most 10 MB, 3D data at most 15 MB in total. Datasets stay on Drive.

## Editing

The `.ipynb` files are generated. Edit the percent-format sources in `src/`, then run

```
python -m treesvb.notebooks build    # regenerate colab/*.ipynb
python -m treesvb.notebooks smoke    # run them on CPU, as CI does
```

CI fails if a committed notebook is out of date with its source.
