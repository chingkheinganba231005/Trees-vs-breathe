import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GoldenCase } from '../../apps/web/src/sim/golden';
import {
  avenueTrees,
  centralHedge,
  dragField,
  LANE_OFFSETS,
  laneOffsets,
  lineSources,
  pavementExposure,
  SOURCE_TOTAL,
} from '../../apps/web/src/sim/greenery';
import { isHealthy, lowerTimeStep, MIN_TAU_MARGIN } from '../../apps/web/src/sim/guard';
import { Particles, sampleVelocity } from '../../apps/web/src/sim/particles';
import {
  canyonDomain,
  canyonGeometry,
  canyonNx,
  streetColumns,
} from '../../apps/web/src/sim/street';
import { parseColor, streetView } from '../../apps/web/src/sim/view';
import { contourSegments } from '../../apps/web/src/components/charts/contour';

describe('blow-up guard', () => {
  it('flags NaN and runaway speeds', () => {
    expect(isHealthy(0.1)).toBe(true);
    expect(isHealthy(Number.NaN)).toBe(false);
    expect(isHealthy(0.5)).toBe(false);
  });

  it('lowers the time step at constant Reynolds number', () => {
    const r = lowerTimeStep({ uRef: 0.05, reynolds: 5000, smagorinsky: 0.17 }, 48);
    expect(r.flow.uRef).toBeCloseTo(0.04, 12);
    expect(r.flow.reynolds).toBe(5000);
    expect(r.reynoldsLowered).toBe(false);
  });

  it('lowers the Reynolds number instead when tau0 would get too close to 1/2', () => {
    const r = lowerTimeStep({ uRef: 0.05, reynolds: 1e9, smagorinsky: 0.17 }, 48);
    expect(r.reynoldsLowered).toBe(true);
    const nu = (r.flow.uRef * 48) / r.flow.reynolds;
    expect(3 * nu).toBeCloseTo(MIN_TAU_MARGIN, 12);
  });
});

describe('particles', () => {
  it('interpolates a linear field exactly', () => {
    const nx = 4;
    const ny = 3;
    const ux = new Float32Array(nx * ny);
    const uy = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) ux[y * nx + x] = 0.01 * x;
    const [u] = sampleVelocity(ux, uy, nx, ny, 2.25, 1.5);
    expect(u).toBeCloseTo(0.01 * 1.75, 6);
  });

  it('stay out of buildings and inside the view', () => {
    const view = { x0: 10, width: 20, height: 10 };
    const solid = (x: number, y: number) => x > 15 && x < 20 && y < 5;
    const p = new Particles(500, view, solid, 7);
    const nx = 40;
    const ny = 12;
    const ux = new Float32Array(nx * ny).fill(0.05);
    const uy = new Float32Array(nx * ny);
    for (let f = 0; f < 50; f++) p.advect(ux, uy, nx, ny, 10);
    for (let k = 0; k < p.count; k++) {
      expect(solid(p.x[k]!, p.y[k]!)).toBe(false);
      expect(p.x[k]!).toBeGreaterThanOrEqual(view.x0);
      expect(p.x[k]!).toBeLessThan(view.x0 + view.width);
    }
  });
});

describe('street view', () => {
  it('frames both buildings and the street', () => {
    const g = canyonGeometry(48, 1);
    const v = streetView(g);
    const [x0, x1] = streetColumns(g);
    expect(v.x0).toBeLessThan(x0 - g.building);
    expect(v.x0 + v.width).toBeGreaterThan(x1 + g.building);
    expect(v.x0 + v.width).toBeLessThanOrEqual(canyonNx(g));
    expect(v.height).toBe(96);
  });
});

describe('colour parsing for the canvas', () => {
  it('accepts the forms browsers and the minifier produce', () => {
    expect(parseColor('#ffffff')).toEqual([1, 1, 1]);
    expect(parseColor(' #fff')).toEqual([1, 1, 1]);
    expect(parseColor('#1d6b3b')).toEqual([29 / 255, 107 / 255, 59 / 255]);
    expect(parseColor('rgb(14, 14, 14)')).toEqual([14 / 255, 14 / 255, 14 / 255]);
    expect(() => parseColor('papayawhip')).toThrow();
  });
});

describe('contours for the streamline plots', () => {
  it('finds a closed ring around a peak', () => {
    const n = 21;
    const values = new Float64Array(n * n);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        values[r * n + c] = Math.exp(-((r - 10) ** 2 + (c - 10) ** 2) / 20);
    const segs = contourSegments(values, n, n, 0.5);
    expect(segs.length).toBeGreaterThan(8);
    // Every crossing lies near the radius where the field equals 0.5.
    const radius = Math.sqrt(20 * Math.log(2));
    for (const [x0, y0] of segs) {
      expect(Math.hypot(x0 - 10, y0 - 10)).toBeCloseTo(radius, 0);
    }
  });

  it('finds nothing in a flat field', () => {
    expect(contourSegments(new Float64Array(9).fill(1), 3, 3, 0.5)).toEqual([]);
  });
});

describe('greenery and traffic', () => {
  const golden = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../golden/street_trees.json'), 'utf8'),
  ) as GoldenCase;
  const g = canyonGeometry(6, 1);
  const solid = canyonDomain(g).solid;

  it('builds the same crown drag as Python', () => {
    const drag = dragField(g, solid, avenueTrees(1, 'dense'));
    const ref = golden.params.drag!;
    expect(drag.length).toBe(ref.length);
    for (let k = 0; k < ref.length; k++) expect(drag[k]).toBeCloseTo(ref[k]!, 6);
  });

  it('builds the same line sources as Python', () => {
    const src = lineSources(g, LANE_OFFSETS, SOURCE_TOTAL);
    const ref = golden.params.tracer!.source;
    for (let k = 0; k < ref.length; k++) expect(src[k]).toBeCloseTo(ref[k]!, 9);
  });

  it('keeps the lanes inside narrow streets', () => {
    for (const w of [0.33, 0.5, 1, 2]) {
      for (const o of laneOffsets(w)) expect(Math.abs(o)).toBeLessThan(0.5 * w);
    }
    expect(laneOffsets(2)).toEqual([...LANE_OFFSETS]);
  });

  it('puts one row of trees in narrow streets and two in wide ones', () => {
    expect(avenueTrees(1, 'light')).toHaveLength(1);
    expect(avenueTrees(2, 'light')).toHaveLength(2);
    const h = centralHedge(2);
    expect(h.x0 + h.x1).toBeCloseTo(2, 12);
    expect(h.z1).toBeCloseTo(2.5 / 18, 12);
  });

  it('measures a uniform concentration as its c+ on both pavements', () => {
    const n = canyonNx(g) * g.top;
    const c = new Float32Array(n).fill(2e-3);
    const e = pavementExposure(g, c, 1, 0, 0.05);
    const expected = (2e-3 * 0.05 * 6) / SOURCE_TOTAL;
    expect(e.A).toBeCloseTo(expected, 4);
    expect(e.B).toBeCloseTo(expected, 4);
  });
});
