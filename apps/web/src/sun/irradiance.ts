/**
 * Sunlight above the street: extraterrestrial irradiance and the split of global horizontal
 * irradiance into direct and diffuse parts. Ported from pvlib 0.16.1 (BSD-3-Clause):
 * get_extra_radiation (method "spencer", Spencer 1971) and erbs (Erbs, Klein and Duffie 1982,
 * Eq. 1), with pvlib's limits; checked against pvlib in tests/web/irradiance.test.ts.
 */

const RAD = Math.PI / 180;

/** Extraterrestrial normal irradiance, W/m2, for a day of the year (1-366). */
export function extraterrestrial(dayOfYear: number, solarConstant = 1366.1): number {
  const b = (2 * Math.PI * (dayOfYear - 1)) / 365;
  return (
    solarConstant *
    (1.00011 +
      0.034221 * Math.cos(b) +
      0.00128 * Math.sin(b) +
      0.000719 * Math.cos(2 * b) +
      7.7e-5 * Math.sin(2 * b))
  );
}

/** Ratio of global horizontal to extraterrestrial horizontal irradiance, 0 to 1 (pvlib). */
export function clearnessIndex(ghi: number, zenith: number, dniExtra: number): number {
  const cosZ = Math.max(Math.cos(zenith * RAD), 0.065);
  return Math.min(Math.max(ghi / (dniExtra * cosZ), 0), 1);
}

/** Erbs diffuse fraction of global horizontal irradiance for a clearness index. */
export function erbsDiffuseFraction(kt: number): number {
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8)
    return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}

export interface Split {
  /** Direct normal irradiance, W/m2. */
  dni: number;
  /** Diffuse horizontal irradiance, W/m2. */
  dhi: number;
  kt: number;
}

/** Direct and diffuse parts of global horizontal irradiance (pvlib erbs, max zenith 87). */
export function splitGlobal(ghi: number, zenith: number, dayOfYear: number): Split {
  const kt = clearnessIndex(ghi, zenith, extraterrestrial(dayOfYear));
  let dhi = erbsDiffuseFraction(kt) * ghi;
  let dni = (ghi - dhi) / Math.cos(zenith * RAD);
  if (zenith > 87 || ghi < 0 || dni < 0) {
    dni = 0;
    dhi = ghi;
  }
  return { dni, dhi, kt };
}
