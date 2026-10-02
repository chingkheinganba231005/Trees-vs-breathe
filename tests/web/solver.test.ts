import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CpuSolver } from '../../apps/web/src/sim/cpu/solver';
import { buildStreamMap } from '../../apps/web/src/sim/domain';
import {
  concentrationError,
  goldenDomain,
  goldenParams,
  velocityError,
} from '../../apps/web/src/sim/golden';
import type { GoldenCase } from '../../apps/web/src/sim/golden';
import {
  canyonDomain,
  canyonGeometry,
  canyonParams,
  roundHalfEven,
} from '../../apps/web/src/sim/street';

const dir = new URL('../golden/', import.meta.url);
const goldens: GoldenCase[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as GoldenCase);

describe('golden cases from the Python reference', () => {
  it('exist', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(7);
    expect(goldens.some((g) => g.c && g.params.drag)).toBe(true);
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
        if (g.c) expect(concentrationError(g, s.concentration())).toBeLessThan(1e-3);
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

  it('conserves the tracer in a closed box with a source', () => {
    const g = goldens.find((x) => x.name === 'cavity')!;
    const d = goldenDomain(g);
    const source = new Float64Array(d.nx * d.ny);
    source[5 * d.nx + 7] = 1e-3;
    const s = new CpuSolver(d, {
      ...goldenParams(g),
      smagorinsky: 0.17,
      tracer: { source, diffusivity: 1e-4, schmidt: 0.7 },
    });
    s.step(300);
    expect(Math.abs(s.totalTracer() - 0.3) / 0.3).toBeLessThan(1e-5);
  });

  it('reports a healthy state for a calm flow', () => {
    const g = goldens.find((x) => x.name === 'poiseuille')!;
    const s = new CpuSolver(goldenDomain(g), goldenParams(g));
    s.step(50);
    expect(s.healthy()).toBe(true);
  });
});

describe('street canyon builder', () => {
  it('rounds halves like Python', () => {
    expect([0.5, 1.5, 2.5, 3.5, -2.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 4, -2, 2, 3]);
  });

  it.each([
    ['canyon', 1.0, 20000],
    ['canyon_deep', 2.0, 5000],
  ] as const)('%s: TS builder gives the same grid and parameters as Python', (name, aspect, re) => {
    const g = goldens.find((x) => x.name === name)!;
    const geom = canyonGeometry(6, aspect);
    const d = canyonDomain(geom);
    const ref = goldenDomain(g);
    expect([d.nx, d.ny, d.left, d.right, d.bottom, d.top]).toEqual([
      ref.nx,
      ref.ny,
      ref.left,
      ref.right,
      ref.bottom,
      ref.top,
    ]);
    expect(Array.from(d.solid)).toEqual(Array.from(ref.solid));
    const p = canyonParams(geom, { uRef: g.uRef, reynolds: re, smagorinsky: g.params.smagorinsky });
    expect(p.tau0).toBeCloseTo(g.params.tau0, 12);
    expect(p.inletU).toEqual(g.params.inletU);
  });
});
