"""Domain description and the streaming map that encodes every boundary condition.

Streaming is a pull: the population arriving at node x in direction i is read from the
post-collision buffer at x - c_i. Each boundary rule only changes *where* that value is read
from (and, for the moving lid, adds a constant), so the whole step reduces to one gather:

    f[i, y, x] = f_post.flat[src[i, y, x]] + add[i, y, x]

Rules, applied in this order for the source (sx, sy) = (x - cx, y - cy):

1. sx outside [0, nx): left/right `periodic` wraps; `wall` is half-way bounce-back
   (read f_post[opp(i)] at the node itself).
2. sy outside [0, ny): `periodic` wraps; `wall` is bounce-back; `moving` is bounce-back plus
   2 w_i rho0 (c_i . u_w) / cs^2 with rho0 = 1; `freeslip` reads f_post[mirror_y(i)] at
   (sx, ny - 1), a specular reflection.
3. A solid source node is bounce-back.

Solid nodes and the inlet and outlet columns read themselves; after collision the solver sets
the inlet and outlet columns to the equilibrium part of the non-equilibrium extrapolation of
Guo, Zheng and Shi (2002, Chinese Physics 11, 366), from the neighbouring column's previous
state (core.step explains why the non-equilibrium part is left out). The inlet fixes the
velocity, the outlet fixes the density (pressure).

The TypeScript builder (apps/web/src/sim/domain.ts) and the WGSL kernel implement the same
rules; tests compare them against this one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .lattice import CS2, CX, CY, MIRROR_Y, OPP, Q, W

SIDES = {
    "left": ("periodic", "wall", "inlet"),
    "right": ("periodic", "wall", "outlet"),
    "bottom": ("periodic", "wall"),
    "top": ("periodic", "wall", "moving", "freeslip"),
}


@dataclass(frozen=True)
class Domain:
    nx: int
    ny: int
    left: str = "periodic"
    right: str = "periodic"
    bottom: str = "wall"
    top: str = "wall"
    #: Lid velocity along x for a `moving` top, lattice units.
    lid_velocity: float = 0.0
    #: Solid cells (buildings), shape (ny, nx), indexed [y, x] with y = 0 at the bottom.
    solid: np.ndarray = field(default=None, repr=False)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        for side, allowed in SIDES.items():
            if getattr(self, side) not in allowed:
                raise ValueError(f"{side} boundary must be one of {allowed}")
        if (self.left == "periodic") != (self.right == "periodic"):
            raise ValueError("left and right must both be periodic or neither")
        if (self.bottom == "periodic") != (self.top == "periodic"):
            raise ValueError("bottom and top must both be periodic or neither")
        solid = np.zeros((self.ny, self.nx), bool) if self.solid is None else self.solid
        if solid.shape != (self.ny, self.nx):
            raise ValueError("solid mask must have shape (ny, nx)")
        object.__setattr__(self, "solid", np.ascontiguousarray(solid, dtype=bool))

    @property
    def boundary_columns(self) -> np.ndarray:
        """Inlet and outlet columns, set by extrapolation rather than streaming and collision."""
        b = np.zeros((self.ny, self.nx), bool)
        if self.left == "inlet":
            b[:, 0] = True
        if self.right == "outlet":
            b[:, -1] = True
        return b

    @property
    def fluid(self) -> np.ndarray:
        """Nodes whose state the solver evolves (excludes solids and boundary columns)."""
        return ~self.solid & ~self.boundary_columns


def build_stream_map(d: Domain) -> tuple[np.ndarray, np.ndarray]:
    """Return (src, add): flat int64 source indices and float64 additive terms, (9, ny, nx)."""
    ny, nx = d.ny, d.nx
    n = nx * ny
    y, x = np.mgrid[0:ny, 0:nx]
    src = np.empty((Q, ny, nx), np.int64)
    add = np.zeros((Q, ny, nx))

    def flat(i, yy, xx):
        return i * n + yy * nx + xx

    for i in range(Q):
        sx = x - CX[i]
        sy = y - CY[i]
        out = flat(np.full_like(x, i), sy.clip(0, ny - 1), sx.clip(0, nx - 1))
        done = np.zeros((ny, nx), bool)
        bounce = flat(np.full_like(x, OPP[i]), y, x)

        # 1. x boundaries
        lo, hi = sx < 0, sx >= nx
        if d.left == "periodic":
            sx = np.where(lo, sx + nx, sx)
            sx = np.where(hi, sx - nx, sx)
        else:
            if d.left == "wall":
                out = np.where(lo, bounce, out)
                done |= lo
            if d.right == "wall":
                out = np.where(hi & ~done, bounce, out)
                done |= hi
            # Inlet and outlet columns are overwritten after collision, so their pulls never matter.
            sx = sx.clip(0, nx - 1)

        # 2. y boundaries
        below, above = (sy < 0) & ~done, (sy >= ny) & ~done
        if d.bottom == "periodic":
            sy = np.where(sy < 0, sy + ny, sy)
            sy = np.where(sy >= ny, sy - ny, sy)
        else:
            out = np.where(below, bounce, out)
            done |= below
            if d.top in ("wall", "moving"):
                out = np.where(above, bounce, out)
                if d.top == "moving":
                    add[i] = np.where(above, 2.0 * W[i] * (CX[i] * d.lid_velocity) / CS2, 0.0)
            elif d.top == "freeslip":
                out = np.where(above, flat(np.full_like(x, MIRROR_Y[i]), ny - 1, sx), out)
            done |= above
            sy = sy.clip(0, ny - 1)

        # 3. solid sources, then ordinary streaming
        solid_src = ~done & d.solid[sy, sx]
        out = np.where(solid_src, bounce, out)
        done |= solid_src
        out = np.where(done, out, flat(np.full_like(x, i), sy, sx))

        # Solid nodes and the boundary columns keep their own value.
        keep = d.solid | d.boundary_columns
        out = np.where(keep, flat(np.full_like(x, i), y, x), out)
        add[i] = np.where(keep, 0.0, add[i])
        src[i] = out
    return src, add
