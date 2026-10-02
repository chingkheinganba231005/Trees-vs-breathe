import { CS2, CX, CY, MIRROR_Y, OPP, Q, W } from './lattice';

export type LeftSide = 'periodic' | 'wall' | 'inlet';
export type RightSide = 'periodic' | 'wall' | 'outlet';
export type BottomSide = 'periodic' | 'wall';
export type TopSide = 'periodic' | 'wall' | 'moving' | 'freeslip';

/** Mirrors python/treesvb/solver2d/domain.py. Arrays are row-major with y = 0 at the bottom. */
export interface Domain {
  nx: number;
  ny: number;
  left: LeftSide;
  right: RightSide;
  bottom: BottomSide;
  top: TopSide;
  lidVelocity: number;
  /** 1 for solid cells, length nx * ny, index y * nx + x. */
  solid: Uint8Array;
}

export function makeDomain(d: Partial<Domain> & Pick<Domain, 'nx' | 'ny'>): Domain {
  const domain: Domain = {
    left: 'periodic',
    right: 'periodic',
    bottom: 'wall',
    top: 'wall',
    lidVelocity: 0,
    solid: new Uint8Array(d.nx * d.ny),
    ...d,
  };
  if ((domain.left === 'periodic') !== (domain.right === 'periodic')) {
    throw new Error('left and right must both be periodic or neither');
  }
  if ((domain.bottom === 'periodic') !== (domain.top === 'periodic')) {
    throw new Error('bottom and top must both be periodic or neither');
  }
  if (domain.solid.length !== domain.nx * domain.ny) throw new Error('solid mask has wrong size');
  return domain;
}

/** Nodes the solver evolves: not solid, not the inlet column. */
export function fluidMask(d: Domain): Uint8Array {
  const m = new Uint8Array(d.nx * d.ny);
  for (let y = 0; y < d.ny; y++) {
    for (let x = 0; x < d.nx; x++) {
      const k = y * d.nx + x;
      m[k] = d.solid[k] || (d.left === 'inlet' && x === 0) ? 0 : 1;
    }
  }
  return m;
}

/**
 * The pull-streaming map: f[i][k] = fPost[src[i * n + k]] + add[i * n + k].
 * Same rules, same order as build_stream_map in domain.py; tests compare the two exactly.
 */
export function buildStreamMap(d: Domain): { src: Int32Array; add: Float64Array } {
  const { nx, ny } = d;
  const n = nx * ny;
  const src = new Int32Array(Q * n);
  const add = new Float64Array(Q * n);
  const keep = (x: number, y: number) =>
    d.solid[y * nx + x] === 1 || (d.left === 'inlet' && x === 0);

  for (let i = 0; i < Q; i++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const k = y * nx + x;
        const out = i * n + k;
        if (keep(x, y)) {
          src[out] = out;
          continue;
        }
        const cx = CX[i]!;
        const cy = CY[i]!;
        const bounce = OPP[i]! * n + k;
        let sx = x - cx;
        let sy = y - cy;

        // 1. x boundaries
        if (d.left === 'periodic') {
          sx = (sx + nx) % nx;
        } else {
          if (sx < 0 && d.left === 'wall') {
            src[out] = bounce;
            continue;
          }
          if (sx >= nx) {
            if (d.right === 'wall') {
              src[out] = bounce;
              continue;
            }
            if (d.right === 'outlet') sx = x;
          }
          sx = Math.min(Math.max(sx, 0), nx - 1);
        }

        // 2. y boundaries
        if (d.bottom === 'periodic') {
          sy = (sy + ny) % ny;
        } else {
          if (sy < 0) {
            src[out] = bounce;
            continue;
          }
          if (sy >= ny) {
            if (d.top === 'freeslip') {
              src[out] = MIRROR_Y[i]! * n + (ny - 1) * nx + sx;
            } else {
              src[out] = bounce;
              if (d.top === 'moving') add[out] = (2 * W[i]! * cx * d.lidVelocity) / CS2;
            }
            continue;
          }
        }

        // 3. solid source, then ordinary streaming
        src[out] = d.solid[sy * nx + sx] ? bounce : i * n + sy * nx + sx;
      }
    }
  }
  return { src, add };
}
