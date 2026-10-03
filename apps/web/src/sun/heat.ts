import type { GreenElement } from '../sim/greenery';
import type { Radiant, ShadeCrown, Street2D } from './canyon';
import { meanRadiant, surfaces } from './canyon';
import { splitGlobal } from './irradiance';
import { sunPosition } from './position';
import type { UtciCategory } from './utci';
import { utci, utciCategory } from './utci';
import type { WeatherDay } from './weather';
import {
  airTemperature,
  dayOfYear,
  globalIrradiance,
  HKO,
  hkTime,
  humidity,
  roofWind,
} from './weather';

/**
 * Measured summer transmissivity of urban tree crowns, means of clear-sky days (Takacs et al. 2016,
 * Table 3): Tilia cordata, dense foliage, and Sophora japonica, sparse (assumption A-018).
 */
const TILIA_CORDATA = [0.063, 0.083, 0.044, 0.088];
const SOPHORA_JAPONICA = [0.154, 0.099, 0.149, 0.172];
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
export const CROWN_TRANSMISSIVITY = {
  dense: mean(TILIA_CORDATA),
  light: mean(SOPHORA_JAPONICA),
} as const;

/** UTCI's wind height and the log law it uses to move wind between heights (Lee et al. 2025). */
const UTCI_Z0 = 0.01;
const UTCI_WIND_HEIGHT = 10;
/** Pedestrian wind at height z, m/s, as the 10 m wind UTCI expects (assumption A-023). */
export function windAt10m(v: number, z: number): number {
  return (v * Math.log(UTCI_WIND_HEIGHT / UTCI_Z0)) / Math.log(z / UTCI_Z0);
}
/** UTCI's polynomial holds for 10 m wind from 0.5 to 17 m/s. */
export const WIND_RANGE: readonly [number, number] = [0.5, 17];

export interface PavementHeat extends Radiant {
  utci: number;
  category: UtciCategory;
  /** Wind at 10 m fed to UTCI, m/s, after clamping to WIND_RANGE. */
  wind10: number;
  windClamped: boolean;
}

export interface HeatState {
  ta: number;
  rh: number;
  ghi: number;
  elevation: number;
  azimuth: number;
  A: PavementHeat | null;
  B: PavementHeat | null;
  /** Share of the street floor in direct sun. */
  floorSunlit: number;
}

/** Greenery elements (units of H) as shading crowns in metres. */
export function shadeCrowns(
  elements: GreenElement[],
  heightM: number,
  density: 'light' | 'dense',
): ShadeCrown[] {
  return elements.map((e) => ({
    x0: e.x0 * heightM,
    x1: e.x1 * heightM,
    z0: e.z0 * heightM,
    z1: e.z1 * heightM,
    transmissivity: e.kind === 'hedge' ? CROWN_TRANSMISSIVITY.dense : CROWN_TRANSMISSIVITY[density],
  }));
}

/**
 * Heat on the two pavements at a local hour: Tmrt from the street's radiation, wind from the
 * solver (pedestrian speed over the roof speed, null until it has averaged), UTCI from both.
 * People stand in the middle of each pavement zone, `zoneM` metres wide.
 */
export function pavementHeat(
  street: Street2D,
  day: WeatherDay,
  hour: number,
  zoneM: number,
  windRatio: { A: number; B: number } | null,
  personHeight: number,
): HeatState {
  const utc = hkTime(day.date, hour);
  const sun = sunPosition(utc, HKO.latitude, HKO.longitude);
  const ghi = globalIrradiance(day, hour);
  const split = splitGlobal(ghi, 90 - sun.elevation, dayOfYear(day.date));
  const ta = airTemperature(day, hour);
  const rh = humidity(day, hour);
  const sky = {
    elevation: sun.elevation,
    azimuth: sun.azimuth,
    dni: split.dni,
    dhi: split.dhi,
    ta,
    rh,
  };
  const surf = surfaces(street, sky);
  const at = (x: number, ratio: number | undefined): PavementHeat | null => {
    if (ratio === undefined) return null;
    const r = meanRadiant(street, sky, x, surf);
    const raw = windAt10m(ratio * roofWind(day), personHeight);
    const wind10 = Math.min(WIND_RANGE[1], Math.max(WIND_RANGE[0], raw));
    const u = utci(ta, r.tmrt, wind10, rh);
    return { ...r, utci: u, category: utciCategory(u), wind10, windClamped: wind10 !== raw };
  };
  return {
    ta,
    rh,
    ghi,
    elevation: sun.elevation,
    azimuth: sun.azimuth,
    A: at(zoneM / 2, windRatio?.A),
    B: at(street.widthM - zoneM / 2, windRatio?.B),
    floorSunlit: surf.sunlit.ground,
  };
}
