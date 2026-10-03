import { describe, expect, it } from 'vitest';
import { designElements, gridStreet } from '../../apps/web/src/ai/designs';
import { runPhysics } from '../../apps/web/src/ai/physicsRun';

describe('the physics check', () => {
  it('runs a design and reports pavement fumes, wind and how much the street kept', () => {
    const g = gridStreet(1);
    const trees = designElements(
      { kind: 'trees', rows: 2, gap: 0.15, width: 0.3, z0: 0.3, z1: 1, lamH: 24, shift: 0 },
      g.width,
    );
    let last = 0;
    const out = runPhysics(
      { aspect: 1, elements: trees, spinUp: 400, average: 400, every: 20 },
      (s) => {
        last = s;
      },
    );
    expect(last).toBe(800);
    expect(out.healthy).toBe(true);
    for (const h of out.exposure) {
      expect(h.A).toBeGreaterThan(0);
      expect(h.B).toBeGreaterThan(0);
    }
    for (const w of out.wind) expect(w.A).toBeGreaterThan(0);
    // Early in the run the street is still filling: it keeps most of what is released.
    expect(out.retained[0]).toBeGreaterThan(0.1);
    expect(out.retained[0]).toBeLessThanOrEqual(1.01);
  }, 60_000);
});
