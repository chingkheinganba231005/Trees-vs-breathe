"""JAX wrapper around the shared step in core.py: jit-compiled, and batchable with vmap.

The same code path as NumpySolver, so the two agree to round-off in float64. Float32 is the
default for speed and matches the browser solvers' precision.
"""

from __future__ import annotations

from functools import partial

import jax
import jax.numpy as jnp
import numpy as np

from . import core
from .domain import Domain


@partial(jax.jit, static_argnums=2)
def run(f_post, cfg, n: int):
    """Advance n steps; compiled once per grid shape and n."""

    def body(_, f):
        return core.step(jnp, f, cfg)[0]

    return jax.lax.fori_loop(0, n, body, f_post)


@partial(jax.jit, static_argnums=2)
def run_coupled(state, cfg, n: int):
    """Advance flow and tracer n steps; state is (f_post, g_post)."""

    def body(_, s):
        return core.coupled_step(jnp, s, cfg)[0]

    return jax.lax.fori_loop(0, n, body, state)


@jax.jit
def _concentration(g_post, cfg):
    return core.concentration(jnp, g_post, cfg)


@jax.jit
def _macros(f_post, cfg):
    return core.macros(jnp, core.stream(jnp, f_post, cfg), cfg)


@jax.jit
def _tau(f_post, cfg):
    return core.step(jnp, f_post, cfg)[1]


def run_batch(f_posts, cfgs, n: int):
    """Advance a stack of configurations (leading axis) by n steps in one call."""
    return jax.vmap(lambda f, c: run(f, c, n))(f_posts, cfgs)


class JaxSolver:
    def __init__(self, domain: Domain, params, dtype=np.float32):
        if np.dtype(dtype) == np.float64 and not jax.config.jax_enable_x64:
            raise ValueError("float64 needs jax.config.update('jax_enable_x64', True)")
        self.domain = domain
        self.params = params
        self.dtype = dtype
        self.cfg = core.make_config(domain, params, jnp, dtype)
        self.fluid = domain.fluid
        self.f_post = core.initial_state(jnp, self.cfg, dtype)
        self.g_post = None
        if getattr(params, "tracer", None) is not None:
            self.g_post = jnp.zeros((core.Q5, domain.ny, domain.nx), dtype)
        self.time = 0

    def set_state(self, rho, ux, uy) -> None:
        """Start from the equilibrium of the given fields."""
        self.f_post = core.equilibrium(jnp, *(jnp.asarray(a, self.dtype) for a in (rho, ux, uy)))

    def step(self, n: int = 1) -> None:
        if self.g_post is None:
            self.f_post = run(self.f_post, self.cfg, n)
        else:
            self.f_post, self.g_post = run_coupled((self.f_post, self.g_post), self.cfg, n)
        self.time += n

    def concentration(self) -> np.ndarray:
        return np.asarray(_concentration(self.g_post, self.cfg))

    def total_tracer(self) -> float:
        return float(np.asarray(self.g_post)[:, self.fluid].sum())

    def macros(self):
        rho, ux, uy = _macros(self.f_post, self.cfg)
        return np.asarray(rho), np.asarray(ux), np.asarray(uy)

    @property
    def tau(self) -> np.ndarray:
        return np.broadcast_to(np.asarray(_tau(self.f_post, self.cfg)), self.fluid.shape)

    def max_speed(self) -> float:
        _, ux, uy = self.macros()
        return float(np.sqrt(ux * ux + uy * uy)[self.fluid].max())

    def healthy(self, limit: float = 0.4) -> bool:
        return bool(np.isfinite(np.asarray(self.f_post)).all()) and self.max_speed() < limit

    def total_mass(self) -> float:
        return float(np.asarray(self.f_post)[:, self.fluid].sum())
