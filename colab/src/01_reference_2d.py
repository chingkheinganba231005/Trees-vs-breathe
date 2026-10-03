# %% [markdown]
# # 01 · Reference 2D: trees, hedges and the CODASC wind tunnel
#
# Runs the phase 2 studies of `python -m treesvb.trees` on an A100 (BRIEF.md section 10):
#
# 1. **calibrate**: the turbulent Schmidt number, on the tree-free CODASC street only;
# 2. **codasc**: the ten cross-wind CODASC cases against the wind-tunnel data (FB, NMSE, FAC2);
# 3. **directions**: do trees raise and a hedge lower the exposure on the pavements?
# 4. **reynolds**: does pavement exposure move when the Reynolds number doubles?
# 5. **resolution**: two cases again on a grid twice as fine;
# 6. **deep streets**: the vortex structure at H/W 2 and 3 on 48 cells per building height.
#
# About 30 to 40 minutes on an A100. Everything is simulated; the wind-tunnel data are fetched
# from the CODASC site and checked against the checksums in the repository.
#
# **How to run:** Runtime → Change runtime type → A100 GPU, then Runtime → Run all. Keep this
# tab open: the last cell downloads one zip, which is what you send back.
#
# CI runs the same notebook on CPU with `TVB_SMOKE=1`: a coarse grid, a few hundred steps, and
# only the studies that need no wind-tunnel files.

# %%
# !nvidia-smi

# %% [markdown]
# ## Parameters

# %%
REPO_URL = "https://github.com/chingkheinganba231005/Trees-vs-breathe.git"
REPO_REF = "claude/relaxed-lamport-aefen3"  # branch, tag or commit; the manifest records the commit
NOTEBOOK = "01_reference_2d"
HEIGHT = 24  # cells per building height; the resolution study also runs twice this
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

run = colab.RunDir.create(NOTEBOOK, smoke=SMOKE)
print("Run folder:", run.path)

# %% [markdown]
# ## Wind-tunnel data
#
# Downloads the CODASC files and stops if any differs from `data/codasc/SHA256SUMS`. Smoke mode
# skips this and the studies that need the files.

# %%
from treesvb import codasc

if not SMOKE:
    bad = codasc.fetch()
    if bad:
        raise SystemExit(f"CODASC files differ from the committed checksums: {bad}")
    print(len(codasc.files()), "CODASC files verified")

# %% [markdown]
# ## Run the studies
#
# Results go to the run folder under `trees/`. Each study prints pass or FAIL with its time.

# %%
from treesvb import trees

if SMOKE:
    args = ["directions", "--quick", "--schmidt", "0.7", "--out", str(run.path)]
    status = trees.main(args)
else:
    status = trees.main(["all", "--height", str(HEIGHT), "--out", str(run.path)])
print(
    "exit status", status, "(1 means a study did not meet its criterion; files are still written)"
)

# %% [markdown]
# ## Deep streets on a finer grid
#
# At H = 24 cells a street with H/W 3 is only 8 cells wide, too coarse to trust its vortices. The
# regime study runs H/W 2 and 3 again at H = 48; until it passes, the app's slider stops at 2.

# %%
from treesvb import street

deep_args = ["regimes", "--tag", "h48", "--out", str(run.path)]
if SMOKE:
    deep_args += ["--quick", "--aspects", "2"]
else:
    deep_args += ["--height", str(2 * HEIGHT), "--aspects", "2", "3"]
print("exit status", street.main(deep_args))

# %% [markdown]
# ## Manifest and the zip to send back
#
# Packs every file meant for the repo, with the manifest, into one zip, keeps it in the run
# folder on Drive and starts a browser download. Send that zip back as it is.

# %%
names = (
    ["directions"] if SMOKE else ["calibration", "codasc", "directions", "reynolds", "resolution"]
)
outputs = {f"trees/{n}.json": f"results/trees/{n}.json" for n in names}
if not SMOKE:
    outputs["street/regimes_h48.json"] = "results/street/regimes_h48.json"
manifest = colab.write_manifest(
    run,
    repo=REPO,
    parameters={"repo_ref": REPO_REF, "height": HEIGHT, "smoke": SMOKE, "jax_pin": JAX_PIN},
    seeds={},
    runtime=runtime,
    started=STARTED,
    outputs=outputs,
    manifest_dest="results/trees/01_reference_2d.manifest.json",
)
colab.hand_off(run, manifest)
