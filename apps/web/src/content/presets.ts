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

export interface CustomStreet {
  key: 'custom';
  heightM: number;
  widthM: number;
  pavementLeftM: number;
  pavementRightM: number;
  bearingDeg: number;
  aspectHOverW: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function parseCustomStreet(query: string | null): CustomStreet | null {
  if (!query) return null;
  const hashOrQuery = query.includes('?') ? query.split('?').slice(1).join('?') : query;
  const params = new URLSearchParams(hashOrQuery.startsWith('/') ? hashOrQuery.slice(1) : hashOrQuery);
  if (params.get('street') !== 'custom' && !params.has('custom')) return null;

  const aspect = Number(params.get('aspect') ?? '0');
  const height = Number(params.get('height') ?? '0');
  const width = Number(params.get('width') ?? '0');
  const bearing = Number(params.get('bearing') ?? '0');
  const left = Number(params.get('pavementLeft') ?? params.get('pavement_left') ?? '2');
  const right = Number(params.get('pavementRight') ?? params.get('pavement_right') ?? '2');

  const resolvedHeight = clamp(Number.isFinite(height) && height > 0 ? height : 30, 6, 200);
  const resolvedWidth = clamp(Number.isFinite(width) && width > 0 ? width : resolvedHeight / (Number.isFinite(aspect) && aspect > 0 ? aspect : 1), 6, 200);
  const resolvedAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : resolvedHeight / resolvedWidth;
  const resolvedBearing = Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : 0;
  const resolvedLeft = clamp(Number.isFinite(left) && left >= 0 ? left : 2, 0, resolvedWidth);
  const resolvedRight = clamp(Number.isFinite(right) && right >= 0 ? right : 2, 0, resolvedWidth);

  return {
    key: 'custom',
    heightM: resolvedHeight,
    widthM: resolvedWidth,
    pavementLeftM: resolvedLeft,
    pavementRightM: resolvedRight,
    bearingDeg: resolvedBearing,
    aspectHOverW: resolvedAspect,
  };
}

export function customStreetHref(values: {
  heightM: number;
  widthM: number;
  pavementLeftM: number;
  pavementRightM: number;
  bearingDeg: number;
}): string {
  const params = new URLSearchParams({
    street: 'custom',
    height: String(values.heightM),
    width: String(values.widthM),
    pavementLeft: String(values.pavementLeftM),
    pavementRight: String(values.pavementRightM),
    bearing: String(values.bearingDeg),
  });
  return `#/design?${params.toString()}`;
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

/** The nearest of the eight compass points to a bearing in degrees. */
export function compassPoint(bearing: number): CompassPoint {
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;
}

/** The two compass points a street axis runs between, e.g. 117 degrees runs SE and NW. */
export function streetEnds(bearing: number): [CompassPoint, CompassPoint] {
  return [compassPoint(bearing), compassPoint(bearing + 180)];
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
