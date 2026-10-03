"""NumPy wrapper around the shared step in core.py (CPU, used by the tests).

One step, identical in every implementation (docs/solver.md):

1. Stream (pull) through the precomputed map: f = f_post.flat[src] + add.
2. Macroscopic fields: rho = sum f, rho u = sum f c + F / 2 (Guo, Zheng and Shi 2002).
3. Relaxation time: tau0, or with the Smagorinsky model (Hou et al. 1994)
   tau = (tau0 + sqrt(tau0^2 + 18 sqrt(2) Cs^2 sqrt(P:P) / rho)) / 2,
   where P is the non-equilibrium momentum flux corrected for the force.
4. Regularised collision (Latt and Chopard 2006) with the Guo forcing term:
   f_post = feq + (1 - 1 / tau) w_i 9/2 (c_i c_i - I/3) : P_d
            + w_i [3 (c_i - u) + 9 (c_i . u) c_i] . F / 2,
   with P_d the trace-free part of the corrected flux of step 3. Shear stress relaxes as in BGK;
   the higher moments and the bulk stress relax fully (core.regularised_neq, docs/solver.md).
5. Absorbing layers relax the density towards 1 near open boundaries:
   f_post += sigma (1 - rho) / rho f_eq(rho, u)   (Xu and Sagaut 2013).
6. Non-fluid nodes keep their value; the inlet column is set to the equilibrium at the inlet
   velocity and its neighbour's previous density, the outlet column to the equilibrium at density
   1 and its neighbour's previous velocity.

Crowns and hedges add the drag F = -(lambda / 2) rho |u| u to the force in steps 2-4, with the
velocity of step 2 solved implicitly (core.macros). An optional tracer (traffic fumes) is carried
on a D2Q5 lattice with the velocity and eddy viscosity of the same step (core.tracer_step).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import core
from .domain import Domain


@dataclass(frozen=True)
class Tracer:
    #: Amount added per step per node, shape (ny, nx); the line sources of the street.
    source: np.ndarray
    #: Molecular diffusivity in lattice units.
    diffusivity: float
    #: Turbulent Schmidt number: the eddy diffusivity is nu_t / schmidt.
    schmidt: float


@dataclass(frozen=True)
class Params:
    #: Molecular relaxation time; viscosity nu0 = (tau0 - 1/2) / 3.
    tau0: float
    #: Smagorinsky constant Cs; 0 switches the sub-grid model off.
    smagorinsky: float = 0.0
    #: Uniform body force per unit mass (gx, gy) on fluid nodes.
    gravity: tuple[float, float] = (0.0, 0.0)
    #: Inlet x-velocity profile, shape (ny,), for a domain with a left inlet.
    inlet_u: np.ndarray | None = None
    #: Absorbing layers (sigma_max, inlet, outlet, top lengths in cells); see core.sponge_field.
    sponge: tuple[float, int, int, int] = (0.0, 0, 0, 0)
    #: Pressure-loss coefficient lambda per node in 1/cell (crowns, hedges); None for no drag.
    drag: np.ndarray | None = None
    #: Passive tracer carried with the flow; None for flow only.
    tracer: Tracer | None = None

    @property
    def nu0(self) -> float:
        return (self.tau0 - 0.5) / 3.0


class NumpySolver:
    def __init__(self, domain: Domain, params: Params, dtype=np.float64, regularise: bool = True):
        if domain.left == "inlet" and (params.inlet_u is None or len(params.inlet_u) != domain.ny):
            raise ValueError("a left inlet needs params.inlet_u with one value per row")
        self.domain = domain
        self.params = params
        self.dtype = np.dtype(dtype)
        #: False runs plain BGK, for the collision benchmark only.
        self.regularise = regularise
        if not regularise and params.tracer is not None:
            raise ValueError("plain BGK is kept for the flow-only collision benchmark")
        self.cfg = core.make_config(domain, params, np, self.dtype)
        self.fluid = domain.fluid
        self.f_post = core.initial_state(np, self.cfg, self.dtype)
        self.tau = np.full((domain.ny, domain.nx), params.tau0, self.dtype)
        self.g_post = None
        if params.tracer is not None:
            self.g_post = np.zeros((core.Q5, domain.ny, domain.nx), self.dtype)
        self.time = 0

    def set_state(self, rho, ux, uy) -> None:
        """Start from the equilibrium of the given fields."""
        self.f_post = core.equilibrium(np, *(np.asarray(a, self.dtype) for a in (rho, ux, uy)))

    def step(self, n: int = 1) -> None:
        for _ in range(n):
            if self.g_post is None:
                self.f_post, tau = core.step(np, self.f_post, self.cfg, self.regularise)
            else:
                (self.f_post, self.g_post), tau = core.coupled_step(
                    np, (self.f_post, self.g_post), self.cfg
                )
            self.time += 1
        self.tau = np.broadcast_to(tau, self.tau.shape)

    def concentration(self) -> np.ndarray:
        return core.concentration(np, self.g_post, self.cfg)

    def total_tracer(self) -> float:
        return float(self.g_post[:, self.fluid].sum())

    def pre_collision(self) -> np.ndarray:
        return core.stream(np, self.f_post, self.cfg)

    def macros(self, f: np.ndarray | None = None):
        """rho, ux, uy of the state that the next collision will see."""
        return core.macros(np, self.pre_collision() if f is None else f, self.cfg)

    def max_speed(self) -> float:
        _, ux, uy = self.macros()
        return float(np.sqrt(ux * ux + uy * uy)[self.fluid].max())

    def healthy(self, limit: float = 0.4) -> bool:
        """False on NaN or a speed beyond what the lattice can represent."""
        return bool(np.isfinite(self.f_post).all()) and self.max_speed() < limit

    def total_mass(self) -> float:
        return float(self.f_post[:, self.fluid].sum())
