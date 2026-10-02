# Colab notebooks

Heavy GPU work runs on the user's Colab Pro A100 (80 GB). The notebooks import the repo's Python package (`python/treesvb`), so there is one source of truth for the physics.

| Notebook | Purpose | A100 time | Outputs | Status |
| --- | --- | --- | --- | --- |
| `00_setup_check.ipynb` | Checks the runtime, Drive, run folder, manifest and hand-off | 2 min | `results/colab/00_setup_check*.json` | Ready |
| `01_reference_2d.ipynb` | High-resolution 2D benchmarks, Reynolds sensitivity, 2D CODASC cases | 10–30 min | `results/reference2d/*.json`, small PNG figures | Phase 2 |
| `02_codasc_3d.ipynb` | 3D LES of 2–4 CODASC cases | 1–3 h | `results/codasc3d/*.json`, `apps/web/public/data/3d/*.bin` | Phase 4 |
| `03_dataset.ipynb` | Batched 2D runs over the design space | 1–2 h | Dataset on Drive, `results/dataset/manifest.json` | Phase 4 |
| `04_train_surrogate.ipynb` | MLP ensemble and U-Net: train, evaluate, export | 30–60 min | `apps/web/public/models/*.onnx`, `results/surrogate/metrics.json` | Phase 4 |
| `05_street_atlas.ipynb` | Many real streets through the surrogate (stretch) | 30 min | `apps/web/public/data/atlas.json` | Stretch |

## Running one

1. Open the notebook in Colab: File → Upload notebook, or File → Open notebook → GitHub, and paste the notebook's GitHub URL.
2. Runtime → Change runtime type → A100 GPU.
3. Runtime → Run all. The first cell runs `nvidia-smi`; the runtime check stops the notebook with a clear message if the GPU is not an A100.
4. The last cell prints which files to download from `MyDrive/trees-vs-breath/runs/<notebook>/<UTC timestamp>/` and where each goes in the repo. Bring them back and reply "done"; the files are then checked with `python -m treesvb.colab verify <manifest.json>`.

## Rules every notebook follows

- First cell `!nvidia-smi`, then a runtime check that requires an A100 and prints library versions.
- Pinned installs for anything Colab does not already provide at the needed version.
- Code comes from a fresh clone of this public repo. No token ever appears in a notebook.
- Outputs go to `/content/drive/MyDrive/trees-vs-breath/runs/<notebook>/<UTC timestamp>/`, with a `manifest.json` holding the git commit, parameters, seeds, versions, GPU, wall time and the SHA-256 of every output.
- A CPU smoke mode (`TVB_SMOKE=1`: tiny grid, few runs, local folder) that CI executes on every push.
- Committed artifacts stay small: each model at most 10 MB, 3D data at most 15 MB in total. Datasets stay on Drive.

## Editing

The `.ipynb` files are generated. Edit the percent-format sources in `src/`, then run

```
python -m treesvb.notebooks build    # regenerate colab/*.ipynb
python -m treesvb.notebooks smoke    # run them on CPU, as CI does
```

CI fails if a committed notebook is out of date with its source.
