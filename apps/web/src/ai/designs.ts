import type { GreenElement } from '../sim/greenery';
import { canyonGeometry } from '../sim/street';

/** Cells per building height of the live grid, which the surrogate was trained on (D-024). */
export const AI_GRID = 24;

/**
 * A design as the surrogate's dataset describes it (Design in python/treesvb/dataset.py), in
 * units of H. Two rows sit `gap` from each wall to their centres; one row sits in the middle;
 * `shift` moves the layout by that share of the room up to the wall on that side.
 */
export interface AiDesign {
  kind: 'none' | 'trees' | 'hedge';
  rows: 1 | 2;
  gap: number;
  width: number;
  z0: number;
  z1: number;
  lamH: number;
  shift: number;
}

/** The street width in H of the live grid for a requested H/W, and that grid's own H/W. */
export function gridStreet(aspect: number): { width: number; aspect: number } {
  const g = canyonGeometry(AI_GRID, aspect);
  return { width: g.width / g.height, aspect: g.height / g.width };
}

/**
 * The porous blocks of a design in a street `streetWidth` H wide (elements in dataset.py):
 * rows that meet become one canopy, the shift stops at the wall, anything wider is cut there.
 */
export function designElements(d: AiDesign, streetWidth: number): GreenElement[] {
  if (d.kind === 'none') return [];
  const half = 0.5 * d.width;
  const mids =
    d.rows === 2
      ? [Math.min(d.gap, 0.5 * streetWidth), streetWidth - Math.min(d.gap, 0.5 * streetWidth)]
      : [0.5 * streetWidth];
  let spans = mids.map((m) => [m - half, m + half] as [number, number]);
  if (spans.length === 2 && spans[0]![1] >= spans[1]![0]) spans = [[spans[0]![0], spans[1]![1]]];
  const lo = spans[0]![0];
  const hi = spans[spans.length - 1]![1];
  const room = d.shift < 0 ? Math.max(0, lo) : Math.max(0, streetWidth - hi);
  const s = d.shift * room;
  return spans.map(([a, b], i) => ({
    id: `${d.kind}-${i}`,
    kind: d.kind === 'hedge' ? 'hedge' : 'trees',
    x0: Math.max(0, a + s),
    x1: Math.min(streetWidth, b + s),
    z0: d.z0,
    z1: d.z1,
    lamH: d.lamH,
  }));
}
