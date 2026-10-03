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

/** A tree sized in metres: overall height and crown spread. */
export interface TreeSize {
  heightM: number;
  spreadM: number;
}

/**
 * The street the greenery stands in: its building height in metres, which turns sizes in metres
 * into units of H, and the typical local roadside tree, if known (docs/assumptions.md A-014).
 */
export interface StreetScale {
  heightM: number;
  localTree: TreeSize | null;
}

/** The CODASC street at full scale, the default without a street preset. */
export const TUNNEL_SCALE: StreetScale = { heightM: FULL_SCALE_HEIGHT_M, localTree: null };

/**
 * lambda H of a crown of the given density in a street `heightM` tall. The crown keeps CODASC's
 * pressure loss per metre (A-015), so lambda H grows with the street's height in metres.
 */
export function crownLamH(density: CrownDensity, heightM = FULL_SCALE_HEIGHT_M): number {
  return (CROWN_LAM_H[density] * heightM) / FULL_SCALE_HEIGHT_M;
}

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
export function avenueTrees(
  width: number,
  density: CrownDensity,
  heightM = FULL_SCALE_HEIGHT_M,
): GreenElement[] {
  const lamH = crownLamH(density, heightM);
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

/**
 * Trees along both kerbs: one row centred on each kerb line, taken as the outer edge of the
 * pavement breathing zone, PAVEMENT_WIDTH from each wall (assumption A-024). Rows are as wide as
 * CODASC's W/H 2 rows (0.42 H) until sized by a local tree.
 */
export function kerbTrees(
  width: number,
  density: CrownDensity,
  heightM = FULL_SCALE_HEIGHT_M,
): GreenElement[] {
  const lamH = crownLamH(density, heightM);
  const half = 0.21;
  return [PAVEMENT_WIDTH, width - PAVEMENT_WIDTH].map((mid, i) => ({
    id: `trees-${i}`,
    kind: 'trees' as const,
    x0: mid - half,
    x1: mid + half,
    z0: 1 / 3,
    z1: 1,
    lamH,
  }));
}

/**
 * Hedge options from Gromke et al. (2016) via Abhijith et al. (2017, Table 3): heights 1.5 and
 * 2.5 m, pressure-loss coefficients 1.67 and 3.34 1/m, 1.5 m wide.
 */
export const HEDGE_HEIGHTS_M = [1.5, 2.5] as const;
export const HEDGE_LAMBDAS = [1.67, 3.34] as const;

/** What the user chose on the Design screen. */
export interface GreeneryDesign {
  kind: 'none' | 'trees' | 'hedge';
  /** CODASC's trees, as tall as the buildings, or a typical local roadside tree (A-014, A-015). */
  treeSize: 'tunnel' | 'local';
  /** CODASC's row layout, or one row along each kerb (A-024). */
  rows: 'tunnel' | 'kerbs';
  density: CrownDensity;
  /** Crown base above the ground, units of H. CODASC: 1/3, its crowns reaching the roofs. */
  crownBase: number;
  /** Crown width as a multiple of the CODASC width. */
  crownScale: number;
  /** Sideways shift of the whole layout, units of H; clamped to stay in the street. */
  shift: number;
  hedgeHeightM: (typeof HEDGE_HEIGHTS_M)[number];
  hedgeLambda: (typeof HEDGE_LAMBDAS)[number];
}

export const DEFAULT_DESIGN: GreeneryDesign = {
  kind: 'none',
  treeSize: 'tunnel',
  rows: 'tunnel',
  density: 'dense',
  crownBase: 1 / 3,
  crownScale: 1,
  shift: 0,
  hedgeHeightM: 2.5,
  hedgeLambda: 3.34,
};

/** Largest and smallest shift that keep every element between the buildings. */
export function shiftRange(elements: GreenElement[], width: number): [number, number] {
  if (elements.length === 0) return [0, 0];
  const lo = Math.min(...elements.map((e) => e.x0));
  const hi = Math.max(...elements.map((e) => e.x1));
  return [-lo, width - hi];
}

/** Top of the crowns in units of H: the roofs for CODASC's trees, the tree height otherwise. */
export function crownTop(d: GreeneryDesign, scale: StreetScale): number {
  if (d.treeSize === 'local' && scale.localTree) {
    return Math.min(1, scale.localTree.heightM / scale.heightM);
  }
  return 1;
}

/**
 * The elements for a design in a street `width` H wide, shifted but kept inside the street.
 * Local trees take CODASC's row layout with their own height and crown spread in metres; their
 * crown starts at the crown base like CODASC's (one third of the tree height by default).
 */
export function buildGreenery(
  d: GreeneryDesign,
  width: number,
  scale: StreetScale = TUNNEL_SCALE,
): GreenElement[] {
  let els: GreenElement[] = [];
  if (d.kind === 'trees') {
    const top = crownTop(d, scale);
    const local = d.treeSize === 'local' && scale.localTree ? scale.localTree : null;
    const layout = d.rows === 'kerbs' ? kerbTrees : avenueTrees;
    els = layout(width, d.density, scale.heightM).map((e) => {
      const mid = 0.5 * (e.x0 + e.x1);
      const full = local ? local.spreadM / scale.heightM : e.x1 - e.x0;
      const half = 0.5 * full * d.crownScale;
      return {
        ...e,
        x0: mid - half,
        x1: mid + half,
        z0: Math.min(d.crownBase, 0.9 * top),
        z1: top,
      };
    });
    // Rows that grow into each other merge into one closed canopy.
    if (els.length === 2 && els[0]!.x1 >= els[1]!.x0) {
      els = [{ ...els[0]!, x1: els[1]!.x1 }];
    }
  } else if (d.kind === 'hedge') {
    const base = centralHedge(width, scale.heightM);
    els = [
      {
        ...base,
        z1: d.hedgeHeightM / scale.heightM,
        lamH: d.hedgeLambda * scale.heightM,
      },
    ];
  }
  // Keep the layout between the buildings, then clip anything still wider than the street.
  const [lo, hi] = shiftRange(els, width);
  const s = Math.min(Math.max(d.shift, Math.min(lo, 0)), Math.max(hi, 0));
  return els.map((e) => ({ ...e, x0: Math.max(0, e.x0 + s), x1: Math.min(width, e.x1 + s) }));
}

/** One hedge on the street axis, between the inner lanes (central_hedge in trees.py). */
export function centralHedge(width: number, heightM = FULL_SCALE_HEIGHT_M): GreenElement {
  const h = HEDGE.heightM / heightM;
  const half = (0.5 * HEDGE.widthM) / heightM;
  const mid = 0.5 * width;
  return {
    id: 'hedge-0',
    kind: 'hedge',
    x0: mid - half,
    x1: mid + half,
    z0: 0,
    z1: h,
    lamH: HEDGE.lambdaPerM * heightM,
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
/**
 * Mean wind speed over each pavement's breathing zone (the zone of pavementExposure), as a share
 * of the inflow speed at roof height. `ux` and `uy` hold one value per node at `stride` and
 * `offset` (GPU fields: rho, ux, uy, tau per node).
 */
export function pavementSpeed(
  g: CanyonGeometry,
  field: ArrayLike<number>,
  stride: number,
  offsetX: number,
  offsetY: number,
  uRef: number,
  fieldY: ArrayLike<number> = field,
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
      const k = (y * nx + x) * stride;
      const speed = Math.hypot(field[k + offsetX]!, fieldY[k + offsetY]!);
      if (xc <= x0 + w) {
        a += speed;
        na += 1;
      }
      if (xc >= x1 - w) {
        b += speed;
        nb += 1;
      }
    }
  }
  return { A: a / Math.max(1, na) / uRef, B: b / Math.max(1, nb) / uRef };
}

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
