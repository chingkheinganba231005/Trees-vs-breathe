import type { Provenance } from './results';
import { result } from './results';

/** A street-sized grid of values, row 0 at the ground. */
export interface Grid {
  rows: number;
  cols: number;
  values: number[];
}

export type RunDesign = 'none' | 'trees' | 'hedge';

/** One design of a recorded street run (python/treesvb/streetruns.py). */
export interface RunRow {
  design: RunDesign;
  healthy: boolean;
  /** Porous blocks, units of H, x from the upwind wall. */
  crowns?: { x0: number; x1: number; z0: number; z1: number; lam_h: number }[];
  /** Mean c+ in each pavement's breathing zone (A leeward) and over the street. */
  pavement?: { A: number; B: number; street: number };
  /** Exposure over the street without greenery. */
  ratio?: { A: number; B: number };
  /** Largest relative difference between the two halves of the averaging window. */
  settling?: number;
  steps?: number;
  cells_per_h?: number;
  /** Stored window in cells, x relative to the street's upwind wall. */
  window?: { x0: number; x1: number; top: number };
  street_cplus?: Grid;
  /** Mean velocity over u_H on a grid of `cells` x `cells` blocks from the window's corner. */
  flow_over_uh?: { rows: number; cols: number; cells: number; ux: number[]; uy: number[] };
}

export interface StreetRun extends Provenance {
  preset: string;
  height_m: number;
  aspect_h_over_w: number;
  height_cells: number;
  width_cells: number;
  schmidt: number;
  local_tree: { height_m: number; spread_m: number };
  zone_m: { width: number; z0: number; z1: number };
  rows: RunRow[];
}

/** The recorded run of a preset at its measured shape (results/streets/run_<key>.json). */
export function streetRun(key: string | null): StreetRun | null {
  return key ? result<StreetRun>(`streets/run_${key}.json`) : null;
}
