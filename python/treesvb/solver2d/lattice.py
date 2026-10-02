"""D2Q9 lattice constants shared by every implementation.

The direction order is fixed and must match apps/web/src/sim (TypeScript and WGSL):

    6 2 5
    3 0 1
    7 4 8

Lattice units throughout: dx = dt = 1, so the speed of sound squared is 1/3.
"""

from __future__ import annotations

import numpy as np

Q = 9
CS2 = 1.0 / 3.0

# (cx, cy) per direction; y points up.
C = np.array(
    [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]],
    dtype=np.int64,
)
CX = C[:, 0]
CY = C[:, 1]
W = np.array([4 / 9] + [1 / 9] * 4 + [1 / 36] * 4)
OPP = np.array([0, 3, 4, 1, 2, 7, 8, 5, 6])
# Mirror in y (cy -> -cy), used by the free-slip top boundary.
MIRROR_Y = np.array([0, 1, 4, 3, 2, 8, 7, 6, 5])


def equilibrium(rho: np.ndarray, ux: np.ndarray, uy: np.ndarray) -> np.ndarray:
    """Second-order equilibrium, shape (9, *rho.shape)."""
    xp = _xp(rho)
    cu = CX.reshape(-1, *[1] * rho.ndim) * ux + CY.reshape(-1, *[1] * rho.ndim) * uy
    usq = ux * ux + uy * uy
    w = xp.asarray(W, dtype=rho.dtype).reshape(-1, *[1] * rho.ndim)
    return w * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * usq)


def _xp(a):
    # NumPy and JAX arrays share this code; pick the module that owns the array.
    mod = type(a).__module__
    if mod.startswith("jax"):
        import jax.numpy as jnp

        return jnp
    return np


assert np.all(CX[OPP] == -CX) and np.all(CY[OPP] == -CY)
assert np.all(CX[MIRROR_Y] == CX) and np.all(CY[MIRROR_Y] == -CY)
assert abs(W.sum() - 1.0) < 1e-15
