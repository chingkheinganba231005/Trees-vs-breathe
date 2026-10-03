"""Post-processing: benchmark errors, centreline profiles, stream function, vortex detection."""

from __future__ import annotations

import numpy as np


def relative_l2(sim: np.ndarray, exact: np.ndarray) -> float:
    return float(np.linalg.norm(sim - exact) / np.linalg.norm(exact))


def cavity_centrelines(ux: np.ndarray, uy: np.ndarray, lid: float):
    """u on x = 1/2 and v on y = 1/2, with the wall values added, normalised by the lid speed.

    Node j sits at (j + 1/2) / n because the half-way bounce-back walls lie half a cell outside.
    """
    n = ux.shape[0]
    mid = n // 2
    # For even n the centreline lies between two columns; average them.
    u_mid = ux[:, mid] if n % 2 else 0.5 * (ux[:, mid - 1] + ux[:, mid])
    v_mid = uy[mid, :] if n % 2 else 0.5 * (uy[mid - 1, :] + uy[mid, :])
    pos = (np.arange(n) + 0.5) / n
    y = np.concatenate([[0.0], pos, [1.0]])
    u = np.concatenate([[0.0], u_mid / lid, [1.0]])
    x = np.concatenate([[0.0], pos, [1.0]])
    v = np.concatenate([[0.0], v_mid / lid, [0.0]])
    return (y, u), (x, v)


def compare_with_table(profile: tuple[np.ndarray, np.ndarray], table: np.ndarray) -> dict:
    """Linear interpolation of the simulated profile at the tabulated points."""
    pos, val = profile
    order = np.argsort(table[:, 0])
    ref_pos, ref_val = table[order, 0], table[order, 1]
    sim = np.interp(ref_pos, pos, val)
    err = sim - ref_val
    return {
        "positions": ref_pos.tolist(),
        "reference": ref_val.tolist(),
        "simulated": sim.tolist(),
        "max_abs_error": float(np.abs(err).max()),
        "rms_error": float(np.sqrt(np.mean(err**2))),
    }


def stream_function(ux: np.ndarray, uy: np.ndarray, solid: np.ndarray | None = None) -> np.ndarray:
    """psi with u = d psi / dy, integrated upward from psi = 0 on the bottom wall of each column."""
    u = np.where(solid, 0.0, ux) if solid is not None else ux
    psi = np.cumsum(u, axis=0)
    return psi - 0.5 * u  # value at the node centre, not the cell top


def smooth(field: np.ndarray) -> np.ndarray:
    """Binomial [1, 2, 1] / 4 filter along both axes; edges average with their neighbour.

    Both stencils remove exactly the grid-scale (odd-even) mode and little else. BGK leaves a
    weak checkerboard in slow regions when tau is close to 1/2, and time averaging does not
    remove it; filtered, the mean flow's streamlines show the vortices rather than that mode.
    """
    out = field.astype(np.float64).copy()
    for axis in (0, 1):
        a = np.moveaxis(out, axis, 0)
        b = a.copy()
        b[1:-1] = 0.25 * a[:-2] + 0.5 * a[1:-1] + 0.25 * a[2:]
        b[0] = 0.5 * (a[0] + a[1])
        b[-1] = 0.5 * (a[-1] + a[-2])
        out = np.moveaxis(b, 0, axis)
    return out


def street_psi(ux: np.ndarray, x0: int, x1: int, height: int) -> np.ndarray:
    """Stream function inside the street from the filtered along-wind velocity, 0 on the floor."""
    u = smooth(ux)[:height, x0:x1]
    return np.cumsum(u, axis=0) - 0.5 * u


def _regions(mask: np.ndarray) -> list[np.ndarray]:
    """Connected regions (4-neighbour) of a boolean grid, as lists of (row, col)."""
    seen = np.zeros_like(mask, bool)
    out = []
    ny, nx = mask.shape
    for j in range(ny):
        for i in range(nx):
            if not mask[j, i] or seen[j, i]:
                continue
            stack, cells = [(j, i)], []
            seen[j, i] = True
            while stack:
                a, b = stack.pop()
                cells.append((a, b))
                for c, d in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                    if 0 <= c < ny and 0 <= d < nx and mask[c, d] and not seen[c, d]:
                        seen[c, d] = True
                        stack.append((c, d))
            out.append(np.array(cells))
    return out


def canyon_vortices(
    ux: np.ndarray,
    uy: np.ndarray,
    x0: int,
    x1: int,
    height: int,
    min_strength: float = 0.02,
) -> list[dict]:
    """Recirculation cells inside the street between columns x0 and x1, below roof height.

    The stream function comes from the filtered mean velocity (street_psi). Each connected
    region where it keeps one sign is one cell; its centre is the extremum of the region, and
    cells whose extremum holds less than `min_strength` of the street's peak |psi| are noise.
    Sign: clockwise (the main canyon vortex for wind from the left) where psi < 0.
    """
    psi = street_psi(ux, x0, x1, height)
    peak = np.abs(psi).max()
    if peak == 0:
        return []
    nx = psi.shape[1]
    found = []
    for sign in (-1.0, 1.0):
        for cells in _regions(sign * psi > 0):
            vals = sign * psi[cells[:, 0], cells[:, 1]]
            k = int(np.argmax(vals))
            j, i = cells[k]
            # Edge rows and columns cannot hold a closed vortex centre.
            if vals[k] < min_strength * peak or not (0 < j < height - 1 and 0 < i < nx - 1):
                continue
            p = float(psi[j, i])
            found.append(
                {
                    "x": float((i + 0.5) / nx),
                    "z": float((j + 0.5) / height),
                    "psi": float(p / peak),
                    "rotation": "clockwise" if p < 0 else "anticlockwise",
                }
            )
    return found


def floor_reattachment(ux: np.ndarray, x0: int, x1: int, rows: int = 1) -> float:
    """Fraction of the street floor where the near-ground flow runs with the wind (u > 0).

    In skimming flow the canyon vortex drives the floor flow against the wind; reattachment of
    the outer flow onto the floor shows as a stretch of u > 0.
    """
    near = ux[:rows, x0:x1].mean(0)
    return float((near > 0).mean())
