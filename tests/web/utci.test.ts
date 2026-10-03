import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { utci, utciCategory, utciInRange } from '../../apps/web/src/sun/utci';
import { recordResult } from './record';

interface Reference {
  description: string;
  versions: Record<string, string>;
  rows: [number, number, number, number, number, string][];
}

const ref = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../reference/utci_pythermalcomfort.json'), 'utf8'),
) as Reference;

// pythermalcomfort's category names, keyed by ours.
const NAMES: Record<string, string> = {
  extremeCold: 'extreme cold stress',
  veryStrongCold: 'very strong cold stress',
  strongCold: 'strong cold stress',
  moderateCold: 'moderate cold stress',
  slightCold: 'slight cold stress',
  noStress: 'no thermal stress',
  moderateHeat: 'moderate heat stress',
  strongHeat: 'strong heat stress',
  veryStrongHeat: 'very strong heat stress',
  extremeHeat: 'extreme heat stress',
};

describe('UTCI against pythermalcomfort', () => {
  it('reproduces the polynomial within 0.1 C over its whole range (BRIEF 6.4)', () => {
    let worst = 0;
    let categories = 0;
    for (const [ta, tmrt, va, rh, u, category] of ref.rows) {
      const ours = utci(ta, tmrt, va, rh);
      worst = Math.max(worst, Math.abs(ours - u));
      if (NAMES[utciCategory(ours)] === category) categories++;
    }
    expect(ref.rows.length).toBeGreaterThan(3000);
    expect(worst).toBeLessThan(0.1);
    expect(categories).toBe(ref.rows.length);
    const threshold = 0.1;
    recordResult(
      'sun/utci.json',
      {
        name: 'UTCI against pythermalcomfort',
        method: `Operational polynomial of Broede et al. (2012) in apps/web/src/sun/utci.ts against ${ref.description}, ${ref.rows.length} inputs: air temperature -50 to 50 C, mean radiant temperature 30 K below to 70 K above it, wind at 10 m 0.5 to 17 m/s, humidity 5 to 100%`,
        metric: 'largest absolute difference in UTCI, C; stress categories that match',
        threshold: { max_abs_diff_c_below: threshold },
        cases: ref.rows.length,
        worst_abs_diff_c: worst,
        categories_matching: categories,
        passed: worst < threshold && categories === ref.rows.length,
      },
      'npx vitest run tests/web/utci.test.ts (RECORD_RESULTS=1)',
      { pythermalcomfort: ref.versions.pythermalcomfort! },
    );
  });

  it('puts category edges on the colder side, as pythermalcomfort does', () => {
    expect(utciCategory(26)).toBe('noStress');
    expect(utciCategory(26.01)).toBe('moderateHeat');
    expect(utciCategory(46)).toBe('veryStrongHeat');
    expect(utciCategory(46.5)).toBe('extremeHeat');
    expect(utciCategory(-40)).toBe('extremeCold');
  });

  it('knows where the polynomial is valid', () => {
    expect(utciInRange(30, 60, 1)).toBe(true);
    expect(utciInRange(30, 60, 0.2)).toBe(false);
    expect(utciInRange(30, 110, 1)).toBe(false);
  });
});
