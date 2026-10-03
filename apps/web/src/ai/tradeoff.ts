/**
 * The trade-off between heat and fumes (BRIEF.md 7.5): designs scored by the surrogate (fumes and
 * pavement wind) and the heat model (UTCI with the design's shade), searched with NSGA-II.
 */
import type { GreenElement } from '../sim/greenery';
import { CROWN_LAM_H, FULL_SCALE_HEIGHT_M, HEDGE_HEIGHTS_M, HEDGE_LAMBDAS } from '../sim/greenery';
import { PERSON_HEIGHT_M } from '../sun/canyon';
import type { ShadeCrown } from '../sun/canyon';
import type { HourWeather } from '../sun/heat';
import { CROWN_TRANSMISSIVITY, pavementHeat } from '../sun/heat';
import type { AiDesign } from './designs';
import { designElements, gridStreet } from './designs';
import { features } from './features';
import { check } from './guard';
import type { GuardVerdict } from './guard';
import type { Individual } from './nsga2';
import { nsga2 } from './nsga2';
import type { Surrogate } from './runtime';

type Range = readonly [number, number];

/** The dataset's design ranges in units of H (TREE_RANGES, HEDGE_RANGES in dataset.py, A-025). */
export const TRAINED = {
  trees: {
    width: [0.05, 1.2],
    gap: [0.1, 0.6],
    top: [0.15, 1.0],
    base: [0.1, 0.7],
    lamH: [4, 100],
  },
  hedge: { top: [0.03, 0.15], width: [0.03, 0.1], lamH: [25, 180] },
} as const satisfies Record<string, Record<string, Range>>;

/** The pavement zone of the live app and the dataset, units of H (A-010). */
export const PAVEMENT_ZONE = 0.15;

export interface SearchStreet {
  /** H/W as asked; the live grid rounds it (gridStreet). */
  aspect: number;
  heightM: number;
  axisDeg: number;
}

export interface Bounds {
  trees: { width: Range; gap: Range; top: Range; base: Range; lamH: Range };
  hedge: { top: Range; width: Range; lamH: Range };
}

function within(r: Range, limits: Range): Range {
  const lo = Math.min(Math.max(r[0], limits[0]), limits[1]);
  const hi = Math.min(Math.max(r[1], limits[0]), limits[1]);
  return [lo, Math.max(lo, hi)];
}

/**
 * What the search may plant in a street `heightM` tall (A-027): crowns as dense as CODASC's light
 * to dense crowns per metre, hedges of the heights and densities on the Design screen, 1.5 m wide;
 * all inside the ranges the surrogate was trained on.
 */
export function searchBounds(heightM: number): Bounds {
  const perM = (lamH: number) => (lamH * heightM) / FULL_SCALE_HEIGHT_M;
  const t = TRAINED.trees;
  const h = TRAINED.hedge;
  return {
    trees: {
      width: t.width,
      gap: t.gap,
      top: t.top,
      base: t.base,
      lamH: within([perM(CROWN_LAM_H.light), perM(CROWN_LAM_H.dense)], t.lamH),
    },
    hedge: {
      top: within([HEDGE_HEIGHTS_M[0] / heightM, HEDGE_HEIGHTS_M[1] / heightM], h.top),
      width: within([1.5 / heightM, 1.5 / heightM], h.width),
      lamH: within([HEDGE_LAMBDAS[0] * heightM, HEDGE_LAMBDAS[1] * heightM], h.lamH),
    },
  };
}

const lin = (u: number, r: Range) => r[0] + u * (r[1] - r[0]);
const log = (u: number, r: Range) =>
  Math.exp(Math.log(r[0]) + u * (Math.log(r[1]) - Math.log(r[0])));

/** Number of genes in a search genome. */
export const GENES = 8;

/**
 * A genome of GENES values in [0, 1] as a design: gene 0 picks trees or a hedge, gene 1 one or
 * two rows, then gap, width, top, crown base, density and shift.
 */
export function decode(x: readonly number[], b: Bounds): AiDesign {
  const shift = 2 * x[7]! - 1;
  if (x[0]! >= 0.5) {
    return {
      kind: 'hedge',
      rows: 1,
      gap: 0,
      width: lin(x[3]!, b.hedge.width),
      z0: 0,
      z1: lin(x[4]!, b.hedge.top),
      lamH: log(x[6]!, b.hedge.lamH),
      shift,
    };
  }
  const top = lin(x[4]!, b.trees.top);
  const rows = x[1]! >= 0.5 ? 2 : 1;
  return {
    kind: 'trees',
    rows,
    gap: rows === 2 ? lin(x[2]!, b.trees.gap) : 0,
    width: log(x[3]!, b.trees.width),
    z0: lin(x[5]!, b.trees.base) * top,
    z1: top,
    lamH: log(x[6]!, b.trees.lamH),
    shift,
  };
}

/**
 * Share of direct sunlight a crown lets through, from its density per metre: Takacs et al.'s
 * light-crown value at CODASC's light crown, their dense-crown value at the dense crown, linear in
 * between and held beyond (A-018, A-027). A hedge counts as dense, as on the Design screen.
 */
export function transmissivity(e: GreenElement, heightM: number): number {
  if (e.kind === 'hedge') return CROWN_TRANSMISSIVITY.dense;
  const perM = e.lamH / heightM;
  const light = CROWN_LAM_H.light / FULL_SCALE_HEIGHT_M;
  const dense = CROWN_LAM_H.dense / FULL_SCALE_HEIGHT_M;
  const t = Math.min(1, Math.max(0, (perM - light) / (dense - light)));
  return CROWN_TRANSMISSIVITY.light + t * (CROWN_TRANSMISSIVITY.dense - CROWN_TRANSMISSIVITY.light);
}

export interface Scored {
  design: AiDesign;
  elements: GreenElement[];
  features: Float32Array;
  guard: GuardVerdict;
  /** Fumes on each pavement against the bare street: ensemble mean and its spread (low, high). */
  ratio: { A: number; B: number };
  ratioRange: { A: [number, number]; B: [number, number] };
  /** Pavement wind as a share of the roof wind. */
  wind: { A: number; B: number };
  /** UTCI on each pavement, degrees C; null before sunrise data or without weather. */
  utci: { A: number; B: number } | null;
  heat: number;
  fumes: number;
}

/** Ensemble statistics of one design's outputs (members x outputs, logs). */
export function summarise(members: number[][]) {
  const n = members.length;
  const mean = [0, 1, 2, 3].map((k) => members.reduce((s, m) => s + m[k]!, 0) / n);
  const sd = [0, 1, 2, 3].map((k) =>
    Math.sqrt(members.reduce((s, m) => s + (m[k]! - mean[k]!) ** 2, 0) / n),
  );
  const range = (k: number): [number, number] => [
    Math.exp(mean[k]! - 2 * sd[k]!),
    Math.exp(mean[k]! + 2 * sd[k]!),
  ];
  return {
    ratio: { A: Math.exp(mean[0]!), B: Math.exp(mean[1]!) },
    ratioRange: { A: range(0), B: range(1) },
    wind: { A: Math.exp(mean[2]!), B: Math.exp(mean[3]!) },
  };
}

/** Score designs in one call to the surrogate, then the heat model for each. */
export async function score(
  designs: AiDesign[],
  street: SearchStreet,
  weather: HourWeather,
  surrogate: Pick<Surrogate, 'scalar' | 'guard'>,
): Promise<Scored[]> {
  const grid = gridStreet(street.aspect);
  const els = designs.map((d) => designElements(d, grid.width));
  const feats = els.map((e) => features(grid.aspect, e));
  const out = await surrogate.scalar(feats);
  return designs.map((design, i) => {
    const s = summarise(out[i]!);
    const crowns: ShadeCrown[] = els[i]!.map((e) => ({
      x0: e.x0 * street.heightM,
      x1: e.x1 * street.heightM,
      z0: e.z0 * street.heightM,
      z1: e.z1 * street.heightM,
      transmissivity: transmissivity(e, street.heightM),
    }));
    const heat = pavementHeat(
      {
        heightM: street.heightM,
        widthM: street.heightM * grid.width,
        axisDeg: street.axisDeg,
        crowns,
      },
      weather,
      PAVEMENT_ZONE * street.heightM,
      s.wind,
      PERSON_HEIGHT_M,
    );
    const utci = heat.A && heat.B ? { A: heat.A.utci, B: heat.B.utci } : null;
    return {
      design,
      elements: els[i]!,
      features: feats[i]!,
      guard: check(surrogate.guard, feats[i]!),
      ...s,
      utci,
      heat: utci ? 0.5 * (utci.A + utci.B) : NaN,
      fumes: 0.5 * (s.ratio.A + s.ratio.B),
    };
  });
}

/** How far a design lies outside what the surrogate knows; 0 inside. */
export function violation(g: GuardVerdict, maxDistance: number): number {
  return (g.inBox ? 0 : 1) + Math.max(0, g.distance - maxDistance);
}

export interface SearchResult {
  front: (Scored & { x: number[] })[];
  all: (Scored & { x: number[]; rank: number })[];
}

/** NSGA-II over the genome: minimise heat and fumes, designs outside the training data last. */
export async function search(
  street: SearchStreet,
  weather: HourWeather,
  surrogate: Pick<Surrogate, 'scalar' | 'guard'>,
  opts: { population: number; generations: number; seed: number },
  onGeneration?: (g: number) => void,
): Promise<SearchResult> {
  const bounds = searchBounds(street.heightM);
  const cache = new Map<string, Scored>();
  const evaluate = async (xs: number[][]) => {
    const scored = await score(
      xs.map((x) => decode(x, bounds)),
      street,
      weather,
      surrogate,
    );
    xs.forEach((x, i) => cache.set(x.join(','), scored[i]!));
    return scored.map((s) => ({
      objectives: [s.heat, s.fumes],
      violation: violation(s.guard, surrogate.guard.max_distance),
    }));
  };
  const pop: Individual[] = await nsga2(GENES, evaluate, opts, onGeneration);
  const all = pop.map((p) => ({ ...cache.get(p.x.join(','))!, x: p.x, rank: p.rank }));
  const front = all.filter((p) => p.rank === 0 && p.guard.ok).sort((a, b) => a.heat - b.heat);
  return { front, all };
}

/**
 * The three picks on a front sorted by heat: the coolest design whose fumes are no worse than
 * the bare street on average, the design with the cleanest air, and the balance point: after
 * scaling heat and fumes to 0-1 over the front, the design farthest from the straight line
 * joining its two ends.
 */
export function picks<T extends { heat: number; fumes: number }>(front: T[]) {
  if (front.length === 0) return { coolest: null, cleanest: null, balanced: null };
  const cleanest = front.reduce((a, b) => (b.fumes < a.fumes ? b : a));
  const cool = front.filter((p) => p.fumes <= 1);
  const coolest = cool.length ? cool.reduce((a, b) => (b.heat < a.heat ? b : a)) : null;
  const h = front.map((p) => p.heat);
  const f = front.map((p) => p.fumes);
  const [h0, h1, f0, f1] = [Math.min(...h), Math.max(...h), Math.min(...f), Math.max(...f)];
  const nh = (v: number) => (h1 > h0 ? (v - h0) / (h1 - h0) : 0);
  const nf = (v: number) => (f1 > f0 ? (v - f0) / (f1 - f0) : 0);
  const a = front[0]!;
  const b = front[front.length - 1]!;
  const [ax, ay, bx, by] = [nh(a.heat), nf(a.fumes), nh(b.heat), nf(b.fumes)];
  const len = Math.hypot(bx - ax, by - ay);
  let balanced: T | null = null;
  let best = -1;
  for (const p of front) {
    const d =
      len > 0
        ? Math.abs((by - ay) * nh(p.heat) - (bx - ax) * nf(p.fumes) + bx * ay - by * ax) / len
        : 0;
    if (d > best) {
      best = d;
      balanced = p;
    }
  }
  return { coolest, cleanest, balanced };
}
