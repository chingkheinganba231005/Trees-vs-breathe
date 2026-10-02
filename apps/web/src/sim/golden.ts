import { makeDomain } from './domain';
import type { BottomSide, Domain, LeftSide, RightSide, TopSide } from './domain';
import type { SolverParams } from './cpu/solver';

/** A case written by python -m treesvb.golden. */
export interface GoldenCase {
  name: string;
  description: string;
  domain: {
    nx: number;
    ny: number;
    left: LeftSide;
    right: RightSide;
    bottom: BottomSide;
    top: TopSide;
    lidVelocity: number;
    solid: string[];
  };
  params: {
    tau0: number;
    smagorinsky: number;
    gx: number;
    gy: number;
    inletU: number[] | null;
    sponge: [number, number, number, number];
  };
  initial: { ux: number[]; uy: number[] } | null;
  steps: number;
  uRef: number;
  streamMap: { src: number[]; add: number[] };
  rho: number[];
  ux: number[];
  uy: number[];
}

export function goldenDomain(g: GoldenCase): Domain {
  const { nx, ny } = g.domain;
  const solid = new Uint8Array(nx * ny);
  g.domain.solid.forEach((row, y) => {
    for (let x = 0; x < nx; x++) solid[y * nx + x] = row[x] === '1' ? 1 : 0;
  });
  return makeDomain({ ...g.domain, solid });
}

export function goldenParams(g: GoldenCase): SolverParams {
  return {
    tau0: g.params.tau0,
    smagorinsky: g.params.smagorinsky,
    gx: g.params.gx,
    gy: g.params.gy,
    inletU: g.params.inletU ?? undefined,
    sponge: {
      sigma: g.params.sponge[0],
      inlet: g.params.sponge[1],
      outlet: g.params.sponge[2],
      top: g.params.sponge[3],
    },
  };
}

/** Largest velocity difference as a fraction of the case's reference speed. */
export function velocityError(g: GoldenCase, ux: ArrayLike<number>, uy: ArrayLike<number>): number {
  let worst = 0;
  for (let k = 0; k < g.ux.length; k++) {
    worst = Math.max(worst, Math.abs(ux[k]! - g.ux[k]!), Math.abs(uy[k]! - g.uy[k]!));
  }
  return worst / g.uRef;
}
