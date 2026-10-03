import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sunPosition } from '../../apps/web/src/sun/position';
import { recordResult } from './record';

interface Reference {
  description: string;
  versions: Record<string, string>;
  places: { name: string }[];
  rows: [number, number, number, number, number, number][];
}

const ref = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../reference/sun_pvlib.json'), 'utf8'),
) as Reference;

/** Azimuth difference on the circle, degrees. */
const dAz = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('solar position against pvlib (NREL SPA)', () => {
  it('matches elevation and azimuth within 0.1 degrees (BRIEF 6.1)', () => {
    let worstEl = 0;
    let worstAz = 0;
    let worstApp = 0;
    for (const [ms, lat, lon, el, app, az] of ref.rows) {
      const s = sunPosition(ms, lat, lon);
      worstEl = Math.max(worstEl, Math.abs(s.elevation - el));
      // Near the zenith the azimuth is ill-defined; a 0.1 degree shift there moves it a lot.
      if (el < 89) worstAz = Math.max(worstAz, dAz(s.azimuth, az));
      // Refraction models differ most at the horizon; compare where the sun is clearly up.
      if (el > 2) worstApp = Math.max(worstApp, Math.abs(s.apparentElevation - app));
    }
    expect(ref.rows.length).toBeGreaterThan(1000);
    expect(worstEl).toBeLessThan(0.1);
    expect(worstAz).toBeLessThan(0.1);
    expect(worstApp).toBeLessThan(0.1);
    const threshold = 0.1;
    recordResult(
      'sun/position.json',
      {
        name: 'Solar position against pvlib',
        method: `NOAA solar position (Meeus) in apps/web/src/sun/position.ts against ${ref.description}; ${ref.rows.length} instants at ${ref.places.map((p) => p.name).join(', ')}, every hour on the 21st of each month of 2000, 2026 and 2050, sun above -2 degrees; azimuth compared below 89 degrees elevation and apparent elevation above 2 degrees`,
        metric: 'largest absolute difference, degrees',
        threshold: { max_abs_diff_deg_below: threshold },
        cases: ref.rows.length,
        worst_elevation_deg: Number(worstEl.toFixed(4)),
        worst_apparent_elevation_deg: Number(worstApp.toFixed(4)),
        worst_azimuth_deg: Number(worstAz.toFixed(4)),
        passed: Math.max(worstEl, worstApp, worstAz) < threshold,
      },
      'npx vitest run tests/web/sun.test.ts (RECORD_RESULTS=1)',
      { pvlib: ref.versions.pvlib! },
    );
  });
});
