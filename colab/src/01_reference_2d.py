# %% [markdown]
# # 01 · Reference 2D: trees, hedges, the CODASC wind tunnel and Wing Lok Street
#
# Runs on an A100 (BRIEF.md section 10), with the regularised collision:
#
# 1. **At 24 cells per building height** (the CPU engine's grid), the five studies of
#    `python -m treesvb.trees`: calibrate the turbulent Schmidt number on the tree-free CODASC
#    street; compare the ten cross-wind CODASC cases with the tunnel (FB, NMSE, FAC2); check that
#    trees raise and a hedge lowers the leeward pavement's exposure; check the Reynolds number;
#    and repeat two cases on a grid twice as fine.
# 2. **At 48 cells** (the WebGPU engine's grid), the same studies except the grid check.
# 3. **Wing Lok Street at its measured shape** (H/W 4.4), at `STREET_HEIGHT` cells per building
#    height, with no greenery, local trees and a hedge (`python -m treesvb.streetruns`).
# 4. **Deep streets**: the vortex structure at H/W 2 and 3 on 48 cells.
#
# Averaging windows are four times those of run 20261003T055628Z, whose halves still differed.
# About 1.5 hours on an A100. Everything is simulated; the wind-tunnel data are fetched from the
# CODASC site and checked against the checksums in the repository.
#
# **How to run:** Runtime → Change runtime type → A100 GPU, then Runtime → Run all. Keep this
# tab open: the last cell downloads one zip, which is what you send back. If the runtime stops
# early, the finished results are in the run folder on Drive.
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
# Grids in cells per building height: 24 is the CPU engine's, 48 the WebGPU engine's. Results at
# 24 keep plain names, at 48 they get a suffix (codasc_h48.json).
LIVE, FINE = 24, 48
# Wing Lok Street is 4.4 times taller than wide: 96 cells per building height give 22 across it.
STREET = "wing_lok"
STREET_HEIGHT = 96
# H/W 2 and 3 at 48 cells (results/street/regimes_h48.json).
DEEP_STREETS = True
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
# Results go to the run folder under `trees/`, `streets/` and `street/`. Each study prints pass
# or FAIL with its time. Wing Lok Street runs straight after the calibration at 48 cells, whose
# Schmidt number it uses, so it is done before the longer comparisons.

# %%
from treesvb import street, streetruns, trees

out = ["--out", str(run.path)]
if SMOKE:
    status = trees.main(["directions", "--quick", "--schmidt", "0.7", *out])
    status |= streetruns.main([STREET, "--quick", "--schmidt", "0.7", *out])
else:
    status = 0
    print(f"--- {LIVE} cells per building height", flush=True)
    status |= trees.main(["all", "--height", str(LIVE), *out])
    fine = ["--height", str(FINE), "--tag", f"h{FINE}", *out]
    print(f"--- {FINE} cells: calibration", flush=True)
    status |= trees.main(["calibrate", *fine])
    print(f"--- {STREET} at {STREET_HEIGHT} cells", flush=True)
    calibration = f"trees/calibration_h{FINE}.json"
    status |= streetruns.main(
        [STREET, "--height", str(STREET_HEIGHT), "--calibration", calibration, *out]
    )
    for study in ["codasc", "directions", "reynolds"]:
        print(f"--- {FINE} cells: {study}", flush=True)
        status |= trees.main([study, *fine])
print(
    "exit status", status, "(1 means a study did not meet its criterion; files are still written)"
)

# %% [markdown]
# ## Deep streets on a finer grid
#
# At H = 24 cells a street with H/W 3 is only 8 cells wide, too coarse to trust its vortices. The
# regime study runs H/W 2 and 3 at H = 48 when `DEEP_STREETS` is set (smoke mode always runs a
# short version, so the step stays tested).

# %%
if SMOKE or DEEP_STREETS:
    deep_args = ["regimes", "--tag", f"h{FINE}", *out]
    if SMOKE:
        deep_args += ["--quick", "--aspects", "2"]
    else:
        deep_args += ["--height", str(FINE), "--aspects", "2", "3"]
    print("exit status", street.main(deep_args))

# %% [markdown]
# ## Manifest and the zip to send back
#
# Packs every file meant for the repo, with the manifest, into one zip, keeps it in the run
# folder on Drive and starts a browser download. Send that zip back as it is.

# %%
studies = ["calibration", "codasc", "directions", "reynolds", "resolution"]
if SMOKE:
    names = ["directions"]
else:
    names = [*studies, *(f"{n}_h{FINE}" for n in studies if n != "resolution")]
outputs = {f"trees/{n}.json": f"results/trees/{n}.json" for n in names}
outputs[f"streets/run_{STREET}.json"] = f"results/streets/run_{STREET}.json"
if DEEP_STREETS and not SMOKE:
    outputs[f"street/regimes_h{FINE}.json"] = f"results/street/regimes_h{FINE}.json"
manifest = colab.write_manifest(
    run,
    repo=REPO,
    parameters={
        "repo_ref": REPO_REF,
        "heights": [LIVE, FINE],
        "street": STREET,
        "street_height": STREET_HEIGHT,
        "deep_streets": DEEP_STREETS,
        "smoke": SMOKE,
        "jax_pin": JAX_PIN,
    },
    seeds={},
    runtime=runtime,
    started=STARTED,
    outputs=outputs,
    manifest_dest=f"results/manifests/{NOTEBOOK}_{run.stamp}.manifest.json",
)
colab.hand_off(run, manifest)
