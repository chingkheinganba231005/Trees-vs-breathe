"""Training data for the surrogate: the live street run over many designs (BRIEF.md 7.1).

    python -m treesvb.dataset run --out DIR [--budget-min 100]   # on the A100 (colab/03_dataset)
    python -m treesvb.dataset run --out DIR --smoke              # a tiny grid on CPU, for CI
    python -m treesvb.dataset summary DIR [--results ROOT]       # results/dataset/summary.json

Every design is one the Design screen can make (D-032): a street with H/W on one of the slider's
positions, with trees (one row in the middle, or one row near each wall that merges with the
other when they meet; any row width, crown base and top, density and sideways shift) or a hedge
(height, width, density, shift). The runs use the live app's settings, so the surrogate learns
the solver the app runs: 24 cells per building height (D-024), uniform inflow, Re 20 000,
C_s 0.17, the Sc_t calibrated at that grid, CODASC's lanes closing in with the width (A-012) and
the absorbing layers.

Designs come in blocks. A block is a Latin hypercube over the design inputs, stratified so that
every street shape gets the same number of designs. The designs of one shape share a grid, so
they run side by side on the GPU with jax.vmap, one batch per shape. Each batch also holds two
runs of the bare street, started from different small disturbances, so that the bare street,
the denominator of every fume ratio, is averaged over many independent runs. Blocks run until
a time budget is spent; a block that finished is saved at once, so an interrupted run keeps its
finished blocks and can be resumed. The first block is the test set and the second the
out-of-distribution set at H/W beyond the slider (D-031); the training blocks follow.

Per run the dataset keeps
- c+ and wind speed in the breathing band (0.05-0.15 H, A-010), per column across the street,
  for each half of the averaging window: any pavement width can be read from it, and the two
  halves measure how much the average still moves;
- the mean c+, wind speed and velocity over the street (ground to roof, wall to wall),
  resampled onto a fixed 64 x 128 grid and stored as float16, for the field model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from . import results, trees
from .solver2d import cases

GENERATED_BY = "python -m treesvb.dataset summary"

#: The live app's flow (LIVE_FLOW and canyonParams in apps/web/src/sim/streetSim.ts, street.ts).
U_REF = 0.05
REYNOLDS = 20000.0
SMAGORINSKY = 0.17
SOURCE_TOTAL = 1e-3

#: The Design screen's H/W slider: 0.3 to 2 in steps of 0.1 (apps/web/src/screens/Design.tsx).
ASPECTS = tuple(round(0.3 + 0.1 * k, 1) for k in range(18))
#: Beyond the slider and the checked vortex structure: the out-of-distribution set (D-031).
OOD_ASPECTS = (2.2, 2.5, 3.0)

#: The street fields are resampled onto this grid: rows from the ground to the roofs, columns
#: from wall to wall, cell centres at equal fractions of H and W.
FIELD_ROWS, FIELD_COLS = 64, 128
FIELD_CHANNELS = ("cplus", "speed", "ux", "uy")

#: Design ranges, units of H unless stated; (low, high, scale). Sources in docs/assumptions.md
#: A-025: local roadside trees 7-10 m tall with 4-5 m crowns (results/streets/trees.json), in
#: streets 18-49 m tall (results/streets/presets.json), crown widths 50-150% (Design screen),
#: CODASC's crowns (light and dense, stand density 0.5 and 1, roof height, a central row up to
#: half the street) and the hedges of Gromke et al. (2016).
TREE_RANGES = {
    "width": (0.05, 1.2, "log"),  # width of each row
    "gap": (0.1, 0.6, "lin"),  # centre of each row from its wall, with two rows
    "top": (0.15, 1.0, "lin"),  # crown top
    "base": (0.1, 0.7, "lin"),  # crown base as a share of the crown top (the Design slider)
    "lam_h": (4.0, 100.0, "log"),  # pressure-loss coefficient times H
    "shift": (-1.0, 1.0, "lin"),  # sideways, as a share of the room up to the wall that way
    "rows": (0.0, 1.0, "lin"),  # below 0.5: one row in the middle; above: two rows
}
HEDGE_RANGES = {
    "top": (0.03, 0.15, "lin"),
    "width": (0.03, 0.1, "lin"),
    "lam_h": (25.0, 180.0, "log"),
    "shift": (-1.0, 1.0, "lin"),
}

#: Initial disturbance of the velocity, as a share of the inflow speed. It makes the two bare
#: runs in each batch independent; the street flow forgets it during the spin-up.
DISTURBANCE = 0.01
#: A run counts as healthy if its populations are finite and its speed stays below this.
SPEED_LIMIT = 0.4


@dataclass(frozen=True)
class Plan:
    height: int  # cells per building height
    aspects: tuple[float, ...]
    ood_aspects: tuple[float, ...]
    trees: int  # tree designs per street shape and block
    hedges: int  # hedge designs per street shape and block
    bare: int  # bare-street runs per street shape and block
    run: trees.Run  # spin-up, averaging window, sampling interval
    seed: int

    @property
    def batch(self) -> int:
        return self.trees + self.hedges + self.bare


#: The A100 plan (D-033): batches of 32 per street shape, 576 runs per block.
FULL = Plan(
    height=24,
    aspects=ASPECTS,
    ood_aspects=OOD_ASPECTS,
    trees=20,
    hedges=10,
    bare=2,
    run=trees.Run(spin_up=24_000, average=96_000, every=48, height=24),
    seed=20261003,
)
#: CI's plan: a coarse grid and a few hundred steps, so the pipeline runs on CPU in minutes.
SMOKE = Plan(
    height=8,
    aspects=(0.5, 1.0, 2.0),
    ood_aspects=(3.0,),
    trees=2,
    hedges=1,
    bare=1,
    run=trees.Run(spin_up=200, average=400, every=20, height=8),
    seed=7,
)


@dataclass(frozen=True)
class Design:
    """A design as the Design screen describes it, in units of H.

    kind is "none", "trees" or "hedge"; rows is 1 (in the middle) or 2 (one near each wall,
    `gap` from it to the row's centre); z0 and z1 are the bottom and top; shift moves the layout
    sideways by that share of the room up to the wall on that side.
    """

    aspect: float
    kind: str
    rows: int = 0
    gap: float = 0.0
    width: float = 0.0
    z0: float = 0.0
    z1: float = 0.0
    lam_h: float = 0.0
    shift: float = 0.0


KINDS = ("none", "trees", "hedge")


def elements(d: Design, street_width: float) -> list[cases.Crown]:
    """The porous blocks of a design in a street `street_width` H wide.

    As buildGreenery in apps/web/src/sim/greenery.ts lays them out: two rows that meet become
    one canopy, the shift moves the layout towards a wall without passing it, and a layout wider
    than the street is cut at the walls.
    """
    if d.kind == "none":
        return []
    half = 0.5 * d.width
    if d.rows == 2:
        gap = min(d.gap, 0.5 * street_width)
        mids: tuple[float, ...] = (gap, street_width - gap)
    else:
        mids = (0.5 * street_width,)
    spans = [(m - half, m + half) for m in mids]
    if len(spans) == 2 and spans[0][1] >= spans[1][0]:
        spans = [(spans[0][0], spans[1][1])]
    lo, hi = spans[0][0], spans[-1][1]
    room = max(0.0, lo) if d.shift < 0 else max(0.0, street_width - hi)
    s = d.shift * room
    return [
        cases.Crown(max(0.0, a + s), min(street_width, b + s), d.z0, d.z1, d.lam_h)
        for a, b in spans
    ]


#: Inputs of the scalar model, computed from the blocks a design puts in the street, so any
#: layout the app draws maps onto them (apps/web/src/ai/features.ts computes the same).
FEATURES = ("aspect", "blocks", "a_x0", "a_x1", "b_x0", "b_x1", "z0", "z1", "log10_lam_h")


def features(aspect: float, blocks: list[cases.Crown]) -> np.ndarray:
    """H/W, the number of blocks, the first and last block's edges as shares of the street
    width, and the shared bottom, top and log10(lambda H); zeros where there is no block."""
    w = 1.0 / aspect
    out = np.zeros(len(FEATURES))
    out[0] = aspect
    out[1] = len(blocks)
    if blocks:
        a, b = blocks[0], blocks[-1]
        out[2:6] = (a.x0 / w, a.x1 / w, b.x0 / w, b.x1 / w)
        out[6:9] = (a.z0, a.z1, np.log10(a.lam_h))
    return out


def lhs(n: int, dims: int, rng: np.random.Generator) -> np.ndarray:
    """n points in [0, 1)^dims with exactly one in each of n equal strata along every axis."""
    strata = rng.permuted(np.tile(np.arange(n), (dims, 1)), axis=1).T
    return (strata + rng.random((n, dims))) / n


def _scaled(u: float, lo: float, hi: float, scale: str) -> float:
    if scale == "log":
        return float(np.exp(np.log(lo) + u * (np.log(hi) - np.log(lo))))
    return float(lo + u * (hi - lo))


def sample_block(plan: Plan, aspects: tuple[float, ...], seed: int) -> list[Design]:
    """One block: a Latin hypercube per kind, its points dealt evenly to the street shapes."""
    rng = np.random.default_rng(seed)
    out = []
    for kind, per, ranges in (
        ("trees", plan.trees, TREE_RANGES),
        ("hedge", plan.hedges, HEDGE_RANGES),
    ):
        n = per * len(aspects)
        u = lhs(n, len(ranges), rng)
        shape = rng.permutation(np.repeat(np.arange(len(aspects)), per))
        for k in range(n):
            v = {name: _scaled(u[k, i], *r) for i, (name, r) in enumerate(ranges.items())}
            a = aspects[int(shape[k])]
            if kind == "trees":
                rows = 2 if v["rows"] >= 0.5 else 1
                out.append(
                    Design(
                        a,
                        "trees",
                        rows,
                        v["gap"] if rows == 2 else 0.0,
                        v["width"],
                        v["base"] * v["top"],
                        v["top"],
                        v["lam_h"],
                        v["shift"],
                    )
                )
            else:
                out.append(
                    Design(a, "hedge", 1, 0.0, v["width"], 0.0, v["top"], v["lam_h"], v["shift"])
                )
    out += [Design(a, "none") for a in aspects for _ in range(plan.bare)]
    return out


def live_case(g: cases.CanyonGeometry, schmidt: float) -> cases.Case:
    """The live app's street without greenery: liveParams in apps/web/src/sim/streetSim.ts."""
    src = cases.line_sources(g, trees.lane_offsets(g.width / g.height), SOURCE_TOTAL)
    return cases.canyon(
        g,
        u_ref=U_REF,
        reynolds=REYNOLDS,
        smagorinsky=SMAGORINSKY,
        exponent=0.0,
        sources=src,
        schmidt=schmidt,
    )


_PROGRAMS: dict = {}


def _program(spin_up: int, half: int, every: int):
    """The batched run, compiled once per run length (and by JAX once per grid shape)."""
    key = (spin_up, half, every)
    if key in _PROGRAMS:
        return _PROGRAMS[key]
    import jax
    import jax.numpy as jnp

    from .solver2d import core

    def one(drag, f0, cfg):
        cfg = {**cfg, "drag": drag}
        fluid = cfg["fluid"]

        def advance(n, state):
            return jax.lax.fori_loop(0, n, lambda _, s: core.coupled_step(jnp, s, cfg)[0], state)

        def sample(_, carry):
            state, acc = carry
            state = advance(every, state)
            f, g = state
            c = core.concentration(jnp, g, cfg)
            _, ux, uy = core.macros(jnp, core.stream(jnp, f, cfg), cfg)
            return state, acc + jnp.stack([c, ux, uy, jnp.sqrt(ux * ux + uy * uy)])

        def total(g):
            return jnp.where(fluid, g, 0.0).sum()

        g0 = jnp.zeros((core.Q5, *f0.shape[1:]), f0.dtype)
        state = advance(spin_up, (f0, g0))
        zero = jnp.zeros((4, *f0.shape[1:]), f0.dtype)
        t0 = total(state[1])
        state, first = jax.lax.fori_loop(0, half, sample, (state, zero))
        state, second = jax.lax.fori_loop(0, half, sample, (state, zero))
        f = state[0]
        _, ux, uy = core.macros(jnp, core.stream(jnp, f, cfg), cfg)
        top = jnp.where(fluid, jnp.sqrt(ux * ux + uy * uy), 0.0).max()
        healthy = jnp.isfinite(f).all() & (top < SPEED_LIMIT)
        return first, second, jnp.stack([t0, total(state[1])]), healthy

    prog = jax.jit(jax.vmap(one, in_axes=(0, 0, None)))
    _PROGRAMS[key] = prog
    return prog


def initial_states(case: cases.Case, seeds: list[int]) -> np.ndarray:
    """Equilibrium of the inflow everywhere outside buildings, plus a small seeded disturbance."""
    from .solver2d import core

    rho, ux, uy = cases.uniform_start(case)
    open_ = ~case.domain.solid
    out = []
    for s in seeds:
        rng = np.random.default_rng(s)
        dx, dy = (DISTURBANCE * U_REF * rng.standard_normal(rho.shape) * open_ for _ in "xy")
        out.append(core.equilibrium(np, rho, ux + dx, uy + dy))
    return np.asarray(out, dtype=np.float32)


def band_rows(height: int) -> np.ndarray:
    """Rows of the breathing band: cell centres from 0.05 to 0.15 H (pavement_exposure)."""
    zc = np.arange(height) + 0.5
    return (zc >= trees.BREATHING[0] * height) & (zc <= trees.BREATHING[1] * height)


def pavement_columns(width_cells: int, height: int, pavement: float) -> int:
    """Columns whose centres lie within `pavement` H of a wall (pavement_exposure)."""
    return int(np.count_nonzero(np.arange(width_cells) + 0.5 <= pavement * height))


def pavements(band: np.ndarray, width_cells: int, height: int, pavement: float) -> np.ndarray:
    """Mean over the columns of each pavement: A (leeward, first columns) and B (last ones).

    `band` holds one value per column of the street along its last axis (NaN-padded beyond
    `width_cells`); the result has the same leading axes and a last axis of 2.
    """
    n = pavement_columns(width_cells, height, pavement)
    a = band[..., :n].mean(axis=-1)
    b = band[..., width_cells - n : width_cells].mean(axis=-1)
    return np.stack([a, b], axis=-1)


def _resample(a: np.ndarray, n: int, axis: int) -> np.ndarray:
    """Linear interpolation along one axis onto n points at equal fractions of its length;
    points beyond the first or last cell centre take that cell's value."""
    size = a.shape[axis]
    pos = np.clip((np.arange(n) + 0.5) / n * size - 0.5, 0, size - 1)
    i = np.minimum(np.floor(pos).astype(int), max(size - 2, 0))
    t = (pos - i).reshape([n if k == axis % a.ndim else 1 for k in range(a.ndim)])
    lo = np.take(a, i, axis=axis)
    hi = np.take(a, np.minimum(i + 1, size - 1), axis=axis)
    return lo + (hi - lo) * t


def to_street_grid(field: np.ndarray, rows: int = FIELD_ROWS, cols: int = FIELD_COLS) -> np.ndarray:
    """Bilinear resampling of a street's cell-centred fields (last two axes: H x W cells) onto
    rows x cols points at equal fractions of H and W."""
    return _resample(_resample(field, rows, -2), cols, -1)


def run_batch(designs: list[Design], schmidt: float, plan: Plan, seeds: list[int]) -> dict:
    """Run designs that share one street shape side by side; per-run arrays, leading axis n."""
    import jax.numpy as jnp

    from .solver2d import core

    aspect = designs[0].aspect
    if any(d.aspect != aspect for d in designs):
        raise ValueError("a batch shares one street shape")
    h = plan.height
    g = cases.canyon_geometry(h, aspect)
    width_h = g.width / g.height
    case = live_case(g, schmidt)
    cfg = core.make_config(case.domain, case.params, jnp, np.float32)
    cfg.pop("drag")
    drags = np.stack([cases.crown_drag(g, elements(d, width_h)) for d in designs])
    r = plan.run.at(h)
    half = r.average // r.every // 2
    first, second, totals, healthy = _program(r.spin_up, half, r.every)(
        jnp.asarray(drags, jnp.float32), jnp.asarray(initial_states(case, seeds)), cfg
    )
    first, second = np.asarray(first) / half, np.asarray(second) / half
    totals, healthy = np.asarray(totals), np.asarray(healthy)

    x0, x1 = g.street
    scale = np.array([U_REF * h / SOURCE_TOTAL, 1 / U_REF, 1 / U_REF, 1 / U_REF])
    # channels c+, u_x, u_y, speed -> the stored order c+, speed, u_x, u_y
    order = [0, 3, 1, 2]
    halves = np.stack([first, second], axis=1)[:, :, order, :h, x0:x1]
    halves *= scale[order][None, None, :, None, None]
    band = halves[:, :, :2][..., band_rows(h), :].mean(axis=-2)  # (n, half, [c+, speed], W)
    mean = halves.mean(axis=1)
    fields = to_street_grid(mean).astype(np.float16)
    pav = pavements(band, g.width, h, trees.PAVEMENT_WIDTH)  # (n, half, 2, side)
    with np.errstate(divide="ignore", invalid="ignore"):
        drift = (totals[:, 1] - totals[:, 0]) / totals[:, 1]
    blocks = [elements(d, width_h) for d in designs]
    return {
        "aspect_grid": np.full(len(designs), g.aspect),
        "width_cells": np.full(len(designs), g.width),
        "healthy": healthy & np.isfinite(halves).all(axis=(1, 2, 3, 4)),
        "drift": drift,
        "exposure": pav[:, :, 0],  # c+ on pavements A and B, per half
        "wind": pav[:, :, 1],  # speed / u_ref on pavements A and B, per half
        "band": band,
        "fields": fields,
        "features": np.stack([features(g.aspect, b) for b in blocks]),
        "blocks": np.array(
            [
                [[c.x0, c.x1, c.z0, c.z1, c.lam_h] for c in b] + [[0.0] * 5] * (2 - len(b))
                for b in blocks
            ]
        ),
    }


def _design_arrays(designs: list[Design]) -> dict[str, np.ndarray]:
    cols = {k: np.array([getattr(d, k) for d in designs]) for k in Design.__dataclass_fields__}
    cols["kind"] = np.array([KINDS.index(d.kind) for d in designs], dtype=np.int8)
    return cols


def _concat(parts: list[dict]) -> dict[str, np.ndarray]:
    out = {}
    for key in parts[0]:
        arrays = [p[key] for p in parts]
        if key == "band":  # pad the column axis to the widest street
            w = max(a.shape[-1] for a in arrays)
            arrays = [
                np.pad(a, [(0, 0)] * (a.ndim - 1) + [(0, w - a.shape[-1])], constant_values=np.nan)
                for a in arrays
            ]
        out[key] = np.concatenate(arrays)
    return out


def run_block(
    name: str, designs: list[Design], schmidt: float, plan: Plan, seed: int, log=None
) -> tuple[dict[str, np.ndarray], list[dict]]:
    """Every street shape of a block in turn; returns the arrays and the time of each batch."""
    log = log or _print
    by_shape: dict[float, list[int]] = {}
    for i, d in enumerate(designs):
        by_shape.setdefault(d.aspect, []).append(i)
    parts, timings = [], []
    for aspect, idx in by_shape.items():
        t0 = time.time()
        batch = [designs[i] for i in idx]
        seeds = [seed * 100_000 + i for i in idx]
        out = run_batch(batch, schmidt, plan, seeds)
        out.update({k: v for k, v in _design_arrays(batch).items()})
        out["index"] = np.array(idx)
        out["init_seed"] = np.array(seeds)
        parts.append(out)
        dt = time.time() - t0
        g = cases.canyon_geometry(plan.height, aspect)
        r = plan.run.at(plan.height)
        cells = len(batch) * g.nx * g.top * (r.spin_up + r.average)
        timings.append(
            {"aspect": aspect, "runs": len(batch), "seconds": round(dt, 2), "cell_updates": cells}
        )
        ok = int(out["healthy"].sum())
        log(
            f"  {name} H/W {aspect}: {ok}/{len(batch)} healthy, {dt:.0f}s, "
            f"{cells / dt / 1e9:.2f} G cell updates/s"
        )
    data = _concat(parts)
    order = np.argsort(data["index"])
    return {k: v[order] for k, v in data.items()}, timings


def block_names(plan: Plan, count: int) -> list[tuple[str, tuple[float, ...], int]]:
    """(file stem, street shapes, seed) of the test block, the out-of-distribution block and
    `count` training blocks, in the order they run."""
    out = [("test", plan.aspects, plan.seed + 1), ("ood", plan.ood_aspects, plan.seed + 2)]
    out += [(f"train_{k:03d}", plan.aspects, plan.seed + 100 + k) for k in range(count)]
    return out


def _print(line: str) -> None:
    print(line, flush=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(out: Path, plan: Plan, schmidt: float, budget_s: float, max_blocks: int = 50, log=None):
    """Run blocks into `out` until the budget is spent; finished blocks found there are kept."""
    log = log or _print
    out.mkdir(parents=True, exist_ok=True)
    progress_path = out / "progress.json"
    progress = json.loads(progress_path.read_text()) if progress_path.exists() else {"blocks": {}}
    progress.update({"plan": _plan_dict(plan), "schmidt": schmidt})
    started = time.time()
    last = None
    for stem, aspects, seed in block_names(plan, max_blocks):
        path = out / f"{stem}.npz"
        if path.exists() and stem in progress["blocks"]:
            continue
        elapsed = time.time() - started
        if stem.startswith("train") and stem != "train_000" and last and elapsed + last > budget_s:
            log(f"budget: {elapsed / 60:.0f} min spent, a block takes {last / 60:.0f}; stopping")
            break
        log(f"block {stem}: {len(aspects)} street shapes, seed {seed}")
        t0 = time.time()
        data, timings = run_block(stem, sample_block(plan, aspects, seed), schmidt, plan, seed, log)
        np.savez_compressed(path, **data)
        took = time.time() - t0
        if len(aspects) == len(plan.aspects):
            last = took
        progress["blocks"][stem] = {
            "seed": seed,
            "runs": len(data["healthy"]),
            "healthy": int(data["healthy"].sum()),
            "seconds": round(took, 1),
            "batches": timings,
            "sha256": sha256(path),
        }
        progress_path.write_text(json.dumps(progress, indent=1) + "\n")
    return progress


def _plan_dict(plan: Plan) -> dict:
    d = asdict(plan)
    d["batch"] = plan.batch
    return d


def load(out: Path, stems: list[str] | None = None) -> dict[str, dict[str, np.ndarray]]:
    """The finished blocks in a run folder, by stem."""
    paths = sorted(out.glob("*.npz"))
    data = {}
    for p in paths:
        if stems is None or p.stem in stems:
            with np.load(p) as z:
                data[p.stem] = {k: z[k] for k in z.files}
    return data


def bare_table(blocks: dict[str, dict[str, np.ndarray]]) -> dict[float, dict]:
    """The bare street at each shape, averaged over every healthy bare run in the blocks given:
    c+ and wind on both pavements, the spread between runs, and the band for other widths."""
    table: dict[float, dict] = {}
    for data in blocks.values():
        bare = (data["kind"] == 0) & data["healthy"]
        for a in np.unique(data["aspect"][bare]):
            m = bare & (data["aspect"] == a)
            row = table.setdefault(float(a), {"exposure": [], "wind": [], "band": []})
            row["exposure"] += list(data["exposure"][m].mean(axis=1))
            row["wind"] += list(data["wind"][m].mean(axis=1))
            # Padding columns are NaN in both halves and are cut off by width_cells.
            row["band"] += list(data["band"][m].mean(axis=1))
            row["width_cells"] = int(data["width_cells"][m][0])
            row["aspect_grid"] = float(data["aspect_grid"][m][0])
    return table


def noise(data: dict[str, np.ndarray]) -> dict:
    """How much the pavement averages move between the halves of the window.

    For a run, |h1 - h2| / (h1 + h2) estimates the standard error of the full-window mean as a
    share of it, if the two halves are independent (the window is much longer than the time the
    street takes to forget).
    """
    ok = data["healthy"] & (data["kind"] > 0)
    out = {}
    for key in ("exposure", "wind"):
        h = data[key][ok]  # (n, half, side)
        rel = np.abs(h[:, 0] - h[:, 1]) / (h[:, 0] + h[:, 1])
        out[key] = {
            "median": round(float(np.median(rel)), 4),
            "p90": round(float(np.quantile(rel, 0.9)), 4),
        }
    return out


def summary(out: Path) -> dict:
    """What a finished run holds, for results/dataset/summary.json (numbers only, no arrays)."""
    progress = json.loads((out / "progress.json").read_text())
    blocks = load(out)
    train = {k: v for k, v in blocks.items() if k.startswith("train")}
    table = bare_table(train)
    plan = progress["plan"]
    counts = {}
    for stem, data in blocks.items():
        kind = data["kind"]
        counts[stem] = {
            "runs": len(kind),
            "healthy": int(data["healthy"].sum()),
            **{k: int((kind == i).sum()) for i, k in enumerate(KINDS)},
        }
    batches = [b for blk in progress["blocks"].values() for b in blk["batches"]]
    seconds = sum(b["seconds"] for b in batches)
    updates = sum(b["cell_updates"] for b in batches)
    train_all = _concat(list(train.values())) if train else None
    return {
        "name": "Surrogate training data: the live street over many designs",
        "method": (
            f"2D street at {plan['height']} cells per building height, the live app's settings "
            f"(uniform inflow {U_REF}, Re {REYNOLDS:g}, Cs {SMAGORINSKY}, Sc_t "
            f"{progress['schmidt']}, CODASC lanes closing in with the width, absorbing layers); "
            f"{plan['run']['spin_up']} steps spin-up, {plan['run']['average']} averaged; "
            f"blocks of Latin-hypercube designs, {plan['trees']} with trees, {plan['hedges']} "
            f"with a hedge and {plan['bare']} bare streets per street shape; test, "
            "out-of-distribution and training blocks from separate seeds"
        ),
        "plan": plan,
        "schmidt": progress["schmidt"],
        "blocks": counts,
        "train_runs": int(sum(c["runs"] for k, c in counts.items() if k.startswith("train"))),
        "seconds": round(seconds, 1),
        "cell_updates_per_second": round(updates / seconds) if seconds else None,
        "noise": noise(train_all) if train_all is not None else None,
        "bare": [
            {
                "aspect": a,
                "aspect_grid": round(r["aspect_grid"], 4),
                "width_cells": r["width_cells"],
                "runs": len(r["exposure"]),
                "exposure": [round(float(v), 4) for v in np.mean(r["exposure"], axis=0)],
                "exposure_sd": [round(float(v), 4) for v in np.std(r["exposure"], axis=0)],
                "wind": [round(float(v), 4) for v in np.mean(r["wind"], axis=0)],
                "band_cplus": [
                    round(float(v), 4) for v in np.mean(r["band"], axis=0)[0][: r["width_cells"]]
                ],
                "band_speed": [
                    round(float(v), 4) for v in np.mean(r["band"], axis=0)[1][: r["width_cells"]]
                ],
            }
            for a, r in sorted(table.items())
        ],
        "files": {f"{k}.npz": v["sha256"] for k, v in progress["blocks"].items()},
        "passed": all(c["healthy"] == c["runs"] for c in counts.values()),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m treesvb.dataset")
    sub = p.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run")
    r.add_argument("--out", type=Path, required=True, help="folder for the blocks")
    r.add_argument("--budget-min", type=float, default=100.0, help="stop starting blocks after")
    r.add_argument("--smoke", action="store_true", help="tiny grid and few steps, for CI")
    r.add_argument("--schmidt", type=float, help="Sc_t; default results/trees/calibration.json")
    s = sub.add_parser("summary")
    s.add_argument("out", type=Path)
    s.add_argument("--results", type=Path, help="results root (default: results/)")
    args = p.parse_args(argv)
    if args.command == "run":
        plan = SMOKE if args.smoke else FULL
        schmidt = args.schmidt or results.read("trees/calibration.json")["schmidt"]
        progress = run(args.out, plan, schmidt, args.budget_min * 60, 1 if args.smoke else 50)
        print(json.dumps({k: v["healthy"] for k, v in progress["blocks"].items()}))
        return 0
    payload = summary(args.out)
    kw = {"root": args.results} if args.results else {}
    path = results.write("dataset/summary.json", payload, GENERATED_BY, **kw)
    print(f"{'pass' if payload['passed'] else 'FAIL'}  {path}")
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
