import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CpuSolver } from '../../apps/web/src/sim/cpu/solver';
import { buildStreamMap } from '../../apps/web/src/sim/domain';
import { goldenDomain, goldenParams, velocityError } from '../../apps/web/src/sim/golden';
import type { GoldenCase } from '../../apps/web/src/sim/golden';

const dir = new URL('../golden/', import.meta.url);
const goldens: GoldenCase[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as GoldenCase);

describe('golden cases from the Python reference', () => {
  it('exist', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(6);
  });

  for (const g of goldens) {
    describe(g.name, () => {
      it('streaming map matches Python exactly', () => {
        const { src, add } = buildStreamMap(goldenDomain(g));
        expect(Array.from(src)).toEqual(g.streamMap.src);
        for (let k = 0; k < add.length; k++) {
          expect(add[k]).toBeCloseTo(g.streamMap.add[k]!, 12);
        }
      });

      it('CPU solver reproduces the velocity field within 0.5% (BRIEF 5.2)', () => {
        const s = new CpuSolver(goldenDomain(g), goldenParams(g));
        if (g.initial) {
          s.setState(new Float64Array(g.initial.ux.length).fill(1), g.initial.ux, g.initial.uy);
        }
        s.step(g.steps);
        const f = s.fields();
        const err = velocityError(g, f.ux, f.uy);
        expect(err).toBeLessThan(0.005);
        // float32 storage against float64: a real bug shows up far above this.
        expect(err).toBeLessThan(1e-3);
      });
    });
  }
});

describe('CPU solver', () => {
  it('conserves mass in a closed box', () => {
    const g = goldens.find((x) => x.name === 'cavity')!;
    const s = new CpuSolver(goldenDomain(g), goldenParams(g));
    const m0 = s.totalMass();
    s.step(200);
    expect(Math.abs(s.totalMass() - m0) / m0).toBeLessThan(1e-5);
  });

  it('reports a healthy state for a calm flow', () => {
    const g = goldens.find((x) => x.name === 'poiseuille')!;
    const s = new CpuSolver(goldenDomain(g), goldenParams(g));
    s.step(50);
    expect(s.healthy()).toBe(true);
  });
});
