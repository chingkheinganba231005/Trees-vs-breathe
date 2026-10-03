import type { GreenElement } from '../sim/greenery';

/** The street grid of the field model: rows from the ground to the roofs, columns wall to wall. */
export const FIELD_ROWS = 64;
export const FIELD_COLS = 128;
export const FIELD_CHANNELS = 5;

/** Share of each of n equal cells on [0, 1] that lies inside [lo, hi]. */
function cover(lo: number, hi: number, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(0, Math.min((i + 1) / n, hi) - Math.max(i / n, lo)) * n;
  }
  return out;
}

/**
 * The design drawn on the street grid, channels drag, cover, H/W, x and z, row 0 at the ground
 * (field_input in python/treesvb/surrogate.py). drag is the cover times log10(lambda H) / 2.5.
 */
export function fieldInput(aspect: number, elements: readonly GreenElement[]): Float32Array {
  const plane = FIELD_ROWS * FIELD_COLS;
  const out = new Float32Array(FIELD_CHANNELS * plane);
  for (const e of elements) {
    if (e.x1 <= e.x0 || e.z1 <= e.z0) continue;
    const rows = cover(e.z0, e.z1, FIELD_ROWS);
    const cols = cover(e.x0 * aspect, e.x1 * aspect, FIELD_COLS);
    const drag = Math.log10(e.lamH) / 2.5;
    for (let j = 0; j < FIELD_ROWS; j++) {
      if (rows[j] === 0) continue;
      for (let i = 0; i < FIELD_COLS; i++) {
        const c = rows[j]! * cols[i]!;
        const k = j * FIELD_COLS + i;
        out[plane + k] = out[plane + k]! + c;
        out[k] = out[k]! + c * drag;
      }
    }
  }
  for (let j = 0; j < FIELD_ROWS; j++) {
    for (let i = 0; i < FIELD_COLS; i++) {
      const k = j * FIELD_COLS + i;
      out[2 * plane + k] = aspect / 2;
      out[3 * plane + k] = (i + 0.5) / FIELD_COLS;
      out[4 * plane + k] = (j + 0.5) / FIELD_ROWS;
    }
  }
  return out;
}
