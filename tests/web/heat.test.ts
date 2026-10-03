import { describe, expect, it } from 'vitest';
import type { Sky, Street2D } from '../../apps/web/src/sun/canyon';
import {
  beamShare,
  meanRadiant,
  surfaces,
  viewsAlong,
  viewsDown,
  viewsSide,
  viewsUp,
} from '../../apps/web/src/sun/canyon';
import {
  CROWN_TRANSMISSIVITY,
  hourWeather,
  pavementHeat,
  windAt10m,
} from '../../apps/web/src/sun/heat';
import type { WeatherDay } from '../../apps/web/src/sun/weather';
import {
  airTemperature,
  globalIrradiance,
  humidity,
  PEAK_HOUR,
  sunrise,
} from '../../apps/web/src/sun/weather';

// Test data only: a summer day shaped like the King's Park presets.
const DAY: WeatherDay = {
  key: 'typical_july',
  date: '2001-07-14',
  tmax_c: 31.4,
  tmin_c: 26.6,
  tmean_c: 28.9,
  rh_pct: 81,
  gsr_mj_m2: 16.47,
  wind_kmh: 8.8,
};
const street = (h: number, w: number, axisDeg = 0): Street2D => ({
  heightM: h,
  widthM: w,
  axisDeg,
  crowns: [],
});
const noon = (azimuth: number, elevation = 60): Sky => ({
  elevation,
  azimuth,
  dni: 700,
  dhi: 150,
  ta: 31,
  rh: 70,
});
const total = (v: { sky: number; left: number; right: number; ground: number }) =>
  v.sky + v.left + v.right + v.ground;

describe('view factors in the street section', () => {
  it('add up to one for every face', () => {
    const s = street(36, 18);
    for (const [x, z] of [
      [1.35, 1.1],
      [9, 1.1],
      [16, 5],
    ] as const) {
      for (const v of [
        viewsUp(s, x, z),
        viewsDown(s, x, z),
        viewsSide(s, x, z, 'left'),
        viewsSide(s, x, z, 'right'),
        viewsAlong(s, x, z),
      ]) {
        expect(total(v)).toBeCloseTo(1, 10);
      }
    }
  });

  it('see almost only sky from open ground and less from a deep street', () => {
    expect(viewsUp(street(0.01, 1000), 500, 0).sky).toBeGreaterThan(0.999);
    expect(viewsUp(street(36, 9), 4.5, 0).sky).toBeLessThan(viewsUp(street(9, 36), 18, 0).sky);
  });
});

describe('shade', () => {
  it('falls on the floor next to the wall on the sun side', () => {
    // N-S street, +x to the east; a sun in the east lights the west half of the floor first.
    const s = street(18, 18);
    const sky = noon(90, 50);
    expect(beamShare(s, sky, 1, 0)).toBe(1);
    expect(beamShare(s, sky, 17, 0)).toBe(0);
  });

  it('lets a crown pass its transmissivity', () => {
    const s: Street2D = {
      ...street(18, 18),
      crowns: [{ x0: 6, x1: 12, z0: 3, z1: 10, transmissivity: 0.07 }],
    };
    expect(beamShare(s, noon(0, 89.9), 9, 1.1)).toBeCloseTo(0.07, 10);
    expect(beamShare(s, noon(0, 89.9), 2, 1.1)).toBe(1);
  });

  it('pairs crown densities with measured tree transmissivities', () => {
    expect(CROWN_TRANSMISSIVITY.dense).toBeCloseTo(0.0695, 4);
    expect(CROWN_TRANSMISSIVITY.light).toBeCloseTo(0.1435, 4);
  });
});

describe('mean radiant temperature', () => {
  it('is far above the air in open sun and near it in a shaded street', () => {
    const sky = noon(180, 70);
    const open = meanRadiant(street(0.01, 1000), sky, 500);
    expect(open.sun).toBe(1);
    expect(open.tmrt).toBeGreaterThan(sky.ta + 15);
    // E-W street (axis 90): a sun due south (+x points south) at 30 degrees, deep street.
    const deep = street(60, 10, 90);
    const low = noon(180, 30);
    const shaded = meanRadiant(deep, low, 9);
    expect(shaded.sun).toBe(0);
    expect(shaded.tmrt).toBeLessThan(open.tmrt - 15);
  });

  it('falls below the air at night under an open sky', () => {
    const night: Sky = { elevation: -20, azimuth: 0, dni: 0, dhi: 0, ta: 28, rh: 80 };
    const s = street(0.01, 1000);
    expect(meanRadiant(s, night, 500).tmrt).toBeLessThan(28);
    expect(surfaces(s, night).sunlit.ground).toBe(0);
  });
});

describe('a day rebuilt from daily values', () => {
  it('reaches the minimum at sunrise and the maximum at the peak hour', () => {
    expect(airTemperature(DAY, sunrise(DAY.date))).toBeCloseTo(DAY.tmin_c, 6);
    expect(airTemperature(DAY, PEAK_HOUR)).toBeCloseTo(DAY.tmax_c, 6);
    expect(humidity(DAY, PEAK_HOUR)).toBeLessThan(humidity(DAY, 5));
  });

  it('shares out the measured daily solar total', () => {
    let joules = 0;
    for (let m = 0; m < 24 * 60; m++) joules += globalIrradiance(DAY, (m + 0.5) / 60) * 60;
    expect(joules / 1e6).toBeCloseTo(DAY.gsr_mj_m2, 1);
    expect(globalIrradiance(DAY, 1)).toBe(0);
  });
});

describe('pavement heat', () => {
  it('converts pedestrian wind to 10 m with UTCI log law', () => {
    expect(windAt10m(1, 1.1)).toBeCloseTo(Math.log(1000) / Math.log(110), 10);
  });

  it('waits for the solver wind, then gives UTCI on both pavements', () => {
    const s = street(36, 30, 0);
    const w = hourWeather(DAY, 13);
    expect(pavementHeat(s, w, 2.7, null, 1.1).A).toBeNull();
    const h = pavementHeat(s, w, 2.7, { A: 0.2, B: 0.3 }, 1.1);
    expect(h.A!.utci).toBeGreaterThan(w.ta - 5);
    expect(h.B!.wind10).toBeGreaterThanOrEqual(0.5);
  });
});
