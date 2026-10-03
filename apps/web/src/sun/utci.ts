import { utciPolynomial } from './utciPolynomial';

/**
 * Universal Thermal Climate Index, the operational polynomial of Broede et al. (2012) as
 * implemented in pythermalcomfort (MIT; notice in utciPolynomial.ts). Checked against
 * pythermalcomfort over a grid of inputs in tests/web/utci.test.ts.
 */

/** Inputs inside which the polynomial was fitted (pythermalcomfort's limits). */
export const UTCI_LIMITS = {
  ta: [-50, 50],
  dtr: [-30, 70],
  va: [0.5, 17],
} as const;

/** Saturation water vapour pressure over water in hPa (the formula pythermalcomfort uses). */
export function saturationVapourPressure(ta: number): number {
  const g = [
    -2836.5744,
    -6028.076559,
    19.54263612,
    -0.02737830188,
    0.000016261698,
    7.0229056 * 10 ** -10,
    -1.8680009 * 10 ** -13,
  ];
  const tk = ta + 273.15;
  let es = 2.7150305 * Math.log(tk);
  for (let i = 0; i < g.length; i++) es += g[i]! * tk ** (i - 2);
  return Math.exp(es) * 0.01;
}

/** True when the inputs lie where the polynomial is valid. */
export function utciInRange(ta: number, tmrt: number, va10: number): boolean {
  const dtr = tmrt - ta;
  return (
    ta >= UTCI_LIMITS.ta[0] &&
    ta <= UTCI_LIMITS.ta[1] &&
    dtr >= UTCI_LIMITS.dtr[0] &&
    dtr <= UTCI_LIMITS.dtr[1] &&
    va10 >= UTCI_LIMITS.va[0] &&
    va10 <= UTCI_LIMITS.va[1]
  );
}

/**
 * UTCI in degrees C from air temperature (C), mean radiant temperature (C), wind speed at 10 m
 * (m/s) and relative humidity (%). Outside UTCI_LIMITS the polynomial extrapolates; callers
 * clamp the wind to its range and say so (docs/assumptions.md).
 */
export function utci(ta: number, tmrt: number, va10: number, rh: number): number {
  const pa = (saturationVapourPressure(ta) * (rh / 100)) / 10;
  return utciPolynomial(ta, va10, tmrt - ta, pa);
}

/** UTCI assessment scale (Broede et al. 2012), upper bounds in degrees C, as pythermalcomfort. */
export const UTCI_CATEGORIES = [
  [-40, 'extremeCold'],
  [-27, 'veryStrongCold'],
  [-13, 'strongCold'],
  [0, 'moderateCold'],
  [9, 'slightCold'],
  [26, 'noStress'],
  [32, 'moderateHeat'],
  [38, 'strongHeat'],
  [46, 'veryStrongHeat'],
  [Infinity, 'extremeHeat'],
] as const;

export type UtciCategory = (typeof UTCI_CATEGORIES)[number][1];

/** The category whose interval holds u, right edge included. */
export function utciCategory(u: number): UtciCategory {
  for (const [upper, name] of UTCI_CATEGORIES) if (u <= upper) return name;
  return 'extremeHeat';
}
