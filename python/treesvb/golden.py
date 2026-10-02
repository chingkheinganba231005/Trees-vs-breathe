"""Golden outputs that the browser solvers must reproduce (BRIEF.md section 5.2).

    python -m treesvb.golden          # rewrite tests/golden/*.json
    python -m treesvb.golden --check  # fail if the committed files differ from a fresh run

Each file holds a complete case description (domain, parameters, initial state, step count)
and the NumPy float64 result, so the TypeScript and WGSL tests rebuild the case from the file
alone. Grids are small so the files stay small and the tests fast.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from .solver2d import NumpySolver, build_stream_map, cases
from .solver2d.cases import Case

GOLDEN = Path(__file__).resolve().parents[2] / "tests" / "golden"


@dataclass(frozen=True)
class GoldenCase:
    name: str
    case: Case
    steps: int
    #: Optional initial velocity (ux, uy); rest otherwise.
    initial: tuple[np.ndarray, np.ndarray] | None = None
    description: str = ""


def _couette_start(c: Case):
    u = np.tile(cases.couette_exact(c)[:, None], (1, c.domain.nx))
    return u, np.zeros_like(u)


def golden_cases() -> list[GoldenCase]:
    couette = cases.couette(10, tau=0.51, lid=0.05, smagorinsky=0.17)
    p = cases.poiseuille(12)
    p_smag = replace(
        p, params=replace(p.params, tau0=0.52, smagorinsky=0.2), name="poiseuille_smag"
    )
    canyon = cases.canyon(cases.canyon_geometry(6, 1.0))
    deep = cases.canyon(cases.canyon_geometry(6, 2.0), reynolds=5000.0)
    g = cases.canyon_geometry(6, 1.0)
    trees = cases.canyon(
        g,
        u_ref=0.05,
        reynolds=2000.0,
        smagorinsky=0.17,
        exponent=0.3,
        # The dense CODASC crown at W/H 1: lambda 200 1/m times H 0.12 m (docs/codasc.md).
        crowns=(cases.Crown(0.25, 0.75, 1 / 3, 1.0, 24.0),),
        sources=cases.line_sources(g, (-0.267, -0.15, 0.15, 0.267), 1e-3),
        schmidt=0.7,
    )
    return [
        GoldenCase("cavity", cases.cavity(16, 100), 400, None, "Moving lid, bounce-back walls"),
        GoldenCase("poiseuille", p, 600, None, "Body force with Guo forcing"),
        GoldenCase("poiseuille_smag", p_smag, 600, None, "Body force with the Smagorinsky model"),
        GoldenCase(
            "couette_smag", couette, 200, _couette_start(couette), "Smagorinsky in uniform shear"
        ),
        GoldenCase(
            "canyon",
            canyon,
            300,
            cases.uniform_start(canyon)[1:],
            "Inlet, pressure outlet, free-slip top, buildings, absorbing layers",
        ),
        GoldenCase("canyon_deep", deep, 300, cases.uniform_start(deep)[1:], "Deep street, H/W = 2"),
        GoldenCase(
            "street_trees",
            trees,
            300,
            cases.uniform_start(trees)[1:],
            "Power-law inflow, a porous crown, line sources and the D2Q5 tracer",
        ),
    ]


def _num(a: np.ndarray, digits: int = 12) -> list[float]:
    return [float(f"{v:.{digits}g}") for v in np.asarray(a, np.float64).reshape(-1)]


def domain_spec(c: Case) -> dict:
    d = c.domain
    return {
        "nx": d.nx,
        "ny": d.ny,
        "left": d.left,
        "right": d.right,
        "bottom": d.bottom,
        "top": d.top,
        "lidVelocity": d.lid_velocity,
        # One string per row, bottom row first: '1' marks a solid cell.
        "solid": ["".join("1" if s else "0" for s in row) for row in d.solid],
    }


def render(g: GoldenCase) -> dict:
    c = g.case
    s = NumpySolver(c.domain, c.params)
    if g.initial is not None:
        ux, uy = g.initial
        s.set_state(np.ones_like(ux), ux, uy)
    s.step(g.steps)
    rho, ux, uy = s.macros()
    src, add = build_stream_map(c.domain)
    params = c.params
    extra: dict = {}
    if params.drag is not None:
        extra["drag"] = _num(params.drag)
    if params.tracer is not None:
        extra["tracer"] = {
            "source": _num(params.tracer.source),
            "diffusivity": float(params.tracer.diffusivity),
            "schmidt": float(params.tracer.schmidt),
        }
    result = {"c": _num(s.concentration())} if params.tracer is not None else {}
    return {
        "name": g.name,
        "description": g.description,
        "generated_by": "python -m treesvb.golden (NumPy, float64)",
        "domain": domain_spec(c),
        "params": {
            "tau0": params.tau0,
            "smagorinsky": params.smagorinsky,
            "gx": params.gravity[0],
            "gy": params.gravity[1],
            "inletU": None if params.inlet_u is None else _num(params.inlet_u),
            "sponge": [float(params.sponge[0]), *map(int, params.sponge[1:])],
            **extra,
        },
        "initial": None
        if g.initial is None
        else {"ux": _num(g.initial[0]), "uy": _num(g.initial[1])},
        "steps": g.steps,
        "uRef": c.u_ref,
        "streamMap": {"src": src.reshape(-1).tolist(), "add": _num(add)},
        "rho": _num(rho),
        "ux": _num(ux),
        "uy": _num(uy),
        **result,
    }


def _same(a, b, tol: float = 1e-9) -> bool:
    """Equal up to round-off, so the check does not depend on the last printed digit."""
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k], tol) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y, tol) for x, y in zip(a, b, strict=True))
    if isinstance(a, float) or isinstance(b, float):
        return abs(a - b) <= tol * max(1.0, abs(a), abs(b))
    return a == b


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m treesvb.golden")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    GOLDEN.mkdir(parents=True, exist_ok=True)
    stale = []
    for g in golden_cases():
        text = json.dumps(render(g), separators=(",", ":")) + "\n"
        path = GOLDEN / f"{g.name}.json"
        if args.check:
            if not path.exists() or not _same(json.loads(path.read_text()), json.loads(text)):
                stale.append(path.name)
        else:
            path.write_text(text)
            print(f"wrote {path.relative_to(GOLDEN.parents[1])} ({len(text) // 1024} KB)")
    for name in stale:
        print(f"out of date: tests/golden/{name} (run python -m treesvb.golden)")
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main())
