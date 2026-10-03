import { describe, expect, it } from 'vitest';
import type { Evaluation } from '../../apps/web/src/ai/nsga2';
import { dominates, nonDominatedSort, nsga2, rng } from '../../apps/web/src/ai/nsga2';

/** ZDT1 (Zitzler, Deb and Thiele 2000): the Pareto front is f2 = 1 - sqrt(f1), x[1..] = 0. */
function zdt1(x: number[]): Evaluation {
  const g = 1 + (9 * x.slice(1).reduce((s, v) => s + v, 0)) / (x.length - 1);
  return { objectives: [x[0]!, g * (1 - Math.sqrt(x[0]! / g))], violation: 0 };
}

describe('NSGA-II', () => {
  it('sorts fronts with constraint-domination', () => {
    const pop = [
      { objectives: [1, 1], violation: 0, rank: -1 },
      { objectives: [0, 2], violation: 0, rank: -1 },
      { objectives: [2, 2], violation: 0, rank: -1 },
      { objectives: [0, 0], violation: 1, rank: -1 },
    ];
    expect(dominates(pop[0]!, pop[2]!)).toBe(true);
    expect(dominates(pop[2]!, pop[3]!)).toBe(true); // feasible beats infeasible
    expect(nonDominatedSort(pop)).toEqual([[0, 1], [2], [3]]);
  });

  it('finds the ZDT1 front', async () => {
    const out = await nsga2(5, async (xs) => xs.map(zdt1), {
      population: 60,
      generations: 150,
      seed: 3,
    });
    const front = out.filter((p) => p.rank === 0);
    expect(front.length).toBeGreaterThan(30);
    const gap = front.map((p) => Math.abs(p.objectives[1]! - (1 - Math.sqrt(p.objectives[0]!))));
    expect(Math.max(...gap)).toBeLessThan(0.05);
    // Spread over the front, not one point.
    const f1 = front.map((p) => p.objectives[0]!);
    expect(Math.min(...f1)).toBeLessThan(0.05);
    expect(Math.max(...f1)).toBeGreaterThan(0.9);
  });

  it('repeats a search exactly from the same seed', async () => {
    const run = () =>
      nsga2(3, async (xs) => xs.map(zdt1), { population: 20, generations: 5, seed: 9 });
    expect((await run()).map((p) => p.x)).toEqual((await run()).map((p) => p.x));
    const r = rng(1);
    expect(r()).not.toEqual(r());
  });
});
