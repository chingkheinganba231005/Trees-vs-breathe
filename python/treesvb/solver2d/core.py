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

# D2Q5 for the tracer: directions 0-4 of the D2Q9 order, rest weight 1/3, c_s^2 = 1/3.
Q5 = 5
W5 = np.array([1 / 3] + [1 / 6] * 4)


def split_stream_map(src: np.ndarray, ny: int, nx: int, q: int = Q) -> dict[str, np.ndarray]:
    """Decompose the flat gather map into cheap pieces with identical results.

    Most entries are periodic shifts (np.roll), bounce-back (opposite direction at the node) or a
    node holding its own value; only the remainder (free-slip top, outflow column, moving-lid
    corners) needs a real gather. XLA's CPU gather is slow, so this keeps JAX fast while the map
    in domain.py stays the single definition of the boundary rules.
    """
    n = nx * ny
    src = src.reshape(q, ny, nx)
    y, x = np.mgrid[0:ny, 0:nx]
    roll = np.zeros((q, ny, nx), bool)
    bounce = np.zeros((q, ny, nx), bool)
    hold = np.zeros((q, ny, nx), bool)
    for i in range(q):
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
    outlet = np.zeros((ny, nx), bool)
    inlet_u = np.zeros((ny, nx))
    if domain.left == "inlet":
        inlet[:, 0] = True
        inlet_u[:, 0] = np.asarray(params.inlet_u)
    if domain.right == "outlet":
        outlet[:, -1] = True
    as_f = lambda a: xp.asarray(np.asarray(a, dtype=np.float64), dtype=dtype)  # noqa: E731
    return {
        "bounce": xp.asarray(parts["bounce"]),
        "hold": xp.asarray(parts["hold"]),
        "other_dst": xp.asarray(parts["other_dst"]),
        "other_src": xp.asarray(parts["other_src"]),
        "add": as_f(add),
        "fluid": xp.asarray(fluid),
        "inlet": xp.asarray(inlet),
        "outlet": xp.asarray(outlet),
        "inlet_u": as_f(inlet_u),
        "inlet_v": as_f(np.zeros((ny, nx))),
        "gx": as_f(np.where(fluid, gx, 0.0)),
        "gy": as_f(np.where(fluid, gy, 0.0)),
        "tau0": as_f(params.tau0),
        "cs": as_f(params.smagorinsky),
        "sigma": as_f(sponge_field(domain, params.sponge)),
        "drag": as_f(
            np.zeros((ny, nx)) if params.drag is None else np.where(fluid, params.drag, 0)
        ),
        **_tracer_config(domain, params, src, add, xp, as_f),
    }


def _tracer_config(domain: Domain, params, src, add, xp, as_f) -> dict[str, Any]:
    """D2Q5 pieces: the D2Q9 map restricted to directions 0-4, which only reference each other."""
    tracer = getattr(params, "tracer", None)
    if tracer is None:
        return {}
    ny, nx = domain.ny, domain.nx
    src5 = src.reshape(Q, ny * nx)[:Q5].reshape(-1)
    if np.any(add.reshape(Q, -1)[:Q5] != 0) or src5.max() >= Q5 * ny * nx:
        raise ValueError("the tracer supports walls, free-slip, inlet and outlet, not a moving lid")
    parts = split_stream_map(src5, ny, nx, Q5)
    return {
        "t_bounce": xp.asarray(parts["bounce"]),
        "t_hold": xp.asarray(parts["hold"]),
        "t_other_dst": xp.asarray(parts["other_dst"]),
        "t_other_src": xp.asarray(parts["other_src"]),
        "t_source": as_f(np.where(domain.fluid, tracer.source, 0.0)),
        "t_d0": as_f(tracer.diffusivity),
        "t_sct": as_f(tracer.schmidt),
    }


def sponge_field(domain: Domain, sponge: tuple[float, int, int, int]) -> np.ndarray:
    """Absorbing-layer strength per node: sigma_max times a quadratic ramp into each layer.

    Sound radiated by vortex shedding would otherwise reflect between the inlet, the ground and
    the top and fill the street with pressure noise (results/street/sponge.json).
    """
    sigma_max, l_in, l_out, l_top = sponge
    ny, nx = domain.ny, domain.nx
    y, x = np.mgrid[0:ny, 0:nx].astype(np.float64)
    ramp = np.zeros((ny, nx))
    if l_in:
        ramp = np.maximum(ramp, np.clip((l_in - x) / l_in, 0.0, 1.0) ** 2)
    if l_out:
        ramp = np.maximum(ramp, np.clip((x - (nx - 1 - l_out)) / l_out, 0.0, 1.0) ** 2)
    if l_top:
        ramp = np.maximum(ramp, np.clip((y - (ny - 1 - l_top)) / l_top, 0.0, 1.0) ** 2)
    return np.where(domain.fluid, sigma_max * ramp, 0.0)


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
    """Density and velocity, rho u = sum f c + F / 2, with the porous drag solved implicitly.

    The drag of crowns and hedges, F = -(lambda / 2) rho |u| u, depends on the velocity it
    corrects. Writing u0 for the velocity with the gravity half-force only, u = u0 - (lambda / 4)
    |u| u has the closed-form solution u = k u0 with k = 2 / (1 + sqrt(1 + lambda |u0|)), which
    stays bounded however dense the crown (Guo and Zhao 2002 use the same device for porous media).
    """
    rho = _moment(f, [1] * Q)
    ux = _moment(f, CX) / rho + 0.5 * cfg["gx"]
    uy = _moment(f, CY) / rho + 0.5 * cfg["gy"]
    k = 2.0 / (1.0 + xp.sqrt(1.0 + cfg["drag"] * xp.sqrt(ux * ux + uy * uy)))
    return rho, k * ux, k * uy


def body_force(xp, rho, ux, uy, cfg):
    """Gravity plus porous drag (lambda / 2) rho |u| u, the pressure-loss law of CODASC."""
    drag = 0.5 * cfg["drag"] * xp.sqrt(ux * ux + uy * uy)
    return rho * (cfg["gx"] - drag * ux), rho * (cfg["gy"] - drag * uy)


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
    post, tau, _, _ = flow_step(xp, f_post, cfg)
    return post, tau


def flow_step(xp, f_post, cfg):
    """One flow step; also returns the velocity the collision used, which the tracer needs."""
    f = stream(xp, f_post, cfg)
    rho, ux, uy = macros(xp, f, cfg)
    fx, fy = body_force(xp, rho, ux, uy, cfg)
    feq = equilibrium(xp, rho, ux, uy)
    tau = relaxation_time(xp, f, feq, rho, ux, uy, fx, fy, cfg)
    post = f - (f - feq) / tau + guo_source(xp, tau, ux, uy, fx, fy)
    # Absorbing layers: f_eq(1, u) - f_eq(rho, u) = (1 - rho) / rho f_eq(rho, u).
    post = post + (cfg["sigma"] * (1.0 - rho) / rho) * feq
    post = xp.where(cfg["fluid"], post, f)
    # Boundary columns: the equilibrium part of the non-equilibrium extrapolation of Guo, Zheng
    # and Shi (2002), from the previous state of the neighbouring column (reading only the old
    # buffer keeps the GPU kernel free of races). The non-equilibrium part is left out: with tau
    # near 1/2 it changes sign every step, and copying it one step late made the outlet unstable
    # (docs/solver.md). The inlet fixes the velocity, the outlet fixes the density.
    rho_in, _, _ = _column_state(xp, f_post[:, :, 1])
    inlet = equilibrium(xp, rho_in, cfg["inlet_u"][:, 0], cfg["inlet_v"][:, 0])
    post = _set_column(xp, post, 0, xp.where(cfg["inlet"][:, 0], inlet, post[:, :, 0]))
    _, ux_out, uy_out = _column_state(xp, f_post[:, :, -2])
    outlet = equilibrium(xp, xp.ones_like(ux_out), ux_out, uy_out)
    post = _set_column(xp, post, -1, xp.where(cfg["outlet"][:, -1], outlet, post[:, :, -1]))
    return post, tau, ux, uy


def coupled_step(xp, state, cfg):
    """Flow and tracer together; state is (f_post, g_post)."""
    f_post, g_post = state
    post, tau, ux, uy = flow_step(xp, f_post, cfg)
    _, ux_nb, uy_nb = _column_state(xp, f_post[:, :, -2])
    return (post, tracer_step(xp, g_post, ux, uy, tau, cfg, (ux_nb, uy_nb))), tau


def tracer_equilibrium(xp, c, ux, uy):
    """D2Q5 equilibrium w_i C (1 + 3 c_i . u), shape (5, *c.shape)."""
    out = []
    for i in range(Q5):
        cu = _lin(int(CX[i]), ux, int(CY[i]), uy)
        w = float(W5[i])
        out.append(w * c if cu is None else w * c * (1.0 + 3.0 * cu))
    return xp.stack(out)


def tracer_stream(xp, g_post, cfg):
    rolled = xp.stack(
        [xp.roll(g_post[i], (int(CY[i]), int(CX[i])), axis=(0, 1)) for i in range(Q5)]
    )
    g = xp.where(cfg["t_bounce"], g_post[OPP[:Q5]], rolled)
    g = xp.where(cfg["t_hold"], g_post, g)
    vals = xp.take(g_post.reshape(-1), cfg["t_other_src"])
    if xp is np:
        g = g.reshape(-1)
        g[cfg["t_other_dst"]] = vals
    else:
        g = g.reshape(-1).at[cfg["t_other_dst"]].set(vals)
    return g.reshape(g_post.shape)


def tracer_step(xp, g_post, ux, uy, tau, cfg, u_outlet):
    """Advection-diffusion of a passive tracer (traffic fumes) on D2Q5 with BGK collision.

    Diffusivity D = D0 + nu_t / Sc_t, with the Smagorinsky eddy viscosity nu_t = (tau - tau0) / 3
    of the same step, so tau_c = 1/2 + 3 D. Walls and buildings reflect the tracer (zero flux);
    the inlet brings clean air. The outlet column is the equilibrium at its neighbour's previous
    concentration and velocity (`u_outlet`, the same velocity the flow outlet uses), a
    zero-gradient outflow that reads only the old buffer. Copying the neighbour's populations
    instead fed their non-equilibrium part back into the domain and blew up with tau_c near 1/2.
    """
    g = tracer_stream(xp, g_post, cfg)
    c = _moment(g, [1] * Q5)
    nu_t = (tau - cfg["tau0"]) / 3.0
    tau_c = 0.5 + 3.0 * (cfg["t_d0"] + nu_t / cfg["t_sct"])
    post = g - (g - tracer_equilibrium(xp, c, ux, uy)) / tau_c
    post = post + xp.stack([float(W5[i]) * cfg["t_source"] for i in range(Q5)])
    post = xp.where(cfg["fluid"], post, g)
    post = xp.where(cfg["inlet"], 0.0, post)
    c_nb = _moment(g_post[:, :, -2], [1] * Q5)
    outlet = tracer_equilibrium(xp, c_nb, *u_outlet)
    return _set_column(xp, post, -1, xp.where(cfg["outlet"][:, -1], outlet, post[:, :, -1]))


def concentration(xp, g_post, cfg):
    """Tracer concentration the next collision will see."""
    return _moment(tracer_stream(xp, g_post, cfg), [1] * Q5)


def _column_state(xp, f):
    """Density and velocity of one column of post-collision populations."""
    rho = _moment(f, [1] * Q)
    return rho, _moment(f, CX) / rho, _moment(f, CY) / rho


def _set_column(xp, post, x: int, col):
    if xp is np:
        post[:, :, x] = col
        return post
    return post.at[:, :, x].set(col)


def initial_state(xp, cfg, dtype):
    """Fluid at rest with unit density; the inlet column already at its equilibrium."""
    shape = cfg["fluid"].shape
    one = xp.ones(shape, dtype=dtype)
    zero = xp.zeros(shape, dtype=dtype)
    f = equilibrium(xp, one, zero, zero)
    return xp.where(cfg["inlet"], equilibrium(xp, one, cfg["inlet_u"], zero), f)
