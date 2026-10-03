# %% [markdown]
# # 04 · Train the surrogate
#
# Runs on an A100 (BRIEF.md sections 7 and 10), on the dataset that `03_dataset` left on Drive
# (`python -m treesvb.surrogate`):
#
# 1. **Scalar model**: five MLPs predicting, from a design's blocks, the fumes on each pavement
#    against the bare street and the wind on each pavement. The spread of the five is the
#    uncertainty the app shows.
# 2. **Field model**: a U-Net predicting c+ and wind speed over the street on a 64 x 128 grid.
# 3. **Scores**, computed once from the exported files: the test block and the
#    out-of-distribution block, against the targets R² ≥ 0.95, median relative error ≤ 10% and
#    FAC2 ≥ 0.95, with the noise of the solver's own averages beside them.
# 4. **Export**: ONNX with float16 weights for the browser, and the guard that tells the app
#    when a design lies outside the training data.
#
# About 30 minutes. Training uses only the training blocks; a tenth of them is held back to
# choose each model's best epoch. Nothing is tuned on the test block.
#
# **How to run:** Runtime → Change runtime type → A100 GPU, then Runtime → Run all. Leave
# `DATASET_RUN` empty to use the newest `03_dataset` run on Drive. The last cell downloads one
# zip, which is what you send back.
#
# CI runs the same notebook on CPU with `TVB_SMOKE=1`, on the smoke dataset `03` just made.

# %%
# !nvidia-smi

# %% [markdown]
# ## Parameters

# %%
REPO_URL = "https://github.com/chingkheinganba231005/Trees-vs-breathe.git"
REPO_REF = "claude/relaxed-lamport-aefen3"  # branch, tag or commit; the manifest records the commit
NOTEBOOK = "04_train_surrogate"
# The 03_dataset run folder to train on, e.g. "20261003T150000Z"; empty for the newest.
DATASET_RUN = ""
# The versions pinned in python/pyproject.toml (extra "train").
PINS = ["torch==2.14.1", "onnx==1.23.1", "onnxruntime==1.30.0"]

# %% [markdown]
# ## Install and get the code

# %%
import json
import os
import subprocess
import sys
import time
from pathlib import Path

STARTED = time.time()
SMOKE = os.environ.get("TVB_SMOKE") == "1"

if not SMOKE:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", *PINS], check=True)

if SMOKE:
    REPO = Path(os.environ["TVB_REPO"])
else:
    REPO = Path("/content/Trees-vs-breathe")
    if not REPO.exists():
        subprocess.run(["git", "clone", "--depth", "50", REPO_URL, str(REPO)], check=True)
    if REPO_REF:
        subprocess.run(["git", "-C", str(REPO), "fetch", "origin", REPO_REF], check=True)
        subprocess.run(["git", "-C", str(REPO), "checkout", "--detach", "FETCH_HEAD"], check=True)

sys.path.insert(0, str(REPO / "python"))

from treesvb import colab

print("smoke mode" if SMOKE else "A100 mode", "| repo", REPO)

# %% [markdown]
# ## Check the runtime

# %%
runtime = colab.check_runtime(smoke=SMOKE, packages=["numpy", "torch", "onnx", "onnxruntime"])
for key, value in runtime["versions"].items():
    print(f"{key:>11}: {value}")
print("GPUs:", runtime["gpus"] or "none")

import torch

print("CUDA:", torch.cuda.is_available())
if not SMOKE and not torch.cuda.is_available():
    raise SystemExit("PyTorch does not see the GPU; restart the runtime after the install cell.")

# %% [markdown]
# ## Mount Drive, find the dataset and check it
#
# Every block must match the checksum `03_dataset` recorded when it wrote it.

# %%
if not SMOKE:
    from google.colab import drive

    drive.mount("/content/drive")

runs = colab.runs_root(SMOKE) / "03_dataset"
if DATASET_RUN:
    source = runs / DATASET_RUN
else:
    done = sorted(p.parent.parent for p in runs.glob("*/blocks/progress.json"))
    if not done:
        raise SystemExit(f"No 03_dataset run with blocks under {runs}")
    source = done[-1]
blocks = source / "blocks"
progress = json.loads((blocks / "progress.json").read_text())
bad = [
    stem
    for stem, block in progress["blocks"].items()
    if colab.sha256_file(blocks / f"{stem}.npz") != block["sha256"]
]
if bad:
    raise SystemExit(f"These blocks do not match their checksums: {bad}")
print("Dataset:", source.name, "| blocks:", ", ".join(progress["blocks"]))

run = colab.RunDir.create(NOTEBOOK, smoke=SMOKE)
print("Run folder:", run.path)

# %% [markdown]
# ## Train, export and score

# %%
from treesvb import results, surrogate

payload = surrogate.train(blocks, run.path, smoke=SMOKE)
payload["dataset_run"] = source.name
results.write("surrogate/metrics.json", payload, surrogate.GENERATED_BY, root=run.path)
test = payload["scalar"]["test"]
print("Test block, pavement exposure:", test["exposure"])
print("Noise of the solver's averages (median relative):", test["noise_floor"])
print("Out of distribution:", payload["scalar"]["ood"]["exposure"])
print("Field model, test:", payload["field"]["test"])
print("Meets the targets:", payload["meets_targets"], "| model sizes:", payload["models"])

# %% [markdown]
# ## Manifest and the zip to send back

# %%
outputs = {
    "models/scalar.onnx": "apps/web/public/models/scalar.onnx",
    "models/field.onnx": "apps/web/public/models/field.onnx",
    "models/guard.json": "apps/web/public/models/guard.json",
    "surrogate/metrics.json": "results/surrogate/metrics.json",
}
manifest = colab.write_manifest(
    run,
    repo=REPO,
    parameters={
        "repo_ref": REPO_REF,
        "dataset_run": source.name,
        "dataset_blocks": {k: v["sha256"] for k, v in progress["blocks"].items()},
        "smoke": SMOKE,
        "pins": PINS,
    },
    seeds={"validation_split": 0, **{f"member_{k}": k for k in range(surrogate.MEMBERS)}},
    runtime=runtime,
    started=STARTED,
    outputs=outputs,
    manifest_dest=f"results/manifests/{NOTEBOOK}_{run.stamp}.manifest.json",
)
colab.hand_off(run, manifest)
