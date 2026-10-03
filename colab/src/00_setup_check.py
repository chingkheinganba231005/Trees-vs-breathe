# %% [markdown]
# # 00 · Setup check
#
# Run this once before the first real Colab job. It takes about two minutes and checks the
# whole protocol from `BRIEF.md` section 10: the A100 runtime, getting the code, Google Drive,
# the run folder, the manifest with checksums, and the zip you send back.
#
# **How to run:** Runtime → Change runtime type → A100 GPU, then Runtime → Run all. Keep this
# tab open: the last cell downloads one zip, which is what you send back.
#
# CI runs the same notebook on CPU with `TVB_SMOKE=1` (no GPU, no Drive, local folder).

# %%
# !nvidia-smi

# %% [markdown]
# ## Parameters

# %%
REPO_URL = "https://github.com/chingkheinganba231005/Trees-vs-breathe.git"
REPO_REF = ""  # empty for the default branch, or a branch name, tag or commit
NOTEBOOK = "00_setup_check"
SEED = 20261002

# %% [markdown]
# ## Get the code
#
# The repo's Python package is the single source of truth for the physics, so the notebook
# imports it from a fresh clone rather than carrying its own copy. No token is needed: the
# repository is public.

# %%
import os
import subprocess
import sys
import time
from pathlib import Path

STARTED = time.time()
SMOKE = os.environ.get("TVB_SMOKE") == "1"

if SMOKE:
    REPO = Path(os.environ["TVB_REPO"])
else:
    REPO = Path("/content/Trees-vs-breathe")
    if not REPO.exists():
        subprocess.run(["git", "clone", "--depth", "50", REPO_URL, str(REPO)], check=True)
    if REPO_REF:
        subprocess.run(["git", "-C", str(REPO), "fetch", "origin", REPO_REF], check=True)
        subprocess.run(["git", "-C", str(REPO), "checkout", "--detach", "FETCH_HEAD"], check=True)

# A path entry, not pip install -e: an editable install is invisible until the kernel restarts.
sys.path.insert(0, str(REPO / "python"))

from treesvb import colab

print("smoke mode" if SMOKE else "A100 mode", "| repo", REPO)

# %% [markdown]
# ## Check the runtime
#
# Stops here with a clear message if the runtime is not an A100.

# %%
runtime = colab.check_runtime(smoke=SMOKE, packages=["numpy", "jax", "torch"])
for key, value in runtime["versions"].items():
    print(f"{key:>8}: {value}")
print("GPUs:", runtime["gpus"] or "none")

# %% [markdown]
# ## Mount Drive and make the run folder

# %%
if not SMOKE:
    from google.colab import drive

    drive.mount("/content/drive")

run = colab.RunDir.create(NOTEBOOK, smoke=SMOKE)
print("Run folder:", run.path)

# %% [markdown]
# ## A small deterministic job
#
# Writes one JSON file, so the manifest and checksum steps have something real to record.

# %%
import json

import numpy as np

rng = np.random.default_rng(SEED)
sample = rng.standard_normal(10_000 if SMOKE else 1_000_000)
check = {
    "notebook": NOTEBOOK,
    "run": run.stamp,
    "samples": int(sample.size),
    "mean": float(sample.mean()),
    "std": float(sample.std()),
}
(run.path / "setup_check.json").write_text(json.dumps(check, indent=2) + "\n")
print(check)

# %% [markdown]
# ## Manifest and the zip to send back
#
# Packs every file meant for the repo, with the manifest, into one zip, keeps it in the run
# folder on Drive and starts a browser download. Send that zip back as it is.

# %%
manifest = colab.write_manifest(
    run,
    repo=REPO,
    parameters={"repo_ref": REPO_REF or "default branch"},
    seeds={"numpy": SEED},
    runtime=runtime,
    started=STARTED,
    outputs={"setup_check.json": "results/colab/00_setup_check.json"},
    manifest_dest="results/colab/00_setup_check.manifest.json",
)
colab.hand_off(run, manifest)
