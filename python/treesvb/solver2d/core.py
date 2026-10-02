"""The solver step, written once against an array module so NumPy and JAX run the same code.

`cfg` holds everything a step needs as arrays, so a batch of configurations of the same grid
size can be stacked and run with jax.vmap. See numpy_solver.py for the algorithm in words.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .domain import Domain, build_stream_map
from .lattice import CX, CY, OPP, Q, W

SQRT2_18 = 18.0 * np.sqrt(2.0)


def split_stream_map(src: np.ndarray, ny: int, nx: int) -> dict[str, np.ndarray]:
    """Decompose the flat gather map into cheap pieces with identical results.

    Most entries are periodic shifts (np.roll), bounce-back (opposite direction at the node) or a
    node holding its own value; only the remainder (free-slip top, outflow column, moving-lid
    corners) needs a real gather. XLA's CPU gather is slow, so this keeps JAX fast while the map
    in domain.py stays the single definition of the boundary rules.
    """
    n = nx * ny
    src = src.reshape(Q, ny, nx)
    y, x = np.mgrid[0:ny, 0:nx]
    roll = np.zeros((Q, ny, nx), bool)
    bounce = np.zeros((Q, ny, nx), bool)
    hold = np.zeros((Q, ny, nx), bool)
    for i in range(Q):
        rolled = i * n + ((y - CY[i]) % ny) * nx + ((x - CX[i]) % nx)
        roll[i] = src[i] == rolled
        bounce[i] = (src[i] == OPP[i] * n + y * nx + x) & ~roll[i]
        hold[i] = (src[i] == i * n + y * nx + x) & ~roll[i] & ~bounce[i]
    other = ~(roll | bounce | hold)
    return {
        "bounce": bounce,
        "hold": hold,
        "other_dst": np.flatnonzero(other).astype(np.int32),
        "other_src": src.reshape(-1)[other.reshape(-1)].astype(np.int32),
    }


def make_config(domain: Domain, params, xp=np, dtype=np.float64) -> dict[str, Any]:
    ny, nx = domain.ny, domain.nx
    src, add = build_stream_map(domain)
    parts = split_stream_map(src, ny, nx)
    fluid = domain.fluid
    gx, gy = params.gravity
    inlet = np.zeros((ny, nx), bool)
    inlet_u = np.zeros((ny, nx))
    if domain.left == "inlet":
        inlet[:, 0] = True
        inlet_u[:, 0] = np.asarray(params.inlet_u)
    as_f = lambda a: xp.asarray(np.asarray(a, dtype=np.float64), dtype=dtype)  # noqa: E731
    return {
        "bounce": xp.asarray(parts["bounce"]),
        "hold": xp.asarray(parts["hold"]),
        "other_dst": xp.asarray(parts["other_dst"]),
        "other_src": xp.asarray(parts["other_src"]),
        "add": as_f(add),
        "fluid": xp.asarray(fluid),
        "inlet": xp.asarray(inlet),
        "inlet_u": as_f(inlet_u),
        "gx": as_f(np.where(fluid, gx, 0.0)),
        "gy": as_f(np.where(fluid, gy, 0.0)),
        "tau0": as_f(params.tau0),
        "cs": as_f(params.smagorinsky),
    }


def _lin(a: int, x, b: int, y):
    """a x + b y for integer lattice coefficients, without multiplying by 0 or 1."""
    terms = []
    for coef, v in ((a, x), (b, y)):
        if coef == 1:
            terms.append(v)
        elif coef == -1:
            terms.append(-v)
        elif coef != 0:
            terms.append(coef * v)
    if not terms:
        return None
    return terms[0] if len(terms) == 1 else terms[0] + terms[1]


def _moment(f, coef):
    """sum_i coef_i f_i for integer coefficients, skipping zeros."""
    out = None
    for i, k in enumerate(coef):
        if k == 0:
            continue
        term = f[i] if k == 1 else (-f[i] if k == -1 else k * f[i])
        out = term if out is None else out + term
    return out


def equilibrium(xp, rho, ux, uy):
    """Second-order equilibrium, shape (9, *rho.shape)."""
    usq = 1.5 * (ux * ux + uy * uy)
    out = []
    for i in range(Q):
        cu = _lin(int(CX[i]), ux, int(CY[i]), uy)
        if cu is None:
            out.append(W[i] * rho * (1.0 - usq))
        else:
            out.append(W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - usq))
    return xp.stack(out)


def stream(xp, f_post, cfg):
    """Pull streaming; equivalent to f_post.flat[src] + add for the map in domain.py."""
    rolled = xp.stack([xp.roll(f_post[i], (int(CY[i]), int(CX[i])), axis=(0, 1)) for i in range(Q)])
    f = xp.where(cfg["bounce"], f_post[OPP], rolled)
    f = xp.where(cfg["hold"], f_post, f)
    vals = xp.take(f_post.reshape(-1), cfg["other_src"])
    if xp is np:
        f = f.reshape(-1)
        f[cfg["other_dst"]] = vals
    else:
        f = f.reshape(-1).at[cfg["other_dst"]].set(vals)
    return f.reshape(f_post.shape) + cfg["add"]


def macros(xp, f, cfg):
    rho = _moment(f, [1] * Q)
    ux = _moment(f, CX) / rho + 0.5 * cfg["gx"]
    uy = _moment(f, CY) / rho + 0.5 * cfg["gy"]
    return rho, ux, uy


def relaxation_time(xp, f, feq, rho, ux, uy, fx, fy, cfg):
    """Smagorinsky relaxation time; equals tau0 exactly when cs = 0."""
    fneq = f - feq
    # The Guo forcing leaves -(F u + u F) / 2 in the non-equilibrium flux; adding it back makes
    # the flux measure the strain rate alone (tests/python/test_solver2d.py).
    pxx = _moment(fneq, CX * CX) + fx * ux
    pyy = _moment(fneq, CY * CY) + fy * uy
    pxy = _moment(fneq, CX * CY) + 0.5 * (fx * uy + fy * ux)
    q = xp.sqrt(pxx * pxx + pyy * pyy + 2.0 * pxy * pxy)
    tau0, cs = cfg["tau0"], cfg["cs"]
    return 0.5 * (tau0 + xp.sqrt(tau0 * tau0 + SQRT2_18 * cs * cs * q / rho))


def guo_source(xp, tau, ux, uy, fx, fy):
    """(1 - 1/(2 tau)) w_i [3 (c_i - u) + 9 (c_i . u) c_i] . F, shape (9, ...)."""
    pre = 1.0 - 0.5 / tau
    out = []
    for i in range(Q):
        cx, cy = int(CX[i]), int(CY[i])
        cu = _lin(cx, ux, cy, uy)
        ax = 3.0 * (cx - ux) + (9.0 * cx * cu if cu is not None and cx else 0.0)
        ay = 3.0 * (cy - uy) + (9.0 * cy * cu if cu is not None and cy else 0.0)
        out.append(pre * W[i] * (ax * fx + ay * fy))
    return xp.stack(out)


def step(xp, f_post, cfg):
    """One time step; returns (new post-collision state, relaxation time field)."""
    f = stream(xp, f_post, cfg)
    rho, ux, uy = macros(xp, f, cfg)
    fx = rho * cfg["gx"]
    fy = rho * cfg["gy"]
    feq = equilibrium(xp, rho, ux, uy)
    tau = relaxation_time(xp, f, feq, rho, ux, uy, fx, fy, cfg)
    post = f - (f - feq) / tau + guo_source(xp, tau, ux, uy, fx, fy)
    post = xp.where(cfg["fluid"], post, f)
    # Inlet column: equilibrium at the inlet velocity and the previous density of column 1.
    rho_in = f_post[:, :, 1].sum(0)
    u_in = cfg["inlet_u"][:, 0]
    col = xp.where(
        cfg["inlet"][:, 0], equilibrium(xp, rho_in, u_in, xp.zeros_like(u_in)), post[:, :, 0]
    )
    if xp is np:
        post[:, :, 0] = col
    else:
        post = post.at[:, :, 0].set(col)
    return post, tau


def initial_state(xp, cfg, dtype):
    """Fluid at rest with unit density; the inlet column already at its equilibrium."""
    shape = cfg["fluid"].shape
    one = xp.ones(shape, dtype=dtype)
    zero = xp.zeros(shape, dtype=dtype)
    f = equilibrium(xp, one, zero, zero)
    return xp.where(cfg["inlet"], equilibrium(xp, one, cfg["inlet_u"], zero), f)
