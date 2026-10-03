import { describe, expect, it } from 'vitest';
import type { GuardData } from '../../apps/web/src/ai/guard';
import {
  GENES,
  TRAINED,
  decode,
  picks,
  score,
  search,
  searchBounds,
} from '../../apps/web/src/ai/tradeoff';
import { CROWN_LAM_H, FULL_SCALE_HEIGHT_M } from '../../apps/web/src/sim/greenery';
import {
  CROWN_TRANSMISSIVITY,
  crownTransmissivity,
  hourWeather,
} from '../../apps/web/src/sun/heat';
import { weatherPresets } from '../../apps/web/src/sun/weather';

const weather = hourWeather(
  weatherPresets().find((d) => d.key === 'very_hot')!,
  13,
);
const street = { aspect: 1, heightM: 18, axisDeg: 0 };

/** Accepts everything; fumes rise and wind falls with crown cover (a stand-in, not the model). */
const guard: GuardData = {
  features: [],
  low: Array(9).fill(-1e9),
  high: Array(9).fill(1e9),
  mean: Array(9).fill(0),
  sd: Array(9).fill(1),
  quantile: 0.99,
  max_distance: 1e9,
  points: [Array(9).fill(0)],
};
const fake = {
  guard,
  async scalar(fs: Float32Array[]) {
    return fs.map((f) => {
      const cover = (f[3]! - f[2]! + (f[1] === 2 ? f[5]! - f[4]! : 0)) * (f[7]! - f[6]!);
      const lr = cover * f[8]!;
      return Array.from({ length: 5 }, (_, m) => [lr + 0.01 * (m - 2), lr, -1 - cover, -1 - cover]);
    });
  },
};

describe('the trade-off search', () => {
  it('decodes every genome into a design inside the trained ranges', () => {
    const b = searchBounds(36.8);
    for (let k = 0; k < 200; k++) {
      const x = Array.from({ length: GENES }, (_, i) => ((k * 7919 + i * 104729) % 1000) / 1000);
      const d = decode(x, b);
      const r = d.kind === 'hedge' ? TRAINED.hedge : TRAINED.trees;
      expect(d.lamH).toBeGreaterThanOrEqual(r.lamH[0] - 1e-9);
      expect(d.lamH).toBeLessThanOrEqual(r.lamH[1] + 1e-9);
      expect(d.z1).toBeLessThanOrEqual(r.top[1] + 1e-9);
      expect(d.z0).toBeLessThan(d.z1);
      expect(Math.abs(d.shift)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps crowns between CODASC light and dense per metre and hedges at their real sizes', () => {
    const b = searchBounds(FULL_SCALE_HEIGHT_M);
    expect(b.trees.lamH).toEqual([CROWN_LAM_H.light, CROWN_LAM_H.dense]);
    expect(b.hedge.top[0]).toBeCloseTo(1.5 / 18, 12);
    expect(b.hedge.top[1]).toBeCloseTo(2.5 / 18, 12);
  });

  it('interpolates crown transmissivity between the light and dense crowns', () => {
    const at = (lamH: number) =>
      crownTransmissivity({ id: 't', kind: 'trees', x0: 0, x1: 1, z0: 0.3, z1: 1, lamH }, 18);
    expect(at(CROWN_LAM_H.light)).toBeCloseTo(CROWN_TRANSMISSIVITY.light, 12);
    expect(at(CROWN_LAM_H.dense)).toBeCloseTo(CROWN_TRANSMISSIVITY.dense, 12);
    expect(at(1)).toBeCloseTo(CROWN_TRANSMISSIVITY.light, 12);
    const mid = at(0.5 * (CROWN_LAM_H.light + CROWN_LAM_H.dense));
    expect(mid).toBeCloseTo(0.5 * (CROWN_TRANSMISSIVITY.light + CROWN_TRANSMISSIVITY.dense), 12);
  });

  it('scores designs: crowns shade the pavements and, in the stand-in, raise fumes', async () => {
    const b = searchBounds(18);
    const bare = {
      kind: 'none',
      rows: 1,
      gap: 0,
      width: 0,
      z0: 0,
      z1: 0,
      lamH: 0,
      shift: 0,
    } as const;
    const wide = decode([0, 1, 0.1, 0.9, 1, 0.1, 1, 0.5], b);
    const [s0, s1] = await score([bare, wide], street, weather, fake);
    expect(s0!.fumes).toBeCloseTo(1, 6);
    expect(s1!.fumes).toBeGreaterThan(1);
    expect(s1!.heat).toBeLessThan(s0!.heat);
    expect(s1!.ratioRange.A[0]).toBeLessThan(s1!.ratio.A);
  });

  it('finds a front from cool and dirty to warm and clean, and picks from it', async () => {
    const out = await search(street, weather, fake, { population: 24, generations: 8, seed: 1 });
    expect(out.front.length).toBeGreaterThan(3);
    const p = picks(out.front);
    expect(p.cleanest!.fumes).toBeLessThanOrEqual(Math.min(...out.front.map((q) => q.fumes)));
    expect(p.balanced).not.toBeNull();
    if (p.coolest) expect(p.coolest.fumes).toBeLessThanOrEqual(1);
  });

  it('picks the knee of a known front', () => {
    const front = [
      { heat: 0, fumes: 1 },
      { heat: 0.1, fumes: 0.3 },
      { heat: 0.5, fumes: 0.15 },
      { heat: 1, fumes: 0 },
    ];
    expect(picks(front).balanced).toBe(front[1]);
    expect(picks(front).cleanest).toBe(front[3]);
    expect(picks(front).coolest).toBe(front[0]);
  });
});
