import type { Provenance } from './results';
import { result } from './results';

/** Median and middle half (25th to 75th percentile) over a measured stretch. */
export interface Spread {
  median: number;
  p25: number;
  p75: number;
}

export interface StreetPreset {
  key: string;
  label_en: string;
  label_tc: string;
  street_name: string;
  /** Monitoring station the stretch is centred on, or null for the whole street. */
  centred_on: string | null;
  stretch_length_m: number;
  /** Measuring points along the stretch, and how many saw a street wall on both sides. */
  points: number;
  used: number;
  width_m: Spread;
  height_m: Spread;
  aspect_h_over_w: Spread;
  /** Street axis, degrees clockwise from grid north, 0-180. */
  bearing_deg: number;
}

export interface PresetsResult extends Provenance {
  rows: StreetPreset[];
}

/** The measured street presets (results/streets/presets.json), or none before they exist. */
export function streetPresets(): StreetPreset[] {
  return result<PresetsResult>('streets/presets.json')?.rows ?? [];
}

export function presetByKey(key: string | null): StreetPreset | null {
  return streetPresets().find((p) => p.key === key) ?? null;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof POINTS)[number];

/** The two compass points a street axis runs between, e.g. 117 degrees runs SE and NW. */
export function streetEnds(bearing: number): [CompassPoint, CompassPoint] {
  const at = (b: number) => POINTS[Math.round((((b % 360) + 360) % 360) / 45) % 8]!;
  return [at(bearing), at(bearing + 180)];
}

/** Typical roadside tree near a street (results/streets/trees.json, assumption A-014). */
export interface LocalTree {
  /** Trees on the measured stretch in the Highways Department records. */
  trees_on_stretch?: number;
  roadside_trees: number;
  dbh_mm: Spread;
  height_m?: Spread;
  crown_spread_m?: Spread;
}

interface TreesResult extends Provenance {
  rows: (LocalTree & { key: string })[];
  overall: LocalTree;
}

/** The local tree near a preset, or over all preset areas when `key` is null. */
export function localTree(key: string | null): LocalTree | null {
  const r = result<TreesResult>('streets/trees.json');
  if (!r) return null;
  return key === null ? r.overall : (r.rows.find((t) => t.key === key) ?? null);
}
