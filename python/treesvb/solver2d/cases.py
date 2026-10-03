"""Benchmark and street-canyon cases, all in lattice units."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .domain import Domain
from .numpy_solver import Params, Tracer

#: Absorbing-layer strength chosen in results/street/sponge.json.
SPONGE_SIGMA = 0.05


@dataclass(frozen=True)
class Case:
    name: str
    domain: Domain
    params: Params
    #: Reference velocity and length for the Reynolds number, lattice units.
    u_ref: float
    l_ref: float

    @property
    def reynolds(self) -> float:
        return self.u_ref * self.l_ref / self.params.nu0


def poiseuille(height: int, tau: float = 0.8, u_max: float = 0.05, nx: int = 4) -> Case:
    """Body-force-driven channel between two half-way bounce-back walls.

    The walls sit half a cell outside the first and last rows, so the channel width is `height`.
    """
    nu = (tau - 0.5) / 3.0
    g = 8.0 * nu * u_max / height**2
    d = Domain(nx=nx, ny=height, left="periodic", right="periodic", bottom="wall", top="wall")
    return Case(f"poiseuille_h{height}", d, Params(tau0=tau, gravity=(g, 0.0)), u_max, height)


def poiseuille_exact(height: int, case: Case) -> np.ndarray:
    nu = case.params.nu0
    g = case.params.gravity[0]
    y = np.arange(height) + 0.5
    return g / (2.0 * nu) * y * (height - y)


def couette(height: int, tau: float, lid: float = 0.05, smagorinsky: float = 0.0) -> Case:
    """Shear between a resting floor and a moving lid; linear profile for any viscosity."""
    d = Domain(
        nx=4,
        ny=height,
        left="periodic",
        right="periodic",
        bottom="wall",
        top="moving",
        lid_velocity=lid,
    )
    return Case(f"couette_h{height}", d, Params(tau0=tau, smagorinsky=smagorinsky), lid, height)


def couette_exact(case: Case) -> np.ndarray:
    h = case.domain.ny
    return case.u_ref * (np.arange(h) + 0.5) / h


def cavity(n: int, reynolds: float, lid: float = 0.1, smagorinsky: float = 0.0) -> Case:
    """Lid-driven square cavity with n x n nodes; walls half a cell outside, so L = n."""
    nu = lid * n / reynolds
    d = Domain(nx=n, ny=n, left="wall", right="wall", bottom="wall", top="moving", lid_velocity=lid)
    params = Params(tau0=3.0 * nu + 0.5, smagorinsky=smagorinsky)
    return Case(f"cavity_n{n}_re{reynolds:g}", d, params, lid, n)


@dataclass(frozen=True)
class CanyonGeometry:
    """A street canyon in a row of equal blocks on a ground plane, wind across the street.

    The street studied is the last of `streets` equal streets. In 2D the vortex shed from the
    upwind edge of the first block stays over the streets close behind it and turns their mean
    vortex the wrong way (results/street/upwind.json); see upwind_streets for how many streets
    go in front of the studied one.
    """

    height: int  # building height H, cells
    width: int  # street width W, wall to wall, cells
    building: int  # building depth B along the wind, cells
    upstream: int  # ground before the first building, cells
    downstream: int  # ground after the last building, cells
    top: int  # domain height, cells
    streets: int = 2  # streets in the row; the last one is studied

    @property
    def nx(self) -> int:
        return (
            self.upstream
            + (self.streets + 1) * self.building
            + self.streets * self.width
            + self.downstream
        )

    @property
    def aspect(self) -> float:
        return self.height / self.width

    @property
    def street(self) -> tuple[int, int]:
        """First and one-past-last column of the studied street."""
        x0 = self.upstream + self.streets * self.building + (self.streets - 1) * self.width
        return x0, x0 + self.width

    def solid(self) -> np.ndarray:
        s = np.zeros((self.top, self.nx), bool)
        for k in range(self.streets + 1):
            a = self.upstream + k * (self.building + self.width)
            s[: self.height, a : a + self.building] = True
        return s


#: The studied street's upwind wall stands at least this many building heights behind the
#: row's upwind edge; one street upwind at H/W 1 (3 H) gave the skimming flow, none (1 H) did
#: not (results/street/upwind.json).
CLEAR_OF_LEADING_EDGE = 3


def upwind_streets(height: int, width: int, building: int) -> int:
    """Streets in front of the studied one: at least one, and enough to clear the leading edge.

    Integer arithmetic in cells, so apps/web/src/sim/street.ts gets the same answer.
    """
    need = CLEAR_OF_LEADING_EDGE * height - building
    return max(1, -(-need // (building + width)))


def canyon_geometry(
    height: int,
    aspect: float,
    building: float = 1.0,
    upstream: float = 3.0,
    downstream: float = 6.0,
    top: float = 5.0,
    streets: int | None = None,
) -> CanyonGeometry:
    """Lengths after `aspect` are multiples of the building height (docs/assumptions.md A-002).

    `streets` defaults to the studied street plus upwind_streets in front of it.
    """
    width = max(2, round(height / aspect))
    b = round(building * height)
    return CanyonGeometry(
        height=height,
        width=width,
        building=b,
        upstream=round(upstream * height),
        downstream=round(downstream * height),
        top=round(top * height),
        streets=streets if streets is not None else 1 + upwind_streets(height, width, b),
    )


@dataclass(frozen=True)
class Crown:
    """A porous block (tree crowns or a hedge) in a street, in units of the building height H.

    x is measured from the upwind wall of the street, z from the ground. `lam_h` is the
    pressure-loss coefficient lambda (CODASC's definition, Delta p / (p_dyn d)) times H, so the
    same crown can be placed on any grid.
    """

    x0: float
    x1: float
    z0: float
    z1: float
    lam_h: float


def _overlap(lo: np.ndarray, a: float, b: float) -> np.ndarray:
    """Length of [lo, lo + 1) inside [a, b)."""
    return np.clip(np.minimum(lo + 1.0, b) - np.maximum(lo, a), 0.0, 1.0)


def crown_drag(g: CanyonGeometry, crowns) -> np.ndarray:
    """lambda per cell in 1/cell, weighted by the fraction of the cell inside each crown.

    Weighting by area keeps the total drag of a crown independent of how it falls on the grid.
    """
    drag = np.zeros((g.top, g.nx))
    x = np.arange(g.nx, dtype=np.float64) - g.street[0]
    z = np.arange(g.top, dtype=np.float64)
    h = float(g.height)
    for c in crowns:
        fx = _overlap(x, c.x0 * h, c.x1 * h)
        fz = _overlap(z, c.z0 * h, c.z1 * h)
        drag += np.outer(fz, fx) * (c.lam_h / h)
    return np.where(g.solid(), 0.0, drag)


def line_sources(g: CanyonGeometry, offsets, total: float) -> np.ndarray:
    """Ground-level sources at the given distances from the street axis (units of H).

    Each source gets total / len(offsets) per step, shared linearly between the two cells whose
    centres bracket it, so its centroid sits exactly at the requested position.
    """
    src = np.zeros((g.top, g.nx))
    centre = g.street[0] + 0.5 * g.width
    for off in offsets:
        pos = centre + off * g.height - 0.5  # in cell-centre coordinates
        i = int(np.floor(pos))
        w = pos - i
        src[0, i] += (1.0 - w) * total / len(offsets)
        src[0, i + 1] += w * total / len(offsets)
    return src


def power_law(g: CanyonGeometry, u_h: float, exponent: float) -> np.ndarray:
    """Inflow u(z) = u_H (z / H)^exponent at the cell centres; exponent 0 is uniform."""
    z = (np.arange(g.top) + 0.5) / g.height
    return u_h * z**exponent


def canyon(
    g: CanyonGeometry,
    u_ref: float = 0.05,
    reynolds: float = 20000.0,
    smagorinsky: float = 0.1,
    exponent: float = 0.0,
    crowns=(),
    sources: np.ndarray | None = None,
    schmidt: float = 1.0,
) -> Case:
    """Inflow over a no-slip ground; the boundary layer grows along the upstream fetch.

    The inflow is u_ref (z / H)^exponent, so u_ref is the approach-flow speed at roof height;
    exponent 0 gives uniform inflow. The Reynolds number is u_ref H / nu0 with the molecular
    viscosity; the Smagorinsky model adds eddy viscosity where the grid cannot resolve the flow.
    `crowns` add porous drag; `sources` (amount per step per node) switch the tracer on, with
    eddy diffusivity nu_t / schmidt plus a molecular diffusivity equal to nu0.
    """
    nu = u_ref * g.height / reynolds
    d = Domain(
        nx=g.nx,
        ny=g.top,
        left="inlet",
        right="outlet",
        bottom="wall",
        top="freeslip",
        solid=g.solid(),
    )
    inlet = power_law(g, u_ref, exponent)
    # Absorbing layers one building height deep at the inlet and the top, two at the outlet,
    # where the wake is still turbulent (strength from results/street/sponge.json).
    sponge = (SPONGE_SIGMA, g.height, 2 * g.height, g.height)
    drag = crown_drag(g, crowns) if crowns else None
    tracer = None if sources is None else Tracer(sources, nu, schmidt)
    params = Params(
        tau0=3.0 * nu + 0.5,
        smagorinsky=smagorinsky,
        inlet_u=inlet,
        sponge=sponge,
        drag=drag,
        tracer=tracer,
    )
    return Case(f"canyon_h{g.height}_ar{g.aspect:.2f}", d, params, u_ref, g.height)


def uniform_start(case: Case) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit density and the inflow profile everywhere outside buildings.

    Starting the inflow from rest sends a pressure pulse of about u / c_s through the domain;
    starting from the inflow avoids it. For uniform inflow every open node gets u_ref.
    """
    d = case.domain
    open_ = ~d.solid
    ux = np.where(open_, np.asarray(case.params.inlet_u)[:, None], 0.0)
    return np.ones((d.ny, d.nx)), ux, np.zeros((d.ny, d.nx))
