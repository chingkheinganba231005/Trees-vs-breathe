/**
 * NSGA-II (Deb et al. 2002, IEEE Trans. Evol. Comput. 6(2), 182-197) for minimisation over
 * variables in [0, 1], with Deb's constraint-domination: a feasible solution beats an
 * infeasible one, and of two infeasible ones the smaller violation wins. Simulated binary
 * crossover and polynomial mutation as in that paper. Seeded, so a search can be repeated.
 */

export interface Evaluation {
  objectives: number[];
  /** Total constraint violation; 0 when feasible. */
  violation: number;
}

export interface Individual extends Evaluation {
  x: number[];
  rank: number;
  crowding: number;
}

export interface Nsga2Options {
  population: number;
  generations: number;
  seed: number;
  crossoverProbability?: number;
  crossoverEta?: number;
  mutationEta?: number;
}

/** Mulberry32: a small seeded generator, uniform on [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True if p is better than q under constraint-domination. */
export function dominates(p: Evaluation, q: Evaluation): boolean {
  if (p.violation < q.violation) return true;
  if (p.violation > q.violation) return false;
  let better = false;
  for (let k = 0; k < p.objectives.length; k++) {
    if (p.objectives[k]! > q.objectives[k]!) return false;
    if (p.objectives[k]! < q.objectives[k]!) better = true;
  }
  return better;
}

/** Fronts of indices, best first; sets rank on each individual. */
export function nonDominatedSort<T extends Evaluation & { rank: number }>(pop: T[]): number[][] {
  const n = pop.length;
  const dominated: number[][] = pop.map(() => []);
  const count = new Array<number>(n).fill(0);
  const fronts: number[][] = [[]];
  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      if (p === q) continue;
      if (dominates(pop[p]!, pop[q]!)) dominated[p]!.push(q);
      else if (dominates(pop[q]!, pop[p]!)) count[p]!++;
    }
    if (count[p] === 0) {
      pop[p]!.rank = 0;
      fronts[0]!.push(p);
    }
  }
  for (let i = 0; fronts[i]!.length > 0; i++) {
    const next: number[] = [];
    for (const p of fronts[i]!) {
      for (const q of dominated[p]!) {
        if (--count[q]! === 0) {
          pop[q]!.rank = i + 1;
          next.push(q);
        }
      }
    }
    fronts.push(next);
  }
  fronts.pop();
  return fronts;
}

/** Crowding distance within one front (Deb et al. 2002, section III-B). */
export function crowding<T extends Evaluation & { crowding: number }>(pop: T[], front: number[]) {
  for (const i of front) pop[i]!.crowding = 0;
  const m = pop[front[0]!]?.objectives.length ?? 0;
  for (let k = 0; k < m; k++) {
    const sorted = [...front].sort((a, b) => pop[a]!.objectives[k]! - pop[b]!.objectives[k]!);
    const lo = pop[sorted[0]!]!.objectives[k]!;
    const hi = pop[sorted[sorted.length - 1]!]!.objectives[k]!;
    pop[sorted[0]!]!.crowding = Infinity;
    pop[sorted[sorted.length - 1]!]!.crowding = Infinity;
    if (hi === lo) continue;
    for (let j = 1; j < sorted.length - 1; j++) {
      const gap = pop[sorted[j + 1]!]!.objectives[k]! - pop[sorted[j - 1]!]!.objectives[k]!;
      pop[sorted[j]!]!.crowding += gap / (hi - lo);
    }
  }
}

function better(a: Individual, b: Individual): boolean {
  return a.rank < b.rank || (a.rank === b.rank && a.crowding > b.crowding);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Simulated binary crossover of two parents, variable by variable. */
function sbx(a: number[], b: number[], eta: number, random: () => number): [number[], number[]] {
  const c1 = [...a];
  const c2 = [...b];
  for (let i = 0; i < a.length; i++) {
    if (random() > 0.5 || Math.abs(a[i]! - b[i]!) < 1e-12) continue;
    const u = random();
    const beta = u <= 0.5 ? (2 * u) ** (1 / (eta + 1)) : (1 / (2 * (1 - u))) ** (1 / (eta + 1));
    c1[i] = clamp01(0.5 * ((1 + beta) * a[i]! + (1 - beta) * b[i]!));
    c2[i] = clamp01(0.5 * ((1 - beta) * a[i]! + (1 + beta) * b[i]!));
  }
  return [c1, c2];
}

/** Polynomial mutation, each variable with probability 1 / n. */
function mutate(x: number[], eta: number, random: () => number): number[] {
  return x.map((v) => {
    if (random() >= 1 / x.length) return v;
    const u = random();
    const d = u < 0.5 ? (2 * u) ** (1 / (eta + 1)) - 1 : 1 - (2 * (1 - u)) ** (1 / (eta + 1));
    return clamp01(v + d);
  });
}

/**
 * Evolve a population; `evaluate` scores a batch of variable vectors (the surrogate runs them
 * in one call). Returns the final population, rank 0 first.
 */
export async function nsga2(
  dims: number,
  evaluate: (xs: number[][]) => Promise<Evaluation[]>,
  opts: Nsga2Options,
  onGeneration?: (generation: number, population: Individual[]) => void,
): Promise<Individual[]> {
  const random = rng(opts.seed);
  const pc = opts.crossoverProbability ?? 0.9;
  const etaC = opts.crossoverEta ?? 15;
  const etaM = opts.mutationEta ?? 20;
  const n = opts.population;

  const score = async (xs: number[][]): Promise<Individual[]> =>
    (await evaluate(xs)).map((e, i) => ({ ...e, x: xs[i]!, rank: 0, crowding: 0 }));
  const rankAll = (pop: Individual[]) => {
    for (const f of nonDominatedSort(pop)) crowding(pop, f);
  };

  let pop = await score(Array.from({ length: n }, () => Array.from({ length: dims }, random)));
  rankAll(pop);
  for (let g = 0; g < opts.generations; g++) {
    const pick = () => {
      const a = pop[Math.floor(random() * n)]!;
      const b = pop[Math.floor(random() * n)]!;
      return better(a, b) ? a : b;
    };
    const kids: number[][] = [];
    while (kids.length < n) {
      const [c1, c2] = random() < pc ? sbx(pick().x, pick().x, etaC, random) : [pick().x, pick().x];
      kids.push(mutate(c1, etaM, random), mutate(c2, etaM, random));
    }
    const merged = [...pop, ...(await score(kids.slice(0, n)))];
    const fronts = nonDominatedSort(merged);
    const next: Individual[] = [];
    for (const f of fronts) {
      crowding(merged, f);
      if (next.length + f.length <= n) {
        next.push(...f.map((i) => merged[i]!));
      } else {
        const rest = [...f].sort((a, b) => merged[b]!.crowding - merged[a]!.crowding);
        next.push(...rest.slice(0, n - next.length).map((i) => merged[i]!));
        break;
      }
    }
    pop = next;
    rankAll(pop);
    onGeneration?.(g + 1, pop);
  }
  return [...pop].sort((a, b) => a.rank - b.rank || b.crowding - a.crowding);
}
