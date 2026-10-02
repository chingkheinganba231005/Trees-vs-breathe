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


def canyon_vortices(
    ux: np.ndarray,
    uy: np.ndarray,
    x0: int,
    x1: int,
    height: int,
    min_strength: float = 0.02,
) -> list[dict]:
    """Recirculation cells inside the street between columns x0 and x1, below roof height.

    The stream function is computed inside the canyon from the canyon floor. A vortex centre is a
    local extremum of psi whose closed streamlines carry at least `min_strength` of the canyon's
    peak |psi| (filters numerical noise). Sign: +1 clockwise (main canyon vortex for wind from the
    left), -1 anticlockwise.
    """
    u = ux[:height, x0:x1]
    psi = np.cumsum(u, axis=0) - 0.5 * u
    peak = np.abs(psi).max()
    if peak == 0:
        return []
    found = []
    ny, nx = psi.shape
    for j in range(1, ny - 1):
        for i in range(1, nx - 1):
            p = psi[j, i]
            nb = psi[j - 1 : j + 2, i - 1 : i + 2]
            is_max = p == nb.max() and p > 0
            is_min = p == nb.min() and p < 0
            if (is_max or is_min) and abs(p) >= min_strength * peak:
                found.append(
                    {
                        "x": (i + 0.5) / nx,
                        "z": (j + 0.5) / height,
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
