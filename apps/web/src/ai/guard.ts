/**
 * The out-of-distribution guard (BRIEF.md 7.4): a design is answered by the surrogate only if
 * its features lie inside the training box and near enough to a training sample. Written by
 * python/treesvb/surrogate.py as apps/web/public/models/guard.json.
 */
export interface GuardData {
  features: string[];
  low: number[];
  high: number[];
  mean: number[];
  sd: number[];
  /** The bound is this quantile of the training samples' nearest-neighbour distances. */
  quantile: number;
  max_distance: number;
  /** Training samples, standardised with mean and sd. */
  points: number[][];
}

export interface GuardVerdict {
  inBox: boolean;
  /** Distance to the nearest training sample, in standardised features. */
  distance: number;
  near: boolean;
  ok: boolean;
}

export function check(g: GuardData, x: ArrayLike<number>): GuardVerdict {
  let inBox = true;
  const z = new Float64Array(x.length);
  for (let k = 0; k < x.length; k++) {
    const v = x[k]!;
    if (v < g.low[k]! - 1e-9 || v > g.high[k]! + 1e-9) inBox = false;
    z[k] = (v - g.mean[k]!) / g.sd[k]!;
  }
  let best = Infinity;
  for (const p of g.points) {
    let d = 0;
    for (let k = 0; k < z.length; k++) {
      const e = z[k]! - p[k]!;
      d += e * e;
      if (d >= best) break;
    }
    if (d < best) best = d;
  }
  const distance = Math.sqrt(best);
  const near = distance <= g.max_distance;
  return { inBox, distance, near, ok: inBox && near };
}
