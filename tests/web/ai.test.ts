import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiDesign } from '../../apps/web/src/ai/designs';
import { designElements, gridStreet } from '../../apps/web/src/ai/designs';
import { features } from '../../apps/web/src/ai/features';
import {
  FIELD_CHANNELS,
  FIELD_COLS,
  FIELD_ROWS,
  fieldInput,
} from '../../apps/web/src/ai/fieldInput';
import { check } from '../../apps/web/src/ai/guard';
import type { GuardData } from '../../apps/web/src/ai/guard';

interface Row {
  design: {
    aspect: number;
    kind: AiDesign['kind'];
    rows: number;
    gap: number;
    width: number;
    z0: number;
    z1: number;
    lam_h: number;
    shift: number;
  };
  grid_width: number;
  grid_aspect: number;
  blocks: { x0: number; x1: number; z0: number; z1: number; lam_h: number }[];
  features: number[];
  field_input_sums: number[];
  field_input_probe: number[];
}

const ref = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../reference/ai_designs.json'), 'utf8'),
) as { rows: Row[] };

function toDesign(d: Row['design']): AiDesign {
  return { ...d, rows: d.rows === 2 ? 2 : 1, lamH: d.lam_h };
}

describe('the surrogate inputs match python/treesvb (tests/reference/ai_designs.json)', () => {
  it('lays out the same blocks on the same grid', () => {
    for (const r of ref.rows) {
      const g = gridStreet(r.design.aspect);
      expect(g.width).toBeCloseTo(r.grid_width, 12);
      expect(g.aspect).toBeCloseTo(r.grid_aspect, 12);
      const els = designElements(toDesign(r.design), g.width);
      expect(els.map((e) => [e.x0, e.x1, e.z0, e.z1, e.lamH])).toEqual(
        r.blocks
          .map((b) => [b.x0, b.x1, b.z0, b.z1, b.lam_h])
          .map((v) => v.map((x) => expect.closeTo(x, 12))),
      );
    }
  });

  it('computes the same features and field input', () => {
    for (const r of ref.rows) {
      const g = gridStreet(r.design.aspect);
      const els = designElements(toDesign(r.design), g.width);
      const f = features(g.aspect, els);
      r.features.forEach((v, k) => expect(f[k]).toBeCloseTo(v, 5));
      const x = fieldInput(g.aspect, els);
      expect(x.length).toBe(FIELD_CHANNELS * FIELD_ROWS * FIELD_COLS);
      const plane = FIELD_ROWS * FIELD_COLS;
      for (let c = 0; c < FIELD_CHANNELS; c++) {
        let s = 0;
        for (let k = 0; k < plane; k++) s += x[c * plane + k]!;
        expect(s).toBeCloseTo(r.field_input_sums[c]!, 1);
        expect(x[c * plane + 5 * FIELD_COLS + 40]).toBeCloseTo(r.field_input_probe[c]!, 5);
      }
    }
  });
});

describe('the out-of-distribution guard', () => {
  const g: GuardData = {
    features: ['a', 'b'],
    low: [0, 0],
    high: [1, 1],
    mean: [0.5, 0.5],
    sd: [0.5, 0.5],
    quantile: 0.99,
    max_distance: 0.2,
    points: [
      [-1, -1],
      [1, 1],
    ],
  };

  it('accepts a design next to a training sample', () => {
    expect(check(g, [0.02, 0.03]).ok).toBe(true);
  });

  it('refuses a design outside the box or far from every sample', () => {
    expect(check(g, [1.2, 1]).inBox).toBe(false);
    const middle = check(g, [0.5, 0.5]);
    expect(middle.inBox).toBe(true);
    expect(middle.near).toBe(false);
    expect(middle.distance).toBeCloseTo(Math.SQRT2, 6);
  });
});
