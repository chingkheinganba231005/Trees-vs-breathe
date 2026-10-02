import { makeDomain } from './domain';
import type { Domain } from './domain';
import type { SolverParams } from './cpu/solver';

/**
 * An isolated street canyon, mirroring canyon_geometry and canyon in
 * python/treesvb/solver2d/cases.py. Lengths other than the street width are multiples of the
 * building height H (docs/assumptions.md A-002).
 */
export interface CanyonGeometry {
  height: number;
  width: number;
  building: number;
  upstream: number;
  downstream: number;
  top: number;
}

export interface CanyonOptions {
  building?: number;
  upstream?: number;
  downstream?: number;
  top?: number;
}

/** Python's round(): halves go to the even neighbour, so both sides build identical grids. */
export function roundHalfEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function canyonGeometry(
  height: number,
  aspect: number,
  o: CanyonOptions = {},
): CanyonGeometry {
  return {
    height,
    width: Math.max(2, roundHalfEven(height / aspect)),
    building: roundHalfEven((o.building ?? 1) * height),
    upstream: roundHalfEven((o.upstream ?? 3) * height),
    downstream: roundHalfEven((o.downstream ?? 6) * height),
    top: roundHalfEven((o.top ?? 5) * height),
  };
}

export function canyonNx(g: CanyonGeometry): number {
  return g.upstream + 2 * g.building + g.width + g.downstream;
}

/** Column range [x0, x1) of the street between the buildings. */
export function streetColumns(g: CanyonGeometry): [number, number] {
  const x0 = g.upstream + g.building;
  return [x0, x0 + g.width];
}

export function canyonDomain(g: CanyonGeometry): Domain {
  const nx = canyonNx(g);
  const solid = new Uint8Array(nx * g.top);
  const a = g.upstream;
  const b = a + g.building + g.width;
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.building; x++) {
      solid[y * nx + a + x] = 1;
      solid[y * nx + b + x] = 1;
    }
  }
  return makeDomain({
    nx,
    ny: g.top,
    left: 'inlet',
    right: 'outlet',
    bottom: 'wall',
    top: 'freeslip',
    solid,
  });
}

export interface FlowSettings {
  /** Inflow speed, lattice units. */
  uRef: number;
  /** u_ref H / nu0 with the molecular viscosity. */
  reynolds: number;
  smagorinsky: number;
}

/** Absorbing-layer strength, as SPONGE_SIGMA in cases.py (results/street/sponge.json). */
export const SPONGE_SIGMA = 0.05;

export function canyonParams(g: CanyonGeometry, flow: FlowSettings): SolverParams {
  const nu = (flow.uRef * g.height) / flow.reynolds;
  return {
    tau0: 3 * nu + 0.5,
    smagorinsky: flow.smagorinsky,
    gx: 0,
    gy: 0,
    inletU: new Array<number>(g.top).fill(flow.uRef),
    sponge: { sigma: SPONGE_SIGMA, inlet: g.height, outlet: 2 * g.height, top: g.height },
  };
}

/** Unit density and the inflow speed everywhere outside buildings (cases.uniform_start). */
export function uniformStart(uRef: number, solid: Uint8Array) {
  const n = solid.length;
  const ux = new Float32Array(n);
  for (let k = 0; k < n; k++) ux[k] = solid[k] ? 0 : uRef;
  return { rho: new Float32Array(n).fill(1), ux, uy: new Float32Array(n) };
}
