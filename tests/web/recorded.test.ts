import { describe, expect, it } from 'vitest';
import type { RunRow, StreetRun } from '../../apps/web/src/content/streetRuns';
import { legendTicks } from '../../apps/web/src/sim/fumesColor';
import {
  arrows,
  cropFor,
  inBuilding,
  niceMax,
  recordedCmax,
} from '../../apps/web/src/sim/recorded';

// A synthetic run shaped like results/streets/run_<key>.json; the values are test data only.
const H = 16;
const W = 4;
function row(design: RunRow['design'], peak: number): RunRow {
  const cols = 9; // (H + W + H) / 4
  const rows = 10; // 2.5 H / 4
  return {
    design,
    healthy: true,
    pavement: { A: 1, B: 2, street: 3 },
    settling: 0.1,
    window: { x0: -H, x1: W + H, top: 40 },
    street_cplus: {
      rows: H,
      cols: W,
      values: Array.from({ length: H * W }, (_, i) => (i === 0 ? peak : 1)),
    },
    flow_over_uh: {
      rows,
      cols,
      cells: 4,
      ux: Array.from({ length: rows * cols }, () => 0.5),
      uy: Array.from({ length: rows * cols }, () => 0),
    },
  };
}
const run = {
  height_cells: H,
  width_cells: W,
  height_m: 48,
  rows: [row('none', 120), row('trees', 340)],
} as unknown as StreetRun;

describe('recorded street runs', () => {
  it('rounds the colour scale up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(101)).toBe(200);
    expect(niceMax(340)).toBe(500);
    expect(recordedCmax(run)).toBe(500);
  });

  it('keeps the live key ticks for the live scale', () => {
    expect(legendTicks(100)).toEqual([0, 3, 10, 30, 100]);
    expect(legendTicks(500)).toEqual([0, 3, 10, 30, 100, 500]);
    // 1 000 would sit too close to 5 000 to read on a phone.
    expect(legendTicks(5000)).toEqual([0, 3, 10, 30, 100, 300, 5000]);
  });

  it('crops to the street, a strip of each block and a little sky', () => {
    const c = cropFor(run, run.rows[0]!);
    expect(c.x0).toBeLessThan(0);
    expect(c.x1).toBeGreaterThan(W);
    expect(c.top).toBeGreaterThan(H);
    expect(c.top).toBeLessThanOrEqual(40);
  });

  it('draws no arrows inside the buildings', () => {
    const r = run.rows[0]!;
    const list = arrows(run, r, cropFor(run, r));
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) expect(inBuilding(a.x, a.z, run)).toBe(false);
  });
});
