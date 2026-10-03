import type { RunRow, StreetRun } from '../content/streetRuns';
import { fumesAlpha, fumesColor, fumesStops, fumesT, isDark } from './fumesColor';
import type { SimColors } from './view';

/** Part of a recorded run to draw, in cells: x from the street's upwind wall, z from the ground. */
export interface Crop {
  x0: number;
  x1: number;
  top: number;
}

/** Building on each side and sky above the roofs shown around the street, units of H. */
const SIDE_H = 0.4;
const ABOVE_H = 0.3;
/** Arrows across the drawn width. */
const ARROWS_ACROSS = 9;

/** The street with a strip of the blocks on each side and a little sky, inside the stored window. */
export function cropFor(run: StreetRun, row: RunRow): Crop {
  const h = run.height_cells;
  const w = row.window ?? { x0: -h, x1: run.width_cells + h, top: 2 * h };
  return {
    x0: Math.max(w.x0, -Math.round(SIDE_H * h)),
    x1: Math.min(w.x1, run.width_cells + Math.round(SIDE_H * h)),
    top: Math.min(w.top, Math.round((1 + ABOVE_H) * h)),
  };
}

/** The smallest of 1, 2, 5 times a power of ten at or above v. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v * (1 - 1e-9)) return m * p;
  return 10 * p;
}

/** One colour scale for all designs of a run: the highest street value, rounded up. */
export function recordedCmax(run: StreetRun): number {
  let hi = 0;
  for (const r of run.rows) for (const v of r.street_cplus?.values ?? []) hi = Math.max(hi, v);
  return niceMax(hi);
}

export function inBuilding(x: number, z: number, run: StreetRun): boolean {
  return (x < 0 || x >= run.width_cells) && z < run.height_cells;
}

export interface Arrow {
  /** Centre in cells (x from the upwind wall, z from the ground). */
  x: number;
  z: number;
  /** Mean velocity over u_H. */
  ux: number;
  uy: number;
}

/** Mean-flow arrows on a regular subset of the stored blocks, outside the buildings. */
export function arrows(run: StreetRun, row: RunRow, crop: Crop): Arrow[] {
  const f = row.flow_over_uh;
  const w = row.window;
  if (!f || !w) return [];
  const across = Math.max(1, (crop.x1 - crop.x0) / f.cells);
  const stride = Math.max(1, Math.round(across / ARROWS_ACROSS));
  const out: Arrow[] = [];
  for (let r = 0; r < f.rows; r += stride) {
    for (let c = 0; c < f.cols; c += stride) {
      const x = w.x0 + (c + 0.5) * f.cells;
      const z = (r + 0.5) * f.cells;
      if (x < crop.x0 || x > crop.x1 || z > crop.top || inBuilding(x, z, run)) continue;
      out.push({ x, z, ux: f.ux[r * f.cols + c]!, uy: f.uy[r * f.cols + c]! });
    }
  }
  return out;
}

const rgb = (c: readonly number[], a = 1) =>
  `rgb(${c.map((v) => Math.round(255 * v)).join(' ')} / ${a})`;

/**
 * Draw one design: buildings, the mean fumes in the street on the fumes ramp up to `cmax`, crowns
 * and hedges, the two breathing zones and the mean flow. The canvas is sized by the caller.
 */
export function drawRecorded(
  ctx: CanvasRenderingContext2D,
  run: StreetRun,
  row: RunRow,
  crop: Crop,
  colors: SimColors,
  cmax: number,
): void {
  const { width, height } = ctx.canvas;
  const sx = width / (crop.x1 - crop.x0);
  const sz = height / crop.top;
  const px = (x: number) => (x - crop.x0) * sx;
  const pz = (z: number) => height - z * sz;
  const bg = colors.background;
  ctx.fillStyle = rgb(bg);
  ctx.fillRect(0, 0, width, height);

  const grid = row.street_cplus;
  if (grid) {
    const stops = fumesStops(isDark(bg));
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const t = fumesT(grid.values[r * grid.cols + c]!, cmax);
        if (t <= 0) continue;
        const a = fumesAlpha(t);
        const f = fumesColor(t, stops);
        ctx.fillStyle = rgb([0, 1, 2].map((j) => bg[j]! + a * (f[j]! - bg[j]!)));
        // Overdraw by a pixel so neighbouring cells leave no seams.
        ctx.fillRect(px(c), pz(r + 1), sx + 1, sz + 1);
      }
    }
  }

  ctx.fillStyle = rgb(colors.building);
  ctx.fillRect(px(crop.x0), pz(run.height_cells), px(0) - px(crop.x0), run.height_cells * sz);
  ctx.fillRect(
    px(run.width_cells),
    pz(run.height_cells),
    px(crop.x1) - px(run.width_cells),
    run.height_cells * sz,
  );

  const h = run.height_cells;
  ctx.lineWidth = Math.max(1, width / 200);
  for (const k of row.crowns ?? []) {
    ctx.fillStyle = rgb(colors.green, 0.22);
    ctx.strokeStyle = rgb(colors.green, 0.9);
    const x = px(k.x0 * h);
    const y = pz(k.z1 * h);
    ctx.fillRect(x, y, (k.x1 - k.x0) * h * sx, (k.z1 - k.z0) * h * sz);
    ctx.strokeRect(x, y, (k.x1 - k.x0) * h * sx, (k.z1 - k.z0) * h * sz);
  }

  // Breathing zones, sized in metres (A-016).
  const perM = h / run.height_m;
  const zw = run.zone_m.width * perM;
  ctx.strokeStyle = rgb(colors.ink, 0.8);
  ctx.setLineDash([3, 2]);
  for (const x0 of [0, run.width_cells - zw]) {
    ctx.strokeRect(
      px(x0),
      pz(run.zone_m.z1 * perM),
      zw * sx,
      (run.zone_m.z1 - run.zone_m.z0) * perM * sz,
    );
  }
  ctx.setLineDash([]);

  const list = arrows(run, row, crop);
  if (list.length > 1) {
    // Arrow length: u_H spans most of the spacing between arrows.
    const spacing = Math.abs(list[1]!.x - list[0]!.x) || row.flow_over_uh!.cells;
    const scale = 0.8 * spacing;
    ctx.strokeStyle = rgb(colors.ink, 0.85);
    ctx.fillStyle = rgb(colors.ink, 0.85);
    for (const a of list) {
      const len = Math.hypot(a.ux, a.uy);
      if (len < 1e-3) continue;
      const x0 = px(a.x);
      const y0 = pz(a.z);
      const x1 = px(a.x + a.ux * scale);
      const y1 = pz(a.z + a.uy * scale);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.min(6, 0.4 * Math.hypot(x1 - x0, y1 - y0));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang - 0.5), y1 - head * Math.sin(ang - 0.5));
      ctx.lineTo(x1 - head * Math.cos(ang + 0.5), y1 - head * Math.sin(ang + 0.5));
      ctx.closePath();
      ctx.fill();
    }
  }
}
