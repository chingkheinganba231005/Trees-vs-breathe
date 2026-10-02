import { buildStreamMap, fluidMask } from '../domain';
import type { Domain } from '../domain';
import { Q } from '../lattice';

export interface SolverParams {
  /** Molecular relaxation time; viscosity nu0 = (tau0 - 1/2) / 3. */
  tau0: number;
  /** Smagorinsky constant Cs; 0 switches the sub-grid model off. */
  smagorinsky: number;
  /** Uniform body force per unit mass on fluid nodes. */
  gx: number;
  gy: number;
  /** Inlet x-velocity per row, for a domain with a left inlet. */
  inletU?: ArrayLike<number>;
}

export interface Fields {
  rho: Float32Array;
  ux: Float32Array;
  uy: Float32Array;
}

const SQRT2_18 = 18 * Math.SQRT2;
const W0 = 4 / 9;
const W1 = 1 / 9;
const W5 = 1 / 36;

/**
 * The D2Q9 step of python/treesvb/solver2d/core.py in TypeScript, for the CPU worker and tests.
 * Populations are stored in float32 (as on the GPU) and computed in float64.
 */
export class CpuSolver {
  readonly domain: Domain;
  readonly n: number;
  params: SolverParams;
  time = 0;
  fPost: Float32Array;
  private fNext: Float32Array;
  private readonly src: Int32Array;
  private readonly add: Float32Array;
  private readonly fluid: Uint8Array;
  private readonly inletU: Float64Array;

  constructor(domain: Domain, params: SolverParams) {
    if (domain.left === 'inlet' && (!params.inletU || params.inletU.length !== domain.ny)) {
      throw new Error('a left inlet needs params.inletU with one value per row');
    }
    this.domain = domain;
    this.params = params;
    this.n = domain.nx * domain.ny;
    const map = buildStreamMap(domain);
    this.src = map.src;
    this.add = Float32Array.from(map.add);
    this.fluid = fluidMask(domain);
    this.inletU = Float64Array.from(params.inletU ?? new Array<number>(domain.ny).fill(0));
    this.fPost = new Float32Array(Q * this.n);
    this.fNext = new Float32Array(Q * this.n);
    const rho = new Float64Array(this.n).fill(1);
    const ux = new Float64Array(this.n);
    if (domain.left === 'inlet') {
      for (let y = 0; y < domain.ny; y++) ux[y * domain.nx] = this.inletU[y]!;
    }
    this.setState(rho, ux, new Float64Array(this.n));
  }

  /** Replace the state with the equilibrium of the given fields. */
  setState(rho: ArrayLike<number>, ux: ArrayLike<number>, uy: ArrayLike<number>): void {
    const n = this.n;
    const feq = new Float64Array(Q);
    for (let k = 0; k < n; k++) {
      equilibrium(rho[k]!, ux[k]!, uy[k]!, feq);
      for (let i = 0; i < Q; i++) this.fPost[i * n + k] = feq[i]!;
    }
  }

  step(steps = 1): void {
    for (let s = 0; s < steps; s++) this.stepOnce();
  }

  private stepOnce(): void {
    const { n, src, add, fluid, fPost, fNext } = this;
    const { tau0, smagorinsky: cs, gx, gy } = this.params;
    const smag = SQRT2_18 * cs * cs;
    const n2 = 2 * n;
    const n3 = 3 * n;
    const n4 = 4 * n;
    const n5 = 5 * n;
    const n6 = 6 * n;
    const n7 = 7 * n;
    const n8 = 8 * n;

    for (let k = 0; k < n; k++) {
      const f0 = fPost[src[k]!]! + add[k]!;
      const f1 = fPost[src[n + k]!]! + add[n + k]!;
      const f2 = fPost[src[n2 + k]!]! + add[n2 + k]!;
      const f3 = fPost[src[n3 + k]!]! + add[n3 + k]!;
      const f4 = fPost[src[n4 + k]!]! + add[n4 + k]!;
      const f5 = fPost[src[n5 + k]!]! + add[n5 + k]!;
      const f6 = fPost[src[n6 + k]!]! + add[n6 + k]!;
      const f7 = fPost[src[n7 + k]!]! + add[n7 + k]!;
      const f8 = fPost[src[n8 + k]!]! + add[n8 + k]!;

      if (!fluid[k]) {
        fNext[k] = f0;
        fNext[n + k] = f1;
        fNext[n2 + k] = f2;
        fNext[n3 + k] = f3;
        fNext[n4 + k] = f4;
        fNext[n5 + k] = f5;
        fNext[n6 + k] = f6;
        fNext[n7 + k] = f7;
        fNext[n8 + k] = f8;
        continue;
      }

      const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      const ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho + 0.5 * gx;
      const uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho + 0.5 * gy;
      const fx = rho * gx;
      const fy = rho * gy;
      const usq = 1.5 * (ux * ux + uy * uy);

      const e0 = W0 * rho * (1 - usq);
      const e1 = W1 * rho * (1 + 3 * ux + 4.5 * ux * ux - usq);
      const e2 = W1 * rho * (1 + 3 * uy + 4.5 * uy * uy - usq);
      const e3 = W1 * rho * (1 - 3 * ux + 4.5 * ux * ux - usq);
      const e4 = W1 * rho * (1 - 3 * uy + 4.5 * uy * uy - usq);
      const a = ux + uy;
      const b = -ux + uy;
      const e5 = W5 * rho * (1 + 3 * a + 4.5 * a * a - usq);
      const e6 = W5 * rho * (1 + 3 * b + 4.5 * b * b - usq);
      const e7 = W5 * rho * (1 - 3 * a + 4.5 * a * a - usq);
      const e8 = W5 * rho * (1 - 3 * b + 4.5 * b * b - usq);

      let tau = tau0;
      if (cs > 0) {
        const d1 = f1 - e1;
        const d2 = f2 - e2;
        const d3 = f3 - e3;
        const d4 = f4 - e4;
        const d5 = f5 - e5;
        const d6 = f6 - e6;
        const d7 = f7 - e7;
        const d8 = f8 - e8;
        // Non-equilibrium flux with the Guo force contribution removed (see core.py).
        const pxx = d1 + d3 + d5 + d6 + d7 + d8 + fx * ux;
        const pyy = d2 + d4 + d5 + d6 + d7 + d8 + fy * uy;
        const pxy = d5 - d6 + d7 - d8 + 0.5 * (fx * uy + fy * ux);
        const q = Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy);
        tau = 0.5 * (tau0 + Math.sqrt(tau0 * tau0 + (smag * q) / rho));
      }
      const omega = 1 / tau;
      const pre = 1 - 0.5 * omega;

      // Guo source terms, one per direction: w_i [3 (c_i - u) + 9 (c_i . u) c_i] . F
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      let s4 = 0;
      let s5 = 0;
      let s6 = 0;
      let s7 = 0;
      let s8 = 0;
      if (fx !== 0 || fy !== 0) {
        s0 = pre * W0 * (-3 * ux * fx - 3 * uy * fy);
        s1 = pre * W1 * ((3 * (1 - ux) + 9 * ux) * fx - 3 * uy * fy);
        s2 = pre * W1 * (-3 * ux * fx + (3 * (1 - uy) + 9 * uy) * fy);
        s3 = pre * W1 * ((3 * (-1 - ux) + 9 * ux) * fx - 3 * uy * fy);
        s4 = pre * W1 * (-3 * ux * fx + (3 * (-1 - uy) + 9 * uy) * fy);
        s5 = pre * W5 * ((3 * (1 - ux) + 9 * a) * fx + (3 * (1 - uy) + 9 * a) * fy);
        s6 = pre * W5 * ((3 * (-1 - ux) - 9 * b) * fx + (3 * (1 - uy) + 9 * b) * fy);
        s7 = pre * W5 * ((3 * (-1 - ux) + 9 * a) * fx + (3 * (-1 - uy) + 9 * a) * fy);
        s8 = pre * W5 * ((3 * (1 - ux) - 9 * b) * fx + (3 * (-1 - uy) + 9 * b) * fy);
      }

      fNext[k] = f0 - omega * (f0 - e0) + s0;
      fNext[n + k] = f1 - omega * (f1 - e1) + s1;
      fNext[n2 + k] = f2 - omega * (f2 - e2) + s2;
      fNext[n3 + k] = f3 - omega * (f3 - e3) + s3;
      fNext[n4 + k] = f4 - omega * (f4 - e4) + s4;
      fNext[n5 + k] = f5 - omega * (f5 - e5) + s5;
      fNext[n6 + k] = f6 - omega * (f6 - e6) + s6;
      fNext[n7 + k] = f7 - omega * (f7 - e7) + s7;
      fNext[n8 + k] = f8 - omega * (f8 - e8) + s8;
    }

    if (this.domain.left === 'inlet') {
      const { nx, ny } = this.domain;
      const feq = new Float64Array(Q);
      for (let y = 0; y < ny; y++) {
        const k1 = y * nx + 1;
        let rhoIn = 0;
        for (let i = 0; i < Q; i++) rhoIn += fPost[i * n + k1]!;
        equilibrium(rhoIn, this.inletU[y]!, 0, feq);
        for (let i = 0; i < Q; i++) fNext[i * n + y * nx] = feq[i]!;
      }
    }

    this.fNext = fPost;
    this.fPost = fNext;
    this.time += 1;
  }

  /** Density and velocity that the next collision will see. */
  fields(out?: Fields): Fields {
    const { n, src, add, fPost } = this;
    const { gx, gy } = this.params;
    const res = out ?? {
      rho: new Float32Array(n),
      ux: new Float32Array(n),
      uy: new Float32Array(n),
    };
    for (let k = 0; k < n; k++) {
      let rho = 0;
      let jx = 0;
      let jy = 0;
      for (let i = 0; i < Q; i++) {
        const f = fPost[src[i * n + k]!]! + add[i * n + k]!;
        rho += f;
        jx += f * CXS[i]!;
        jy += f * CYS[i]!;
      }
      const g = this.fluid[k] ? 1 : 0;
      res.rho[k] = rho;
      res.ux[k] = jx / rho + 0.5 * gx * g;
      res.uy[k] = jy / rho + 0.5 * gy * g;
    }
    return res;
  }

  totalMass(): number {
    let m = 0;
    for (let k = 0; k < this.n; k++) {
      if (!this.fluid[k]) continue;
      for (let i = 0; i < Q; i++) m += this.fPost[i * this.n + k]!;
    }
    return m;
  }

  healthy(limit = 0.4): boolean {
    const f = this.fields();
    for (let k = 0; k < this.n; k++) {
      if (!this.fluid[k]) continue;
      const s = Math.hypot(f.ux[k]!, f.uy[k]!);
      if (!(s < limit)) return false;
    }
    return true;
  }
}

const CXS = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const CYS = [0, 0, 1, 0, -1, 1, 1, -1, -1];

export function equilibrium(rho: number, ux: number, uy: number, out: Float64Array): void {
  const usq = 1.5 * (ux * ux + uy * uy);
  const a = ux + uy;
  const b = -ux + uy;
  out[0] = W0 * rho * (1 - usq);
  out[1] = W1 * rho * (1 + 3 * ux + 4.5 * ux * ux - usq);
  out[2] = W1 * rho * (1 + 3 * uy + 4.5 * uy * uy - usq);
  out[3] = W1 * rho * (1 - 3 * ux + 4.5 * ux * ux - usq);
  out[4] = W1 * rho * (1 - 3 * uy + 4.5 * uy * uy - usq);
  out[5] = W5 * rho * (1 + 3 * a + 4.5 * a * a - usq);
  out[6] = W5 * rho * (1 + 3 * b + 4.5 * b * b - usq);
  out[7] = W5 * rho * (1 - 3 * a + 4.5 * a * a - usq);
  out[8] = W5 * rho * (1 - 3 * b + 4.5 * b * b - usq);
}
