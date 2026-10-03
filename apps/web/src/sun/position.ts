/**
 * Solar position by the NOAA method: the equations of Meeus, Astronomical Algorithms, as used in
 * NOAA's solar calculator spreadsheet (https://gml.noaa.gov/grad/solcalc/calcdetails.html).
 * NOAA states its spreadsheet is valid for 1901-2099; our check against the NREL SPA in pvlib is
 * tests/reference/sun_pvlib.json and tests/web/sun.test.ts (BRIEF.md 6.1 asks for 0.1 degrees).
 * python/treesvb/sun.py is the same code in Python.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
  /** Angle above the horizon without refraction, degrees. */
  elevation: number;
  /** Elevation with NOAA's standard-atmosphere refraction, degrees. */
  apparentElevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Declination, degrees. */
  declination: number;
  /** Equation of time, minutes. */
  equationOfTime: number;
}

/** Julian day of a UTC instant in milliseconds since 1970. */
export function julianDay(utcMs: number): number {
  return utcMs / 86_400_000 + 2_440_587.5;
}

/** Refraction correction in degrees for a geometric elevation in degrees (NOAA spreadsheet). */
export function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * RAD);
  let arcsec: number;
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevation > -0.575)
    arcsec =
      1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/** Sun position at a UTC instant for a latitude and longitude in degrees (east positive). */
export function sunPosition(utcMs: number, latitude: number, longitude: number): SunPosition {
  const jc = (julianDay(utcMs) - 2_451_545) / 36_525;
  const l0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const c =
    Math.sin(m * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot =
    4 *
    DEG *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));

  // True solar time in minutes from the UTC time of day.
  const utcMinutes = (((utcMs / 60_000) % 1440) + 1440) % 1440;
  const tst = (((utcMinutes + eot + 4 * longitude) % 1440) + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;

  const lat = latitude * RAD;
  const d = decl * RAD;
  const cosZen = Math.min(
    1,
    Math.max(-1, Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(ha * RAD)),
  );
  const zen = Math.acos(cosZen);
  const elevation = 90 - zen * DEG;

  // Azimuth from north; the sign of the hour angle picks morning or afternoon.
  const denom = Math.cos(lat) * Math.sin(zen);
  const cosAz =
    Math.abs(denom) < 1e-12
      ? 1
      : Math.min(1, Math.max(-1, (Math.sin(lat) * Math.cos(zen) - Math.sin(d)) / denom));
  const a = Math.acos(cosAz) * DEG;
  const azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;

  return {
    elevation,
    apparentElevation: elevation + refraction(elevation),
    azimuth,
    declination: decl,
    equationOfTime: eot,
  };
}
