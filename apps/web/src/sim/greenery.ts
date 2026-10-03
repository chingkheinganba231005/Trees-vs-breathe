import type { CanyonGeometry } from './street';
import { canyonNx, streetColumns } from './street';

/**
 * Trees, hedges and traffic in the studied street, mirroring Crown, crown_drag and line_sources
 * in python/treesvb/solver2d/cases.py and the CODASC set-up in python/treesvb/trees.py.
 * Sizes are in units of the building height H; x is measured from the upwind wall of the street.
 */
export interface GreenElement {
  id: string;
  kind: 'trees' | 'hedge';
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Pressure-loss coefficient lambda times H (CODASC's definition, Delta p / (p_dyn d)). */
  lamH: number;
}

/** CODASC crowns: lambda 80 and 200 1/m at model scale times H = 0.12 m (docs/codasc.md). */
export const CROWN_LAM_H = { light: 80 * 0.12, dense: 200 * 0.12 } as const;
export type CrownDensity = keyof typeof CROWN_LAM_H;

/** Full-scale building height of the CODASC street (Gromke and Ruck 2012, p. 44), in metres. */
export const FULL_SCALE_HEIGHT_M = 18;

/**
 * The hedge of Gromke et al. (2016) as tabulated by Abhijith et al. (2017, Table 3): 2.5 m high,
 * 1.5 m wide, lambda 3.34 1/m (docs/assumptions.md A-011).
 */
export const HEDGE = { heightM: 2.5, widthM: 1.5, lambdaPerM: 3.34 } as const;

/** Lanes at these distances from the street axis, in units of H (Gromke 2008, p. 42). */
export const LANE_OFFSETS = [-0.267, -0.15, 0.15, 0.267] as const;

/** Tracer added per step per unit street length; c+ does not depend on it. */
export const SOURCE_TOTAL = 1e-3;

/** Pavement breathing zone (docs/assumptions.md A-010), units of H. */
export const PAVEMENT_WIDTH = 0.15;
export const BREATHING: readonly [number, number] = [0.05, 0.15];

/**
 * An avenue of trees in a street `width` H wide. Up to 1.5 H wide: one central row covering the
 * middle half of the street, the CODASC W/H 1 layout; wider: two rows 0.42 H wide, 0.29 H from
 * each wall, the CODASC W/H 2 layout. Crowns run from H/3 to roof height (docs/codasc.md;
 * the switch at 1.5 H is assumption A-012).
 */
export function avenueTrees(width: number, density: CrownDensity): GreenElement[] {
  const lamH = CROWN_LAM_H[density];
  if (width <= 1.5) {
    return [
      { id: 'trees-0', kind: 'trees', x0: 0.25 * width, x1: 0.75 * width, z0: 1 / 3, z1: 1, lamH },
    ];
  }
  return [
    { id: 'trees-0', kind: 'trees', x0: 0.29, x1: 0.71, z0: 1 / 3, z1: 1, lamH },
    { id: 'trees-1', kind: 'trees', x0: width - 0.71, x1: width - 0.29, z0: 1 / 3, z1: 1, lamH },
  ];
}

/** One hedge on the street axis, between the inner lanes (central_hedge in trees.py). */
export function centralHedge(width: number): GreenElement {
  const h = HEDGE.heightM / FULL_SCALE_HEIGHT_M;
  const half = (0.5 * HEDGE.widthM) / FULL_SCALE_HEIGHT_M;
  const mid = 0.5 * width;
  return {
    id: 'hedge-0',
    kind: 'hedge',
    x0: mid - half,
    x1: mid + half,
    z0: 0,
    z1: h,
    lamH: HEDGE.lambdaPerM * FULL_SCALE_HEIGHT_M,
  };
}

/** Length of [lo, lo + 1) inside [a, b). */
function overlap(lo: number, a: number, b: number): number {
  return Math.min(Math.max(Math.min(lo + 1, b) - Math.max(lo, a), 0), 1);
}

/**
 * lambda per cell in 1/cell, weighted by the fraction of each cell inside each element, so the
 * total drag does not depend on how an element falls on the grid (crown_drag in cases.py).
 */
export function dragField(
  g: CanyonGeometry,
  solid: Uint8Array,
  elements: GreenElement[],
): Float32Array {
  const nx = canyonNx(g);
  const out = new Float32Array(nx * g.top);
  const [s0] = streetColumns(g);
  const h = g.height;
  for (const e of elements) {
    const xa = Math.max(0, Math.floor(s0 + e.x0 * h));
    const xb = Math.min(nx - 1, Math.ceil(s0 + e.x1 * h));
    const za = Math.max(0, Math.floor(e.z0 * h));
    const zb = Math.min(g.top - 1, Math.ceil(e.z1 * h));
    for (let y = za; y <= zb; y++) {
      const fz = overlap(y, e.z0 * h, e.z1 * h);
      if (fz === 0) continue;
      for (let x = xa; x <= xb; x++) {
        const fx = overlap(x - s0, e.x0 * h, e.x1 * h);
        const k = y * nx + x;
        if (fx > 0 && !solid[k]) out[k] = out[k]! + fx * fz * (e.lamH / h);
      }
    }
  }
  return out;
}

/**
 * Lane offsets for a street `width` H wide. At W >= H they are CODASC's; in narrower streets
 * they shrink with the width, keeping the W/H 1 layout (assumption A-012).
 */
export function laneOffsets(width: number): number[] {
  const s = Math.min(1, width);
  return LANE_OFFSETS.map((o) => o * s);
}

/**
 * Ground-level line sources, each shared linearly between the two cells whose centres bracket
 * it so its centroid sits at the requested position (line_sources in cases.py).
 */
export function lineSources(
  g: CanyonGeometry,
  offsets: readonly number[],
  total: number,
): Float32Array {
  const nx = canyonNx(g);
  const out = new Float32Array(nx * g.top);
  const [s0] = streetColumns(g);
  const centre = s0 + 0.5 * g.width;
  for (const off of offsets) {
    const pos = centre + off * g.height - 0.5;
    const i = Math.floor(pos);
    const w = pos - i;
    out[i] = out[i]! + ((1 - w) * total) / offsets.length;
    out[i + 1] = out[i + 1]! + (w * total) / offsets.length;
  }
  return out;
}

/**
 * Mean c+ in the breathing zone over each pavement from a concentration field (C per node);
 * A is the leeward pavement, B the windward one (pavement_exposure in trees.py).
 * c+ = C u_H H / Q with u_H the inflow speed at roof height.
 */
export function pavementExposure(
  g: CanyonGeometry,
  conc: ArrayLike<number>,
  stride: number,
  offset: number,
  uH: number,
  total = SOURCE_TOTAL,
): { A: number; B: number } {
  const nx = canyonNx(g);
  const [x0, x1] = streetColumns(g);
  const w = PAVEMENT_WIDTH * g.height;
  let a = 0;
  let na = 0;
  let b = 0;
  let nb = 0;
  for (let y = 0; y < g.top; y++) {
    const zc = y + 0.5;
    if (zc < BREATHING[0] * g.height || zc > BREATHING[1] * g.height) continue;
    for (let x = x0; x < x1; x++) {
      const xc = x + 0.5;
      const c = conc[(y * nx + x) * stride + offset]!;
      if (xc <= x0 + w) {
        a += c;
        na += 1;
      }
      if (xc >= x1 - w) {
        b += c;
        nb += 1;
      }
    }
  }
  const scale = (uH * g.height) / total;
  return { A: (a / Math.max(1, na)) * scale, B: (b / Math.max(1, nb)) * scale };
}
