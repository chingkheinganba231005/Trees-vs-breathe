"""The surrogate: five MLPs for the pavement readouts, a U-Net for the street fields (BRIEF.md 7).

    python -m treesvb.surrogate train BLOCKS --out DIR [--smoke]   # on the A100 (colab/04)

BLOCKS is a folder written by `python -m treesvb.dataset run`. Training uses the training blocks
only, with a tenth held back to stop each model at its best epoch; the test block and the
out-of-distribution block are scored once, at the end, and never steer the training.

Scalar model. Inputs: the features of the blocks a design puts in the street (dataset.FEATURES,
D-034). Outputs: the exposure on each pavement as log(c+ / c+ of the bare street of the same
shape), and the log of the wind on each pavement as a share of the inflow speed. Five networks
from different seeds; their spread is the uncertainty the app shows.

Field model. Input: the design drawn on the 64 x 128 street grid (drag and cover), H/W and the
position on the grid. Outputs: log(1 + c+) and the wind speed over the street.

Both are exported to ONNX with float16 weights that are cast to float32 when the model loads,
so every onnxruntime-web backend can run them; `guard` holds what the app needs to refuse
inputs outside the training data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

from . import dataset, trees

GENERATED_BY = "python -m treesvb.surrogate train"

MEMBERS = 5
HIDDEN = (128, 128, 128)
FIELD_BASE = 32  # channels of the U-Net's first level, doubled at each of the three below
FIELD_INPUTS = ("drag", "cover", "aspect", "x", "z")
FIELD_OUTPUTS = ("log1p_cplus", "speed")
SCALAR_OUTPUTS = ("log_ratio_A", "log_ratio_B", "log_wind_A", "log_wind_B")
VALIDATION = 0.1  # share of the training runs held back to choose the epoch
#: The guard accepts a design whose nearest training sample (in standardised features) is no
#: farther than this quantile of the training samples' own nearest-neighbour distances.
GUARD_QUANTILE = 0.99
#: Models must stay below this size (BRIEF.md 7.6).
MAX_MODEL_BYTES = 10 * 1024 * 1024


# --- data ------------------------------------------------------------------------------------


def load_sets(blocks: Path) -> dict[str, dict[str, np.ndarray]]:
    """Training, test and out-of-distribution runs; unhealthy runs are left out."""
    raw = dataset.load(blocks)
    train = [v for k, v in sorted(raw.items()) if k.startswith("train")]
    sets = {"train": _concat(train), "test": raw["test"], "ood": raw["ood"]}
    return {k: _select(v, v["healthy"]) for k, v in sets.items()}


def _concat(parts: list[dict]) -> dict[str, np.ndarray]:
    keys = [k for k in parts[0] if k != "band"]
    return {k: np.concatenate([p[k] for p in parts]) for k in keys}


def _select(data: dict[str, np.ndarray], mask: np.ndarray) -> dict[str, np.ndarray]:
    return {k: v[mask] for k, v in data.items() if k != "band"}


def bare_means(data: dict[str, np.ndarray]) -> dict[float, dict[str, np.ndarray]]:
    """Mean exposure and wind of the bare runs of each street shape, per pavement."""
    out = {}
    bare = data["kind"] == 0
    for a in np.unique(data["aspect"][bare]):
        m = bare & (data["aspect"] == a)
        out[float(a)] = {
            "exposure": data["exposure"][m].mean(axis=(0, 1)),
            "wind": data["wind"][m].mean(axis=(0, 1)),
            "runs": int(m.sum()),
        }
    return out


def scalar_targets(data: dict[str, np.ndarray], bare: dict) -> tuple[np.ndarray, np.ndarray]:
    """(features, targets) of the runs with greenery; targets in SCALAR_OUTPUTS order."""
    green = data["kind"] > 0
    exposure = data["exposure"][green].mean(axis=1)  # mean of the two halves
    wind = data["wind"][green].mean(axis=1)
    base = np.stack([bare[float(a)]["exposure"] for a in data["aspect"][green]])
    # The floor only matters for CI's few-hundred-step runs, where fumes may not yet have
    # reached a pavement; full runs are far above it.
    floor = 1e-3
    ratio = np.maximum(exposure, floor) / np.maximum(base, floor)
    y = np.concatenate([np.log(ratio), np.log(np.maximum(wind, floor))], axis=1)
    return data["features"][green].astype(np.float64), y


# --- the field model's input -----------------------------------------------------------------


def _cover(lo: float, hi: float, n: int) -> np.ndarray:
    """Share of each of n equal cells on [0, 1] inside [lo, hi]."""
    edges = np.arange(n + 1) / n
    return np.clip(np.minimum(edges[1:], hi) - np.maximum(edges[:-1], lo), 0, None) * n


def field_input(aspect: float, blocks: np.ndarray) -> np.ndarray:
    """The design on the street grid: FIELD_INPUTS channels, FIELD_ROWS x FIELD_COLS.

    `blocks` holds rows of (x0, x1, z0, z1, lambda H) in units of H, zero rows for no block.
    drag is the cover times log10(lambda H) / 2.5; cover is the share of each grid cell inside
    a block. apps/web/src/ai/fieldInput.ts draws the same.
    """
    rows, cols = dataset.FIELD_ROWS, dataset.FIELD_COLS
    out = np.zeros((len(FIELD_INPUTS), rows, cols), np.float32)
    for x0, x1, z0, z1, lam_h in blocks:
        if x1 <= x0 or z1 <= z0:
            continue
        cover = np.outer(_cover(z0, z1, rows), _cover(x0 * aspect, x1 * aspect, cols))
        out[1] += cover
        out[0] += cover * np.log10(lam_h) / 2.5
    out[2] = aspect / 2
    out[3] = ((np.arange(cols) + 0.5) / cols)[None, :]
    out[4] = ((np.arange(rows) + 0.5) / rows)[:, None]
    return out


def field_inputs(data: dict[str, np.ndarray]) -> np.ndarray:
    pairs = zip(data["aspect_grid"], data["blocks"], strict=True)
    return np.stack([field_input(a, b) for a, b in pairs])


def field_targets(data: dict[str, np.ndarray]) -> np.ndarray:
    f = data["fields"].astype(np.float32)
    return np.stack([np.log1p(np.maximum(f[:, 0], 0)), f[:, 1]], axis=1)


# --- metrics ---------------------------------------------------------------------------------


def scores(true: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    """R2, median relative error and FAC2 of positive values, as in BRIEF.md 7.3."""
    t, p = np.asarray(true, np.float64).ravel(), np.asarray(pred, np.float64).ravel()
    ratio = p / t
    return {
        "n": int(t.size),
        "r2": round(float(1 - ((t - p) ** 2).sum() / ((t - t.mean()) ** 2).sum()), 4),
        "median_relative_error": round(float(np.median(np.abs(ratio - 1))), 4),
        "fac2": round(float(((ratio >= 0.5) & (ratio <= 2)).mean()), 4),
    }


def noise_floor(data: dict[str, np.ndarray], key: str) -> float:
    """The median relative error a perfect model would score against these labels.

    The label is the mean of two halves h1, h2; if they are independent with equal spread, the
    label's error has median |h1 - h2| / 2, so relative to the label |h1 - h2| / (h1 + h2).
    """
    h = data[key][data["kind"] > 0]
    return round(float(np.median(np.abs(h[:, 0] - h[:, 1]) / (h[:, 0] + h[:, 1]))), 4)


# --- the out-of-distribution guard -----------------------------------------------------------


def guard(x_train: np.ndarray) -> dict:
    """Box, scaling and nearest-neighbour bound of the training features, for the app."""
    mean, sd = x_train.mean(axis=0), x_train.std(axis=0)
    sd = np.where(sd > 0, sd, 1.0)
    z = (x_train - mean) / sd
    nn = _nearest(z, z, exclude_self=True)
    return {
        "features": list(dataset.FEATURES),
        # Rounded outwards, so the box still holds every training sample.
        "low": [float(np.floor(v * 1e4) / 1e4) for v in x_train.min(axis=0)],
        "high": [float(np.ceil(v * 1e4) / 1e4) for v in x_train.max(axis=0)],
        "mean": [round(float(v), 6) for v in mean],
        "sd": [round(float(v), 6) for v in sd],
        "quantile": GUARD_QUANTILE,
        "max_distance": round(float(np.quantile(nn, GUARD_QUANTILE)), 4),
        "points": [[round(float(v), 3) for v in row] for row in z],
    }


def _nearest(q: np.ndarray, ref: np.ndarray, exclude_self: bool = False) -> np.ndarray:
    out = np.empty(len(q))
    for i in range(0, len(q), 512):
        d = ((q[i : i + 512, None, :] - ref[None, :, :]) ** 2).sum(axis=-1)
        if exclude_self:
            d[np.arange(d.shape[0]), np.arange(i, i + d.shape[0])] = np.inf
        out[i : i + 512] = np.sqrt(d.min(axis=1))
    return out


def inside(g: dict, x: np.ndarray) -> np.ndarray:
    """True where a design is inside the training box and near enough to a training sample."""
    lo, hi = np.array(g["low"]), np.array(g["high"])
    box = ((x >= lo - 1e-9) & (x <= hi + 1e-9)).all(axis=1)
    z = (x - np.array(g["mean"])) / np.array(g["sd"])
    near = _nearest(z, np.array(g["points"])) <= g["max_distance"]
    return box & near


# --- models ----------------------------------------------------------------------------------


def _torch():
    import torch

    return torch


def mlp(n_in: int, n_out: int):
    torch = _torch()
    layers, width = [], n_in
    for h in HIDDEN:
        layers += [torch.nn.Linear(width, h), torch.nn.SiLU()]
        width = h
    layers.append(torch.nn.Linear(width, n_out))
    return torch.nn.Sequential(*layers)


def unet(n_in: int, n_out: int, base: int = FIELD_BASE):
    torch = _torch()
    nn = torch.nn

    def block(a, b):
        return nn.Sequential(
            nn.Conv2d(a, b, 3, padding=1), nn.SiLU(), nn.Conv2d(b, b, 3, padding=1), nn.SiLU()
        )

    class UNet(nn.Module):
        def __init__(self):
            super().__init__()
            w = [base, 2 * base, 4 * base, 8 * base]
            self.down = nn.ModuleList([block(n_in, w[0]), block(w[0], w[1]), block(w[1], w[2])])
            self.mid = block(w[2], w[3])
            self.up = nn.ModuleList(
                [nn.ConvTranspose2d(w[k + 1], w[k], 2, stride=2) for k in (2, 1, 0)]
            )
            self.dec = nn.ModuleList([block(2 * w[k], w[k]) for k in (2, 1, 0)])
            self.head = nn.Conv2d(w[0], n_out, 1)
            self.pool = nn.MaxPool2d(2)

        def forward(self, x):
            skips = []
            for d in self.down:
                x = d(x)
                skips.append(x)
                x = self.pool(x)
            x = self.mid(x)
            for up, dec, skip in zip(self.up, self.dec, reversed(skips), strict=True):
                x = dec(torch.cat([up(x), skip], dim=1))
            return self.head(x)

    return UNet()


def _fit(model, x, y, xv, yv, epochs: int, batch: int, lr: float, seed: int, log):
    """Adam with cosine decay on standardised data; returns the weights of the best epoch on the
    validation runs and the validation loss per epoch."""
    torch = _torch()
    torch.manual_seed(seed)
    gen = torch.Generator().manual_seed(seed)
    dev = next(model.parameters()).device
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    steps = epochs * max(1, -(-len(x) // batch))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.05)
    best, best_state, history = np.inf, None, []
    for epoch in range(epochs):
        model.train()
        order = torch.randperm(len(x), generator=gen)
        for i in range(0, len(x), batch):
            idx = order[i : i + batch]
            xb, yb = x[idx].to(dev), y[idx].to(dev)
            loss = ((model(xb) - yb) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
        model.eval()
        with torch.no_grad():
            val = float(
                np.mean(
                    [
                        ((model(xv[i : i + batch].to(dev)) - yv[i : i + batch].to(dev)) ** 2)
                        .mean()
                        .item()
                        for i in range(0, len(xv), batch)
                    ]
                )
            )
        history.append(val)
        if val < best:
            best = val
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        if log and (epoch % max(1, epochs // 10) == 0 or epoch == epochs - 1):
            log(f"    epoch {epoch + 1}/{epochs}: validation loss {val:.4f}")
    if best_state is not None:
        model.load_state_dict(best_state)
    return model, history


def train_scalar(x, y, val, epochs: int, device: str, log=None):
    """The ensemble wrapped with its scaling, so it takes raw features and returns
    (n, MEMBERS, outputs) in target units."""
    torch = _torch()
    xm, xs = x[~val].mean(axis=0), x[~val].std(axis=0)
    xs = np.where(xs > 0, xs, 1.0)
    ym, ys = y[~val].mean(axis=0), y[~val].std(axis=0)

    def t(a):
        return torch.tensor(a, dtype=torch.float32)

    xt, yt = t((x - xm) / xs), t((y - ym) / ys)
    members, histories = [], []
    for k in range(MEMBERS):
        if log:
            log(f"  scalar model, member {k + 1} of {MEMBERS}")
        net = mlp(x.shape[1], y.shape[1]).to(device)
        net, h = _fit(net, xt[~val], yt[~val], xt[val], yt[val], epochs, 256, 3e-3, k, log)
        members.append(net.cpu())
        histories.append(h)

    class Ensemble(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.members = torch.nn.ModuleList(members)
            for name, v in (("xm", xm), ("xs", xs), ("ym", ym), ("ys", ys)):
                self.register_buffer(name, t(v))

        def forward(self, features):
            z = (features - self.xm) / self.xs
            return torch.stack([m(z) * self.ys + self.ym for m in self.members], dim=1)

    return Ensemble().eval(), histories


def train_field(inputs, targets, val, epochs: int, device: str, log=None):
    """The U-Net wrapped with its output scaling: returns FIELD_OUTPUTS in their units."""
    torch = _torch()
    m = targets[~val].mean(axis=(0, 2, 3))
    s = targets[~val].std(axis=(0, 2, 3))
    xt = torch.tensor(inputs, dtype=torch.float32)
    yt = torch.tensor(
        (targets - m[None, :, None, None]) / s[None, :, None, None], dtype=torch.float32
    )
    net = unet(inputs.shape[1], targets.shape[1]).to(device)
    if log:
        log(f"  field model: {sum(p.numel() for p in net.parameters())} parameters")
    net, history = _fit(net, xt[~val], yt[~val], xt[val], yt[val], epochs, 32, 1e-3, 0, log)
    net = net.cpu()

    class Field(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.net = net
            self.register_buffer("m", torch.tensor(m, dtype=torch.float32)[None, :, None, None])
            self.register_buffer("s", torch.tensor(s, dtype=torch.float32)[None, :, None, None])

        def forward(self, design):
            return self.net(design) * self.s + self.m

    return Field().eval(), history


# --- export ----------------------------------------------------------------------------------


def export(model, example, path: Path, input_name: str, output_name: str) -> None:
    """ONNX with float16 weights, cast to float32 inside the graph (D-035)."""
    import io

    import onnx
    import torch

    buf = io.BytesIO()
    torch.onnx.export(
        model,
        (torch.tensor(example, dtype=torch.float32),),
        buf,
        input_names=[input_name],
        output_names=[output_name],
        dynamic_axes={input_name: {0: "n"}, output_name: {0: "n"}},
        opset_version=18,
        dynamo=False,
    )
    m = onnx.load_from_string(buf.getvalue())
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(half_weights(m), str(path))


def half_weights(m):
    """Store every float32 weight as float16 and add a Cast back to float32 before its use."""
    import onnx
    from onnx import helper, numpy_helper

    g = m.graph
    casts = []
    for init in list(g.initializer):
        if init.data_type != onnx.TensorProto.FLOAT:
            continue
        a = numpy_helper.to_array(init)
        if a.size < 16:  # scalars and tiny tensors stay float32
            continue
        name = init.name
        half = numpy_helper.from_array(a.astype(np.float16), name + "_fp16")
        g.initializer.remove(init)
        g.initializer.append(half)
        casts.append(helper.make_node("Cast", [half.name], [name], to=onnx.TensorProto.FLOAT))
    nodes = casts + list(g.node)
    del g.node[:]
    g.node.extend(nodes)
    onnx.checker.check_model(m)
    return m


def run_onnx(path: Path, x: np.ndarray) -> np.ndarray:
    import onnxruntime as ort

    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    name = s.get_inputs()[0].name
    out = [s.run(None, {name: x[i : i + 256].astype(np.float32)})[0] for i in range(0, len(x), 256)]
    return np.concatenate(out)


# --- evaluation ------------------------------------------------------------------------------


def evaluate_scalar(path: Path, data: dict, bare: dict, g: dict) -> dict:
    """Scores of the exported scalar model on a set of runs, from the ONNX file itself."""
    x, y = scalar_targets(data, bare)
    pred = run_onnx(path, x)  # (n, members, outputs)
    mean, spread = pred.mean(axis=1), pred.std(axis=1)
    green = data["kind"] > 0
    base = np.maximum(np.stack([bare[float(a)]["exposure"] for a in data["aspect"][green]]), 1e-3)
    out = {"runs": len(x)}
    for k, side in enumerate("AB"):
        true_c = np.exp(y[:, k]) * base[:, k]
        pred_c = np.exp(mean[:, k]) * base[:, k]
        out[f"exposure_{side}"] = scores(true_c, pred_c)
        out[f"ratio_{side}"] = scores(np.exp(y[:, k]), np.exp(mean[:, k]))
        out[f"wind_{side}"] = scores(np.exp(y[:, 2 + k]), np.exp(mean[:, 2 + k]))
        inside_band = np.abs(y[:, k] - mean[:, k]) <= 2 * spread[:, k]
        out[f"within_two_spreads_{side}"] = round(float(inside_band.mean()), 4)
    both = np.concatenate([np.exp(y[:, :2]) * base, np.exp(mean[:, :2]) * base], axis=1)
    out["exposure"] = scores(both[:, :2], both[:, 2:])
    out["noise_floor"] = {
        "exposure": noise_floor(data, "exposure"),
        "wind": noise_floor(data, "wind"),
    }
    out["guard_accepts"] = round(float(inside(g, x).mean()), 4)
    out["parity"] = {
        "true": [[round(float(v), 3) for v in row] for row in both[:, :2]],
        "pred": [[round(float(v), 3) for v in row] for row in both[:, 2:]],
        "spread": [[round(float(v), 4) for v in row] for row in spread[:, :2]],
        "aspect": [round(float(v), 2) for v in data["aspect"][green]],
    }
    return out


def r2(true: np.ndarray, pred: np.ndarray) -> float:
    t, p = np.asarray(true, np.float64).ravel(), np.asarray(pred, np.float64).ravel()
    return round(float(1 - ((t - p) ** 2).sum() / ((t - t.mean()) ** 2).sum()), 4)


def evaluate_field(path: Path, data: dict) -> dict:
    """R2 of the exported field model over every grid point of every run, and the pavement
    exposure read from its c+ field (mean over the breathing band near each wall)."""
    inputs = field_inputs(data)
    pred = run_onnx(path, inputs)
    true = field_targets(data)
    rows = dataset.band_rows(dataset.FIELD_ROWS)
    # The grid spans W in FIELD_COLS columns, so a pavement 0.15 H wide covers 0.15 H/W of them.
    n = np.maximum(1, np.round(trees.PAVEMENT_WIDTH * data["aspect_grid"] * dataset.FIELD_COLS))

    def pavements(f):
        c = np.expm1(f[:, 0][:, rows]).mean(axis=1)
        return np.array([[c[i, : int(k)].mean(), c[i, -int(k) :].mean()] for i, k in enumerate(n)])

    return {
        "runs": len(inputs),
        "r2_log1p_cplus": r2(true[:, 0], pred[:, 0]),
        "r2_speed": r2(true[:, 1], pred[:, 1]),
        "pavement_cplus": scores(pavements(true), np.maximum(pavements(pred), 1e-6)),
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def train(blocks: Path, out: Path, smoke: bool = False, log=print) -> dict:
    """Train, export and score both models; writes ONNX files, guard.json and metrics.json."""
    import torch

    t0 = time.time()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sets = load_sets(blocks)
    train_set = sets["train"]
    bare = bare_means(train_set)
    x, y = scalar_targets(train_set, bare)
    rng = np.random.default_rng(0)
    val = rng.random(len(x)) < VALIDATION
    if smoke:
        val[: max(1, len(x) // 5)] = True
    scalar_epochs, field_epochs = (5, 2) if smoke else (600, 120)
    log(f"{len(x)} training runs with greenery ({val.sum()} held back), device {device}")
    ens, scalar_hist = train_scalar(x, y, val, scalar_epochs, device, log)
    models = out / "models"
    export(ens, x[:2], models / "scalar.onnx", "features", "outputs")
    g = guard(x[~val])
    (models / "guard.json").write_text(json.dumps(g, separators=(",", ":")) + "\n")

    inputs = np.stack(
        [
            field_input(a, b)
            for a, b in zip(train_set["aspect_grid"], train_set["blocks"], strict=True)
        ]
    )
    targets = field_targets(train_set)
    fval = rng.random(len(inputs)) < VALIDATION
    if smoke:
        fval[: max(1, len(inputs) // 5)] = True
    field, field_hist = train_field(inputs, targets, fval, field_epochs, device, log)
    export(field, inputs[:1], models / "field.onnx", "design", "fields")

    ood_bare = bare_means(sets["ood"])
    sizes = {p.name: p.stat().st_size for p in sorted(models.iterdir())}
    payload = {
        "name": "Surrogate accuracy against the solver",
        "method": (
            f"Scalar model: {MEMBERS} MLPs {list(HIDDEN)} on {len(dataset.FEATURES)} features, "
            f"trained on {int((~val).sum())} runs with greenery, {int(val.sum())} held back to "
            f"choose the epoch; field model: U-Net from {FIELD_BASE} channels on the "
            f"{dataset.FIELD_ROWS} x {dataset.FIELD_COLS} street grid. Scored once on the test "
            "block and the out-of-distribution block, from the exported ONNX files"
        ),
        "targets": {"r2": 0.95, "median_relative_error": 0.10, "fac2": 0.95},
        "training_runs": {"with_greenery": len(x), "validation": int(val.sum())},
        "bare_runs": {str(a): b["runs"] for a, b in bare.items()},
        "scalar": {
            "test": evaluate_scalar(models / "scalar.onnx", sets["test"], bare, g),
            "ood": evaluate_scalar(models / "scalar.onnx", sets["ood"], ood_bare, g),
            "validation_loss": [round(min(h), 5) for h in scalar_hist],
        },
        "field": {
            "test": evaluate_field(models / "field.onnx", sets["test"]),
            "ood": evaluate_field(models / "field.onnx", sets["ood"]),
            "validation_loss": round(min(field_hist), 5),
        },
        "models": {
            name: {"bytes": size, "sha256": sha256(models / name)} for name, size in sizes.items()
        },
        "device": device,
        "seconds": round(time.time() - t0, 1),
    }
    t = payload["targets"]
    s = payload["scalar"]["test"]["exposure"]
    payload["meets_targets"] = bool(
        s["r2"] >= t["r2"]
        and s["median_relative_error"] <= t["median_relative_error"]
        and s["fac2"] >= t["fac2"]
    )
    payload["passed"] = all(
        v["bytes"] <= MAX_MODEL_BYTES for k, v in payload["models"].items() if k.endswith(".onnx")
    )
    return payload


def main(argv: list[str] | None = None) -> int:
    from . import results

    p = argparse.ArgumentParser(prog="python -m treesvb.surrogate")
    sub = p.add_subparsers(dest="command", required=True)
    t = sub.add_parser("train")
    t.add_argument("blocks", type=Path)
    t.add_argument("--out", type=Path, required=True)
    t.add_argument("--smoke", action="store_true")
    args = p.parse_args(argv)
    payload = train(args.blocks, args.out, args.smoke)
    results.write("surrogate/metrics.json", payload, GENERATED_BY, root=args.out)
    print(json.dumps(payload["scalar"]["test"]["exposure"]))
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
