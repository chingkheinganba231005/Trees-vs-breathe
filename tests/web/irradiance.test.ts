import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extraterrestrial, splitGlobal } from '../../apps/web/src/sun/irradiance';

const ref = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../reference/irradiance_pvlib.json'), 'utf8'),
) as { rows: [number, number, number, number, number, number, number][] };

describe('irradiance against pvlib', () => {
  it('matches extraterrestrial irradiance and the Erbs split', () => {
    let worst = 0;
    for (const [doy, zen, ghi, extra, kt, dni, dhi] of ref.rows) {
      expect(Math.abs(extraterrestrial(doy) - extra)).toBeLessThan(1e-4);
      const s = splitGlobal(ghi, zen, doy);
      expect(Math.abs(s.kt - kt)).toBeLessThan(1e-6);
      worst = Math.max(worst, Math.abs(s.dni - dni), Math.abs(s.dhi - dhi));
    }
    expect(ref.rows.length).toBeGreaterThan(2000);
    expect(worst).toBeLessThan(1e-3);
  });
});
