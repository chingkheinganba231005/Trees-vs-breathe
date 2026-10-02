"""Benchmark and street-canyon cases, all in lattice units."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .domain import Domain
from .numpy_solver import Params


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
    """An isolated street canyon: two buildings of height H on a ground plane, cross-wind."""

    height: int  # building height H, cells
    width: int  # street width W, wall to wall, cells
    building: int  # building depth B along the wind, cells
    upstream: int  # ground before the first building, cells
    downstream: int  # ground after the second building, cells
    top: int  # domain height, cells

    @property
    def nx(self) -> int:
        return self.upstream + 2 * self.building + self.width + self.downstream

    @property
    def aspect(self) -> float:
        return self.height / self.width

    @property
    def street(self) -> tuple[int, int]:
        """First and one-past-last column of the street."""
        x0 = self.upstream + self.building
        return x0, x0 + self.width

    def solid(self) -> np.ndarray:
        s = np.zeros((self.top, self.nx), bool)
        a = self.upstream
        b = a + self.building + self.width
        s[: self.height, a : a + self.building] = True
        s[: self.height, b : b + self.building] = True
        return s


def canyon_geometry(
    height: int,
    aspect: float,
    building: float = 1.0,
    upstream: float = 3.0,
    downstream: float = 6.0,
    top: float = 5.0,
) -> CanyonGeometry:
    """Lengths after `aspect` are multiples of the building height (docs/assumptions.md A-002)."""
    return CanyonGeometry(
        height=height,
        width=max(2, round(height / aspect)),
        building=round(building * height),
        upstream=round(upstream * height),
        downstream=round(downstream * height),
        top=round(top * height),
    )


def canyon(
    g: CanyonGeometry,
    u_ref: float = 0.05,
    reynolds: float = 20000.0,
    smagorinsky: float = 0.1,
) -> Case:
    """Uniform inflow over a no-slip ground; the boundary layer grows along the upstream fetch.

    The Reynolds number is u_ref H / nu0 with the molecular viscosity; the Smagorinsky model
    adds eddy viscosity where the grid cannot resolve the flow.
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
    inlet = np.full(g.top, u_ref)
    params = Params(tau0=3.0 * nu + 0.5, smagorinsky=smagorinsky, inlet_u=inlet)
    return Case(f"canyon_h{g.height}_ar{g.aspect:.2f}", d, params, u_ref, g.height)
