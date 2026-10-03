import type { Provenance } from '../content/results';
import { result } from '../content/results';
import { extraterrestrial } from './irradiance';
import { sunPosition } from './position';
import { saturationVapourPressure } from './utci';

/** A day of Hong Kong Observatory daily values at King's Park (results/weather/presets.json). */
export interface WeatherDay {
  key: 'very_hot' | 'typical_july';
  date: string;
  tmax_c: number;
  tmin_c: number;
  tmean_c: number;
  rh_pct: number;
  gsr_mj_m2: number;
  wind_kmh: number;
}

interface PresetsResult extends Provenance {
  station: string;
  presets: WeatherDay[];
}

export function weatherPresets(): WeatherDay[] {
  return result<PresetsResult>('weather/presets.json')?.presets ?? [];
}

/** Sun positions are taken at the Hong Kong Observatory; across the territory they differ little. */
export const HKO = { latitude: 22.302, longitude: 114.174 } as const;
/** Hong Kong Time is UTC + 8 all year. */
const HKT_OFFSET_H = 8;
/** Hour of the day's highest temperature, local time (assumption A-022). */
export const PEAK_HOUR = 14;

/** UTC milliseconds of a local Hong Kong time on a date (YYYY-MM-DD) and hour (0-24). */
export function hkTime(date: string, hour: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 0, 0, 0) + (hour - HKT_OFFSET_H) * 3_600_000;
}

export function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

const sunrises = new Map<string, number>();

/** Local hour of sunrise, to the minute, from the solar position. */
export function sunrise(date: string): number {
  const known = sunrises.get(date);
  if (known !== undefined) return known;
  let found = 6;
  for (let m = 3 * 60; m < 12 * 60; m++) {
    if (sunPosition(hkTime(date, m / 60), HKO.latitude, HKO.longitude).elevation > 0) {
      found = m / 60;
      break;
    }
  }
  sunrises.set(date, found);
  return found;
}

/**
 * Air temperature through the day from the daily minimum and maximum: a half cosine rising from
 * the minimum at sunrise to the maximum at PEAK_HOUR, and one falling to the next sunrise's
 * minimum (assumption A-022; the daily mean is not matched exactly).
 */
export function airTemperature(day: WeatherDay, hour: number): number {
  const rise = sunrise(day.date);
  const amp = day.tmax_c - day.tmin_c;
  if (hour >= rise && hour <= PEAK_HOUR) {
    const f = (hour - rise) / (PEAK_HOUR - rise);
    return day.tmin_c + amp * 0.5 * (1 - Math.cos(Math.PI * f));
  }
  const span = 24 - (PEAK_HOUR - rise);
  const since = hour > PEAK_HOUR ? hour - PEAK_HOUR : hour + 24 - PEAK_HOUR;
  return day.tmax_c - amp * 0.5 * (1 - Math.cos((Math.PI * since) / span));
}

/** Relative humidity, %, keeping the daily mean vapour pressure all day (assumption A-022). */
export function humidity(day: WeatherDay, hour: number): number {
  const e = (day.rh_pct / 100) * saturationVapourPressure(day.tmean_c);
  return Math.min(100, (100 * e) / saturationVapourPressure(airTemperature(day, hour)));
}

/**
 * Global horizontal irradiance, W/m2: the day's measured total shared out in proportion to the
 * extraterrestrial irradiance on a horizontal surface, so the day's clearness is the same at
 * every hour (assumption A-022).
 */
export function globalIrradiance(day: WeatherDay, hour: number): number {
  const shape = (h: number) => {
    const el = sunPosition(hkTime(day.date, h), HKO.latitude, HKO.longitude).elevation;
    return Math.max(0, Math.sin((el * Math.PI) / 180));
  };
  let sum = daySums.get(day.date);
  if (sum === undefined) {
    sum = 0;
    const step = 1 / 60;
    for (let h = 0; h < 24; h += step) sum += shape(h + step / 2) * step * 3600;
    daySums.set(day.date, sum);
  }
  const e0 = extraterrestrial(dayOfYear(day.date));
  if (sum <= 0) return 0;
  return ((day.gsr_mj_m2 * 1e6) / (e0 * sum)) * e0 * shape(hour);
}

/** Integral of sin(elevation) over each day, seconds; the same for every call on a date. */
const daySums = new Map<string, number>();

/** Daily mean wind at King's Park, m/s, taken as the wind above the roofs (assumption A-023). */
export function roofWind(day: WeatherDay): number {
  return day.wind_kmh / 3.6;
}
