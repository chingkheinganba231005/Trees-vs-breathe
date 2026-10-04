# %% [markdown]
# # 05 · Street atlas
#
# Runs the trained surrogate over the measured Hong Kong street presets. This is a stretch
# experiment, not a replacement for the physics check: a street outside the model's training
# range is reported as "physics required", and every recommendation remains simulated.
#
# The atlas compares a small, fixed set of planting configurations:
#
# - bare street;
# - sparse trees;
# - dense trees;
# - a central hedge.
#
# The scalar model supplies pavement exposure and wind. A geometry-only shade proxy ranks the
# configurations on the heat side of the trade-off; it is not UTCI and must not be presented as
# a measured temperature. The output is intentionally small and can be loaded by a future map
# screen.
#
# **How to run:** use an A100 runtime, run all cells, and send back the downloaded zip. The
# notebook uses the ONNX files already exported by `04_train_surrogate`. Because model files are
# not committed to Git, the notebook mounts Drive and finds the newest 04 run under
# `MyDrive/trees-vs-breath/runs/04_train_surrogate/`.

# %%
# !nvidia-smi

# %% [markdown]
# ## Parameters

# %%
REPO_URL = "https://github.com/chingkheinganba231005/Trees-vs-breathe.git"
REPO_REF = "claude/relaxed-lamport-aefen3"
NOTEBOOK = "05_street_atlas"
# Optional 04 run stamp, for example "20261003T183358Z". Empty uses the newest Drive run.
MODEL_RUN = ""
PINS = ["onnxruntime==1.30.0"]

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
from treesvb import colab, results

runtime = colab.check_runtime(smoke=SMOKE, packages=["numpy", "onnxruntime"])
print("smoke mode" if SMOKE else "A100 mode", "| repo", REPO)
print("ONNX Runtime:", runtime["versions"].get("onnxruntime", "not installed"))

if not SMOKE:
    from google.colab import drive

    drive.mount("/content/drive")

# %% [markdown]
# ## Load the presets and the exported surrogate

# %%
import numpy as np

if SMOKE:
    import sys as _sys

    class _SmokeSession:
        def run(self, _names, feed):
            x = next(iter(feed.values()))
            n = x.shape[0]
            # Deterministic stand-in so CI checks the notebook contract without model files.
            return [np.zeros((n, 5, 4), dtype=np.float32)]

    class _SmokeOrt:
        InferenceSession = lambda *_args, **_kwargs: _SmokeSession()

    ort = _SmokeOrt()
else:
    import onnxruntime as ort

models = REPO / "apps" / "web" / "public" / "models"
required_models = ("guard.json", "scalar.onnx")
if not all((models / name).is_file() for name in required_models) and not SMOKE:
    model_runs = colab.runs_root(False) / "04_train_surrogate"
    if MODEL_RUN:
        candidates = [model_runs / MODEL_RUN / "models"]
    else:
        candidates = sorted(model_runs.glob("*/models"), key=lambda path: path.parent.name, reverse=True)
    models = next(
        (
            path
            for path in candidates
            if all((path / name).is_file() for name in required_models)
        ),
        None,
    )
    if models is None:
        raise FileNotFoundError(
            "The repository has no trained models and no complete 04_train_surrogate run was "
            f"found under {model_runs}. Run 04 first, or set MODEL_RUN to its Drive timestamp."
        )
    print("Using trained models from Google Drive:", models)
elif not SMOKE and not all((models / name).is_file() for name in required_models):
    raise FileNotFoundError(f"Smoke model inputs are missing from {models}")
if SMOKE:
    guard = {
        "mean": [0.0] * 9,
        "sd": [1.0] * 9,
        "low": [-100.0] * 9,
        "high": [100.0] * 9,
        "points": [[0.0] * 9],
        "max_distance": 100.0,
    }
    scalar = ort.InferenceSession()
else:
    guard = json.loads((models / "guard.json").read_text(encoding="utf-8"))
    scalar = ort.InferenceSession(str(models / "scalar.onnx"), providers=["CPUExecutionProvider"])
presets = json.loads((REPO / "results" / "streets" / "presets.json").read_text(encoding="utf-8"))

# %% [markdown]
# ## Candidate designs and model contract

# %%
def elements(kind, rows, gap, width, z0, z1, lam_h, shift, street_width):
    if kind == "none":
        return []
    half = 0.5 * width
    mids = [min(gap, 0.5 * street_width), street_width - min(gap, 0.5 * street_width)]
    if rows == 1:
        mids = [0.5 * street_width]
    spans = [[m - half, m + half] for m in mids]
    if len(spans) == 2 and spans[0][1] >= spans[1][0]:
        spans = [[spans[0][0], spans[1][1]]]
    lo, hi = spans[0][0], spans[-1][1]
    room = max(0.0, lo) if shift < 0 else max(0.0, street_width - hi)
    offset = shift * room
    return [
        {"x0": max(0.0, a + offset), "x1": min(street_width, b + offset), "z0": z0, "z1": z1, "lamH": lam_h}
        for a, b in spans
    ]


def features(aspect, blocks):
    out = np.zeros(9, dtype=np.float32)
    out[0] = aspect
    out[1] = len(blocks)
    if blocks:
        ordered = sorted(blocks, key=lambda b: b["x0"])
        first, last = ordered[0], ordered[-1]
        width = 1.0 / aspect
        out[2:6] = [first["x0"] / width, first["x1"] / width, last["x0"] / width, last["x1"] / width]
        out[6:8] = [first["z0"], first["z1"]]
        out[8] = np.log10(first["lamH"])
    return out


DESIGNS = {
    "bare": dict(kind="none", rows=1, gap=0, width=0, z0=0, z1=0, lam_h=0, shift=0),
    "sparse_trees": dict(kind="trees", rows=1, gap=0, width=0.18, z0=0.28, z1=0.72, lam_h=4.0, shift=0),
    "dense_trees": dict(kind="trees", rows=2, gap=0.08, width=0.22, z0=0.28, z1=0.78, lam_h=8.0, shift=0),
    "central_hedge": dict(kind="hedge", rows=1, gap=0, width=0.18, z0=0.0, z1=0.18, lam_h=8.0, shift=0),
}


def shade_proxy(blocks):
    # Geometric canopy coverage proxy only; not UTCI or a temperature prediction.
    return float(sum((b["x1"] - b["x0"]) * max(0.0, b["z1"] - b["z0"]) for b in blocks))


def guard_check(x):
    z = (x - np.asarray(guard["mean"])) / np.asarray(guard["sd"])
    distance = float(np.min(np.linalg.norm(np.asarray(guard["points"]) - z, axis=1)))
    in_box = bool(np.all(x >= np.asarray(guard["low"]) - 1e-9) and np.all(x <= np.asarray(guard["high"]) + 1e-9))
    return {"in_box": in_box, "distance": distance, "near": distance <= guard["max_distance"], "ok": in_box and distance <= guard["max_distance"]}


def predict(x):
    y = np.asarray(scalar.run(None, {"features": np.asarray([x], dtype=np.float32)})[0], dtype=float)
    if y.ndim == 3:
        y = y[0]
    return y.mean(axis=0)

# %% [markdown]
# ## Build the atlas

# %%
rows = []
for street in presets["rows"]:
    measured_aspect = float(street["aspect_h_over_w"]["median"])
    model_aspect = min(2.0, max(0.3, measured_aspect))
    street_width = 1.0 / model_aspect
    candidates = []
    for name, spec in DESIGNS.items():
        blocks = elements(
            spec["kind"], spec["rows"], spec["gap"], spec["width"], spec["z0"], spec["z1"],
            spec["lam_h"], spec["shift"], street_width
        )
        x = features(model_aspect, blocks)
        verdict = guard_check(x)
        output = predict(x) if verdict["ok"] else None
        candidates.append({
            "design": name,
            "guard": verdict,
            "shade_proxy": shade_proxy(blocks),
            "predicted_log_ratio_A": None if output is None else float(output[0]),
            "predicted_log_ratio_B": None if output is None else float(output[1]),
            "predicted_log_wind_A": None if output is None else float(output[2]),
            "predicted_log_wind_B": None if output is None else float(output[3]),
        })
    valid = [c for c in candidates if c["guard"]["ok"]]
    chosen = max(valid, key=lambda c: (c["shade_proxy"], -(c["predicted_log_ratio_A"] or 0))) if valid else None
    rows.append({
        "key": street["key"],
        "label_en": street["label_en"],
        "label_tc": street["label_tc"],
        "measured_aspect_h_over_w": measured_aspect,
        "model_aspect_h_over_w": model_aspect,
        "out_of_distribution": measured_aspect > 2.0,
        "status": "physics_required" if measured_aspect > 2.0 or chosen is None else "surrogate_screened",
        "recommendation": None if chosen is None else chosen["design"],
        "candidates": candidates,
    })

payload = {
    "schema": 1,
    "generated_by": "python -m treesvb.atlas",
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "name": "Hong Kong street atlas screened by the surrogate",
    "method": "Measured street presets screened against four fixed planting configurations; shade_proxy is geometric only, model outputs are simulated, and guarded or out-of-range streets require physics.",
    "passed": all(row["status"] in {"surrogate_screened", "physics_required"} for row in rows),
    "rows": rows,
}

# %% [markdown]
# ## Manifest and hand-off

# %%
run = colab.RunDir.create(NOTEBOOK, smoke=SMOKE)
results.write("atlas.json", payload, "python -m treesvb.atlas", root=run.path)
outputs = {"atlas.json": "apps/web/public/data/atlas.json"}
manifest = colab.write_manifest(
    run,
    repo=REPO,
    parameters={"repo_ref": REPO_REF, "smoke": SMOKE, "designs": list(DESIGNS)},
    seeds={"atlas": 20261004},
    runtime=runtime,
    started=STARTED,
    outputs=outputs,
    manifest_dest=f"results/manifests/{NOTEBOOK}_{run.stamp}.manifest.json",
)
print(json.dumps({"rows": len(rows), "recommendations": [r["recommendation"] for r in rows]}, indent=2))
colab.hand_off(run, manifest)
