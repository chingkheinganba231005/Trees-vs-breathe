import type { ViewWindow } from './view';

/** Max lifetime in frames, so particles spread evenly instead of piling into slow regions. */
export const MAX_AGE = 240;
/** Positions remembered per particle for the CPU renderer's trails. */
export const TRAIL = 8;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear velocity at a point in cell units; node k sits at the centre of its cell. */
export function sampleVelocity(
  ux: ArrayLike<number>,
  uy: ArrayLike<number>,
  nx: number,
  ny: number,
  px: number,
  py: number,
): [number, number] {
  const fx = Math.min(Math.max(px - 0.5, 0), nx - 1.001);
  const fy = Math.min(Math.max(py - 0.5, 0), ny - 1.001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const k = y0 * nx + x0;
  const u =
    (1 - ty) * ((1 - tx) * ux[k]! + tx * ux[k + 1]!) +
    ty * ((1 - tx) * ux[k + nx]! + tx * ux[k + nx + 1]!);
  const v =
    (1 - ty) * ((1 - tx) * uy[k]! + tx * uy[k + 1]!) +
    ty * ((1 - tx) * uy[k + nx]! + tx * uy[k + nx + 1]!);
  return [u, v];
}

/** Wind markers for the CPU renderer; the GPU path runs the same rules in a compute shader. */
export class Particles {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Recent positions, newest first: trailX[p * TRAIL + j]. */
  readonly trailX: Float32Array;
  readonly trailY: Float32Array;
  readonly age: Uint16Array;
  private readonly rand: () => number;
  private view: ViewWindow;
  private solid: (x: number, y: number) => boolean;

  constructor(count: number, view: ViewWindow, solid: (x: number, y: number) => boolean, seed = 1) {
    this.count = count;
    this.view = view;
    this.solid = solid;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.trailX = new Float32Array(count * TRAIL);
    this.trailY = new Float32Array(count * TRAIL);
    this.age = new Uint16Array(count);
    this.rand = mulberry32(seed);
    for (let p = 0; p < count; p++) {
      this.respawn(p);
      this.age[p] = Math.floor(this.rand() * MAX_AGE);
    }
  }

  setView(view: ViewWindow, solid: (x: number, y: number) => boolean): void {
    this.view = view;
    this.solid = solid;
    for (let p = 0; p < this.count; p++) this.respawn(p);
  }

  private respawn(p: number): void {
    for (let tries = 0; tries < 20; tries++) {
      const x = this.view.x0 + this.rand() * this.view.width;
      const y = this.rand() * this.view.height;
      if (!this.solid(x, y)) {
        this.x[p] = x;
        this.y[p] = y;
        this.trailX.fill(x, p * TRAIL, (p + 1) * TRAIL);
        this.trailY.fill(y, p * TRAIL, (p + 1) * TRAIL);
        this.age[p] = 0;
        return;
      }
    }
  }

  /** Move every marker by the local velocity times the lattice steps since the last frame. */
  advect(
    ux: ArrayLike<number>,
    uy: ArrayLike<number>,
    nx: number,
    ny: number,
    steps: number,
  ): void {
    const { view } = this;
    for (let p = 0; p < this.count; p++) {
      const x = this.x[p]!;
      const y = this.y[p]!;
      const [u, v] = sampleVelocity(ux, uy, nx, ny, x, y);
      const nx1 = x + u * steps;
      const ny1 = y + v * steps;
      const age = this.age[p]! + 1;
      const out = nx1 < view.x0 || nx1 >= view.x0 + view.width || ny1 < 0 || ny1 >= view.height;
      if (out || age > MAX_AGE || this.solid(nx1, ny1)) {
        this.respawn(p);
        continue;
      }
      const base = p * TRAIL;
      this.trailX.copyWithin(base + 1, base, base + TRAIL - 1);
      this.trailY.copyWithin(base + 1, base, base + TRAIL - 1);
      this.trailX[base] = nx1;
      this.trailY[base] = ny1;
      this.x[p] = nx1;
      this.y[p] = ny1;
      this.age[p] = age;
    }
  }
}
