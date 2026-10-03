import { fumesRamp } from '../theme/tokens';
import { parseColor } from './view';

/**
 * Colour for the fumes layer. c+ maps to the violet-grey ramp on a log scale up to FUMES_CMAX,
 * which covers the wall values CODASC reports (about 5 to 65) with room near the lanes. Low
 * values fade into the background, so clean air looks clean in both themes; in the dark theme
 * the ramp runs the other way, so high concentrations stay the most visible.
 */
export const FUMES_CMAX = 100;

/** Position on the ramp, 0..1, for a normalised concentration c+, on a log scale up to cmax. */
export function fumesT(cplus: number, cmax = FUMES_CMAX): number {
  if (!(cplus > 0)) return 0;
  return Math.min(1, Math.log1p(cplus) / Math.log1p(cmax));
}

/** Ramp stops as 0..1 RGB, low concentration first, for the given theme. */
export function fumesStops(dark: boolean): [number, number, number][] {
  const stops = fumesRamp.map((c) => parseColor(c));
  return dark ? stops.reverse() : stops;
}

/**
 * Key ticks at 0, steps of 1-3-10 and the top, for a log scale up to cmax. A step tick sits no
 * further than 80% along the key, so its label clears the top label on a phone.
 */
export function legendTicks(cmax: number): number[] {
  const ticks = [0];
  for (let p = 1; p < cmax; p *= 10) {
    for (const m of [1, 3]) {
      if (m * p >= 3 && Math.log1p(m * p) / Math.log1p(cmax) <= 0.8) ticks.push(m * p);
    }
  }
  return [...ticks, cmax];
}

/** Opacity of the fumes layer at ramp position t. */
export function fumesAlpha(t: number): number {
  return Math.min(0.9, 1.4 * t);
}

/** Interpolated ramp colour at t. */
export function fumesColor(t: number, stops: [number, number, number][]): [number, number, number] {
  const s = Math.min(stops.length - 1, Math.max(0, t) * (stops.length - 1));
  const i = Math.min(stops.length - 2, Math.floor(s));
  const f = s - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

/** True when the background is dark (relative luminance below one half). */
export function isDark(background: [number, number, number]): boolean {
  const [r, g, b] = background;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
