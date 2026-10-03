# %% [markdown]
# # 03 · Dataset: the live street over many designs
#
# Runs on an A100 (BRIEF.md sections 7 and 10). Each run is the street the app simulates live,
# with the app's settings, for one design: trees or a hedge, of any size, density and place,
# in a street with H/W on one of the Design slider's positions (`python -m treesvb.dataset`).
#
# The designs come in blocks, one batch of 32 per street shape (20 with trees, 10 with a hedge,
# 2 bare streets); each block is a Latin hypercube over the design inputs. The test block (9 of
# the 18 shapes) runs first, then the out-of-distribution block (H/W 2.2, 2.5 and 3, beyond the
# slider), then training blocks of 576 runs until `BUDGET_MIN` minutes have passed. Every
# finished block is saved to Drive at once. Each run takes 96 000 steps to fill the street with
# fumes and averages the next 96 000.
#
# The dataset stays on Drive; the notebook `04_train_surrogate` reads it from there. What comes
# back to the repository is a summary (counts, timings, the bare street at every shape, how much
# the averages still move) and the manifest with the checksum of every block.
#
# **How to run:** Runtime → Change runtime type → A100 GPU, then Runtime → Run all. About three
# hours; lower `BUDGET_MIN` for a shorter run with fewer training blocks. Keep this tab open:
# the last cell downloads one zip, which is what you send back. If the runtime stops early, set
# `RESUME` to the run folder's name (printed below, also on Drive under
# `trees-vs-breath/runs/03_dataset/`) and run all again: finished blocks are kept.
#
# CI runs the same notebook on CPU with `TVB_SMOKE=1`: a coarse grid, three street shapes, a few
# hundred steps.

# %%
# !nvidia-smi

# %% [markdown]
# ## Parameters

# %%
REPO_URL = "https://github.com/chingkheinganba231005/Trees-vs-breathe.git"
REPO_REF = "claude/relaxed-lamport-aefen3"  # branch, tag or commit; the manifest records the commit
NOTEBOOK = "03_dataset"
# No new training block starts after this many minutes (the test and out-of-distribution
# blocks and at least one training block always run).
BUDGET_MIN = 150
# To continue an interrupted run, the name of its folder, e.g. "20261003T120000Z".
RESUME = ""
JAX_PIN = "jax[cuda12]==0.10.2"  # the version pinned in python/pyproject.toml

# %% [markdown]
# ## Install and get the code
#
# JAX is pinned to the version the repository is tested with. The physics comes from a fresh
# clone, so the notebook carries no copy of it. No token is needed: the repository is public.

# %%
import os
import subprocess
import sys
import time
from pathlib import Path

STARTED = time.time()
SMOKE = os.environ.get("TVB_SMOKE") == "1"

if not SMOKE:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", JAX_PIN], check=True)

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

# %%
runtime = colab.check_runtime(smoke=SMOKE, packages=["numpy", "jax", "jaxlib"])
for key, value in runtime["versions"].items():
    print(f"{key:>8}: {value}")
print("GPUs:", runtime["gpus"] or "none")

import jax

print("JAX devices:", jax.devices())
if not SMOKE and jax.default_backend() != "gpu":
    raise SystemExit("JAX does not see the GPU; restart the runtime after the install cell.")

# %% [markdown]
# ## Mount Drive and make the run folder

# %%
if not SMOKE:
    from google.colab import drive

    drive.mount("/content/drive")

if RESUME and not SMOKE:
    path = colab.runs_root(False) / NOTEBOOK / RESUME
    if not path.is_dir():
        raise SystemExit(f"No run folder {path}")
    run = colab.RunDir(NOTEBOOK, RESUME, path)
else:
    run = colab.RunDir.create(NOTEBOOK, smoke=SMOKE)
print("Run folder:", run.path)
print("To resume after an interruption, set RESUME =", repr(run.stamp))

# %% [markdown]
# ## Run the blocks
#
# Each street shape prints how many of its runs stayed healthy, its time and the solver's
# speed in cell updates per second. The first batch of each shape includes compiling.

# %%
from treesvb import dataset, results

plan = dataset.SMOKE if SMOKE else dataset.FULL
schmidt = results.read("trees/calibration.json", root=REPO / "results")["schmidt"]
print(f"Sc_t {schmidt}, {plan.batch} runs per street shape and block")
progress = dataset.run(
    run.path / "blocks",
    plan,
    schmidt,
    budget_s=BUDGET_MIN * 60,
    max_blocks=1 if SMOKE else 50,
)
for stem, block in progress["blocks"].items():
    print(f"{stem}: {block['healthy']}/{block['runs']} healthy, {block['seconds'] / 60:.1f} min")

# %% [markdown]
# ## Summary, manifest and the zip to send back
#
# The summary goes into the zip; the blocks stay on Drive, with their checksums in the
# manifest so the training notebook can check them.

# %%
payload = dataset.summary(run.path / "blocks")
results.write("dataset/summary.json", payload, dataset.GENERATED_BY, root=run.path)
print(f"{payload['train_runs']} training runs; noise of the averages: {payload['noise']}")
outputs = {"dataset/summary.json": "results/dataset/summary.json"}
outputs.update({f"blocks/{name}": None for name in payload["files"]})
outputs["blocks/progress.json"] = None
manifest = colab.write_manifest(
    run,
    repo=REPO,
    parameters={
        "repo_ref": REPO_REF,
        "budget_min": BUDGET_MIN,
        "resumed": bool(RESUME),
        "smoke": SMOKE,
        "jax_pin": JAX_PIN,
        "plan": payload["plan"],
    },
    seeds={stem: block["seed"] for stem, block in progress["blocks"].items()},
    runtime=runtime,
    started=STARTED,
    outputs=outputs,
    manifest_dest=f"results/manifests/{NOTEBOOK}_{run.stamp}.manifest.json",
)
colab.hand_off(run, manifest)
