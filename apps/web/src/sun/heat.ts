import type { GreenElement } from '../sim/greenery';
import { CROWN_LAM_H, FULL_SCALE_HEIGHT_M } from '../sim/greenery';
import type { Radiant, ShadeCrown, Sky, Street2D } from './canyon';
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

/** The weather and sun at one local hour of a preset day. */
export interface HourWeather {
  ta: number;
  rh: number;
  ghi: number;
  /** The sky as the radiation model takes it. */
  sky: Sky;
  /** Wind above the roofs, m/s. */
  roofWind: number;
}

export function hourWeather(day: WeatherDay, hour: number): HourWeather {
  const sun = sunPosition(hkTime(day.date, hour), HKO.latitude, HKO.longitude);
  const ghi = globalIrradiance(day, hour);
  const split = splitGlobal(ghi, 90 - sun.elevation, dayOfYear(day.date));
  const ta = airTemperature(day, hour);
  const rh = humidity(day, hour);
  return {
    ta,
    rh,
    ghi,
    sky: { elevation: sun.elevation, azimuth: sun.azimuth, dni: split.dni, dhi: split.dhi, ta, rh },
    roofWind: roofWind(day),
  };
}

export interface HeatState {
  A: PavementHeat | null;
  B: PavementHeat | null;
  /** Share of the street floor in direct sun. */
  floorSunlit: number;
}

/**
 * Share of direct sunlight a crown lets through, from its foliage density per metre: the
 * light-crown value at CODASC's light crown, the dense-crown value at its dense crown, linear in
 * between and held beyond (A-018, A-027). A hedge counts as dense.
 */
export function crownTransmissivity(e: GreenElement, heightM: number): number {
  if (e.kind === 'hedge') return CROWN_TRANSMISSIVITY.dense;
  const perM = e.lamH / heightM;
  const light = CROWN_LAM_H.light / FULL_SCALE_HEIGHT_M;
  const dense = CROWN_LAM_H.dense / FULL_SCALE_HEIGHT_M;
  const t = Math.min(1, Math.max(0, (perM - light) / (dense - light)));
  return CROWN_TRANSMISSIVITY.light + t * (CROWN_TRANSMISSIVITY.dense - CROWN_TRANSMISSIVITY.light);
}

/** Greenery elements (units of H) as shading crowns in metres. */
export function shadeCrowns(elements: GreenElement[], heightM: number): ShadeCrown[] {
  return elements.map((e) => ({
    x0: e.x0 * heightM,
    x1: e.x1 * heightM,
    z0: e.z0 * heightM,
    z1: e.z1 * heightM,
    transmissivity: crownTransmissivity(e, heightM),
  }));
}

/**
 * Heat on the two pavements: Tmrt from the street's radiation, wind from the solver (pedestrian
 * speed over the roof speed, null until it has averaged), UTCI from both. People stand in the
 * middle of each pavement zone, `zoneM` metres wide, `personHeight` metres up.
 */
export function pavementHeat(
  street: Street2D,
  w: HourWeather,
  zoneM: number,
  windRatio: { A: number; B: number } | null,
  personHeight: number,
): HeatState {
  const surf = surfaces(street, w.sky);
  const at = (x: number, ratio: number | undefined): PavementHeat | null => {
    if (ratio === undefined) return null;
    const r = meanRadiant(street, w.sky, x, surf);
    const raw = windAt10m(ratio * w.roofWind, personHeight);
    const wind10 = Math.min(WIND_RANGE[1], Math.max(WIND_RANGE[0], raw));
    const u = utci(w.ta, r.tmrt, wind10, w.rh);
    return { ...r, utci: u, category: utciCategory(u), wind10, windClamped: wind10 !== raw };
  };
  return {
    A: at(zoneM / 2, windRatio?.A),
    B: at(street.widthM - zoneM / 2, windRatio?.B),
    floorSunlit: surf.sunlit.ground,
  };
}
