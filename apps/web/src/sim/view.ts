import type { CanyonGeometry } from './street';
import { canyonNx, streetColumns } from './street';

/** The part of the domain drawn on screen, in lattice cells. */
export interface ViewWindow {
  x0: number;
  width: number;
  height: number;
}

/**
 * Frame the studied street: its two buildings plus half a building depth beyond each, and up to
 * twice the building height so the shear layer over the roofs is visible.
 */
export function streetView(g: CanyonGeometry): ViewWindow {
  const margin = Math.round(0.5 * g.building);
  const [s0, s1] = streetColumns(g);
  const x0 = Math.max(0, s0 - g.building - margin);
  const x1 = Math.min(canyonNx(g), s1 + g.building + margin);
  return { x0, width: x1 - x0, height: Math.min(g.top, 2 * g.height) };
}

export interface SimColors {
  background: [number, number, number];
  building: [number, number, number];
  ink: [number, number, number];
  particle: [number, number, number];
  /** Trees and hedges: green carries only the user's design (theme/tokens.ts). */
  green: [number, number, number];
}

/**
 * Parse a computed CSS colour into 0..1 RGB. The production build minifies #ffffff to #fff and
 * browsers may report rgb(), so all three forms are accepted.
 */
export function parseColor(v: string): [number, number, number] {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m?.[1]) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m)
    return [1, 2, 3].map((i) => parseInt(m![i]! + m![i]!, 16) / 255) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [1, 2, 3].map((i) => Number(m![i]) / 255) as [number, number, number];
  throw new Error(`Unrecognised colour: ${v}`);
}

/** Read the theme's colour tokens, so the canvas follows light and dark mode. */
export function readSimColors(el: Element = document.documentElement): SimColors {
  const css = getComputedStyle(el);
  const get = (name: string) => parseColor(css.getPropertyValue(name));
  return {
    background: get('--surface'),
    building: get('--line'),
    ink: get('--ink-muted'),
    // Wind is drawn in a neutral tone with one meaning only; see BRIEF.md section 11.2.
    particle: get('--ink-muted'),
    green: get('--accent'),
  };
}
