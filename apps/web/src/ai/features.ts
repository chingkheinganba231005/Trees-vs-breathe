import type { GreenElement } from '../sim/greenery';

/** Inputs of the scalar model, in order (FEATURES in python/treesvb/dataset.py, D-034). */
export const FEATURES = [
  'aspect',
  'blocks',
  'a_x0',
  'a_x1',
  'b_x0',
  'b_x1',
  'z0',
  'z1',
  'log10_lam_h',
] as const;

/**
 * H/W of the grid, the number of blocks, the first and last block's edges as shares of the
 * street width, and the first block's bottom, top and log10(lambda H); zeros without blocks.
 * `elements` are in units of H, in the order they stand across the street.
 */
export function features(aspect: number, elements: readonly GreenElement[]): Float32Array {
  const out = new Float32Array(FEATURES.length);
  const w = 1 / aspect;
  out[0] = aspect;
  out[1] = elements.length;
  if (elements.length > 0) {
    const sorted = [...elements].sort((p, q) => p.x0 - q.x0);
    const a = sorted[0]!;
    const b = sorted[sorted.length - 1]!;
    out[2] = a.x0 / w;
    out[3] = a.x1 / w;
    out[4] = b.x0 / w;
    out[5] = b.x1 / w;
    out[6] = a.z0;
    out[7] = a.z1;
    out[8] = Math.log10(a.lamH);
  }
  return out;
}
