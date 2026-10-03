/**
 * Mean radiant temperature of a pedestrian in a street cross-section: a simplified SOLWEIG
 * (Lindberg, Holmer and Thorsson 2008) in two dimensions. The street is infinitely long; x runs
 * from the left wall (0) to the right wall (W), z up from the ground, both in metres.
 *
 * Shortwave and longwave radiation reach six faces of a standing person (up, down, the two walls
 * and the two directions along the street) and are weighted with the six-directional method:
 * Sstr = ak sum W_i K_i + ep sum W_i L_i, Tmrt = (Sstr / (ep sigma))^(1/4) - 273.15, with
 * W_i = 0.22 sideways and 0.06 up and down, ak = 0.70, ep = 0.97 (Thorsson et al. 2007, as
 * restated by Ouyang et al. 2022). Surface albedo and emissivity are SOLWEIG's defaults (UMEP
 * manual). Simplifications are listed in docs/assumptions.md (A-017 to A-021).
 */

const RAD = Math.PI / 180;
export const SIGMA = 5.67e-8;

/** Six-directional method (Thorsson et al. 2007 via Ouyang et al. 2022). */
export const PERSON = { absorbShort: 0.7, emissivity: 0.97, side: 0.22, vertical: 0.06 } as const;
/** Reference height of a standing person for UTCI, metres (Lee, Park and Mayer 2025). */
export const PERSON_HEIGHT_M = 1.1;
/** SOLWEIG defaults (UMEP manual): bulk albedo and emissivity of walls and ground. */
export const WALL = { albedo: 0.2, emissivity: 0.9 } as const;
export const GROUND = { albedo: 0.15, emissivity: 0.95 } as const;
/** External surface heat-transfer coefficient, W/m2K: 1 / Rse with Rse = 0.04 m2K/W (ISO 6946). */
export const SURFACE_H = 25;

export interface ShadeCrown {
  /** Metres from the left wall and above the ground. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Share of direct sunlight a crown lets through. */
  transmissivity: number;
}

export interface Street2D {
  heightM: number;
  widthM: number;
  /** Street axis, degrees clockwise from north. The section's +x points to axis + 90. */
  axisDeg: number;
  crowns: ShadeCrown[];
}

export interface Sky {
  /** Geometric sun elevation and azimuth, degrees. */
  elevation: number;
  azimuth: number;
  /** Direct normal and diffuse horizontal irradiance, W/m2. */
  dni: number;
  dhi: number;
  /** Air temperature, C, and relative humidity, %. */
  ta: number;
  rh: number;
}

/** Saturation vapour pressure over water, hPa (the formula utci.ts uses). */
function vapourPressureHpa(ta: number, rh: number): number {
  const g = [
    -2836.5744, -6028.076559, 19.54263612, -0.02737830188, 0.000016261698, 7.0229056e-10,
    -1.8680009e-13,
  ];
  const tk = ta + 273.15;
  let es = 2.7150305 * Math.log(tk);
  for (let i = 0; i < g.length; i++) es += g[i]! * tk ** (i - 2);
  return Math.exp(es) * 0.01 * (rh / 100);
}

/** Clear-sky emissivity of Prata (1996): 1 - (1 + w) exp(-sqrt(1.2 + 3 w)), w = 46.5 e / T cm. */
export function skyEmissivity(ta: number, rh: number): number {
  const w = (46.5 * vapourPressureHpa(ta, rh)) / (ta + 273.15);
  return 1 - (1 + w) * Math.exp(-Math.sqrt(1.2 + 3 * w));
}

/** Direction of the sun in the section: dx (towards +x), dz (up), and along the axis. */
export function sunInSection(s: Street2D, sky: Sky) {
  const h = sky.elevation * RAD;
  const toRight = Math.cos((sky.azimuth - (s.axisDeg + 90)) * RAD);
  const along = Math.cos((sky.azimuth - s.axisDeg) * RAD);
  return { dx: Math.cos(h) * toRight, dz: Math.sin(h), along: Math.cos(h) * along };
}

/**
 * Share of the direct beam reaching (x, z): 0 behind a roof, the product of the transmissivities
 * of the crowns the ray crosses, 1 in open sun.
 */
export function beamShare(s: Street2D, sky: Sky, x: number, z: number): number {
  if (sky.elevation <= 0) return 0;
  const { dx, dz } = sunInSection(s, sky);
  // The roof edge on the sun's side: sunlit when the ray clears it.
  if (Math.abs(dx) > 1e-9) {
    const edge = dx > 0 ? s.widthM : 0;
    const dist = Math.abs(edge - x);
    if (z + (dist * dz) / Math.abs(dx) < s.heightM) return 0;
  }
  let share = 1;
  for (const c of s.crowns) {
    if (crosses(c, x, z, dx, dz, s.heightM)) share *= c.transmissivity;
  }
  return share;
}

/** Whether the ray from (x, z) towards the sun passes through the crown below roof height. */
function crosses(
  c: ShadeCrown,
  x: number,
  z: number,
  dx: number,
  dz: number,
  top: number,
): boolean {
  // Parametrise by height: t from z to the top of the crown or the roofs.
  const zTop = Math.min(c.z1, top);
  if (zTop <= z) return false;
  const lo = Math.max(c.z0, z);
  if (lo >= zTop) return false;
  const slope = Math.abs(dz) < 1e-12 ? Infinity : dx / dz;
  const xa = x + (lo - z) * slope;
  const xb = x + (zTop - z) * slope;
  const [a, b] = xa < xb ? [xa, xb] : [xb, xa];
  return b >= c.x0 && a <= c.x1;
}

/** View factors in the section from a point to sky, left wall, right wall and ground. */
export interface Views {
  sky: number;
  left: number;
  right: number;
  ground: number;
}

/** Up-facing element at (x, z): the cosine-weighted share of the half-plane above it. */
export function viewsUp(s: Street2D, x: number, z: number): Views {
  const above = Math.max(1e-9, s.heightM - z);
  const sl = Math.sin(Math.atan2(x, above));
  const sr = Math.sin(Math.atan2(s.widthM - x, above));
  return { sky: 0.5 * (sl + sr), left: 0.5 * (1 - sl), right: 0.5 * (1 - sr), ground: 0 };
}

/** Down-facing element at (x, z). */
export function viewsDown(s: Street2D, x: number, z: number): Views {
  const below = Math.max(1e-9, z);
  const sl = Math.sin(Math.atan2(x, below));
  const sr = Math.sin(Math.atan2(s.widthM - x, below));
  return { sky: 0, left: 0.5 * (1 - sl), right: 0.5 * (1 - sr), ground: 0.5 * (sl + sr) };
}

/** Vertical element at (x, z) facing the right wall (+x) or the left wall. */
export function viewsSide(s: Street2D, x: number, z: number, facing: 'left' | 'right'): Views {
  const d = Math.max(1e-9, facing === 'right' ? s.widthM - x : x);
  const up = Math.sin(Math.atan2(s.heightM - z, d));
  const down = Math.sin(Math.atan2(z, d));
  const wall = 0.5 * (up + down);
  return {
    sky: 0.5 * (1 - up),
    ground: 0.5 * (1 - down),
    left: facing === 'left' ? wall : 0,
    right: facing === 'right' ? wall : 0,
  };
}

/**
 * Vertical element facing along the street. Around its normal the radiation is spread evenly
 * over the angle in the section plane, so each surface's share is the angle it subtends.
 */
export function viewsAlong(s: Street2D, x: number, z: number): Views {
  const ang = (px: number, pz: number) => Math.atan2(pz - z, px - x);
  const span = (a: number, b: number) => {
    let d = b - a;
    while (d < 0) d += 2 * Math.PI;
    return d;
  };
  const tl = ang(0, s.heightM);
  const tr = ang(s.widthM, s.heightM);
  const bl = ang(0, 0);
  const br = ang(s.widthM, 0);
  const full = 2 * Math.PI;
  return {
    sky: span(tr, tl) / full,
    left: span(tl, bl) / full,
    ground: span(bl, br) / full,
    right: span(br, tr) / full,
  };
}

/** Mean irradiance and emitted longwave of the three street surfaces. */
export interface Surfaces {
  /** Shortwave irradiance averaged over each surface, W/m2. */
  irradiance: { left: number; right: number; ground: number };
  /** Share of each surface in direct sun (crown transmission included). */
  sunlit: { left: number; right: number; ground: number };
  /** Longwave emitted, W/m2. */
  emitted: { left: number; right: number; ground: number };
}

const SAMPLES = 48;

/**
 * Shortwave on the walls and the ground, and their temperatures from a steady balance without
 * storage: Ts = Ta + (1 - albedo) E / h for the sunlit and the shaded parts (assumption A-019).
 */
export function surfaces(s: Street2D, sky: Sky): Surfaces {
  const { dx, dz } = sunInSection(s, sky);
  const up = sky.elevation > 0 ? sky.dni * dz : 0;
  // Direct normal on a wall facing +x (the left wall) or -x (the right wall).
  const onLeft = sky.elevation > 0 ? sky.dni * Math.max(0, dx) : 0;
  const onRight = sky.elevation > 0 ? sky.dni * Math.max(0, -dx) : 0;
  const ta = sky.ta;
  const emit = (eps: number, albedo: number, direct: number, diffuse: number, lit: number) => {
    const tSun = ta + 273.15 + ((1 - albedo) * (direct + diffuse)) / SURFACE_H;
    const tShade = ta + 273.15 + ((1 - albedo) * diffuse) / SURFACE_H;
    return eps * SIGMA * (lit * tSun ** 4 + (1 - lit) * tShade ** 4);
  };

  let gLit = 0;
  let gSky = 0;
  let lLit = 0;
  let lSky = 0;
  let rLit = 0;
  let rSky = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const f = (i + 0.5) / SAMPLES;
    const gx = f * s.widthM;
    gLit += beamShare(s, sky, gx, 0);
    gSky += viewsUp(s, gx, 0).sky;
    const wz = f * s.heightM;
    lLit += onLeft > 0 ? beamShare(s, sky, 0, wz) : 0;
    lSky += viewsSide(s, 0, wz, 'right').sky;
    rLit += onRight > 0 ? beamShare(s, sky, s.widthM, wz) : 0;
    rSky += viewsSide(s, s.widthM, wz, 'left').sky;
  }
  const n = SAMPLES;
  const sunlit = { ground: gLit / n, left: lLit / n, right: rLit / n };
  const diffuse = {
    ground: (sky.dhi * gSky) / n,
    left: (sky.dhi * lSky) / n,
    right: (sky.dhi * rSky) / n,
  };
  return {
    sunlit,
    irradiance: {
      ground: up * sunlit.ground + diffuse.ground,
      left: onLeft * sunlit.left + diffuse.left,
      right: onRight * sunlit.right + diffuse.right,
    },
    emitted: {
      ground: emit(GROUND.emissivity, GROUND.albedo, up, diffuse.ground, sunlit.ground),
      left: emit(WALL.emissivity, WALL.albedo, onLeft, diffuse.left, sunlit.left),
      right: emit(WALL.emissivity, WALL.albedo, onRight, diffuse.right, sunlit.right),
    },
  };
}

export interface Radiant {
  /** Mean radiant temperature, C. */
  tmrt: number;
  /** Share of the direct beam reaching the person. */
  sun: number;
}

/** Tmrt of a person standing at x metres from the left wall (assumptions A-017 to A-021). */
export function meanRadiant(s: Street2D, sky: Sky, x: number, surf = surfaces(s, sky)): Radiant {
  const z = PERSON_HEIGHT_M;
  const sun = beamShare(s, sky, x, z);
  const { dx, dz, along } = sunInSection(s, sky);
  const beam = sky.elevation > 0 ? sky.dni * sun : 0;
  const lSky = skyEmissivity(sky.ta, sky.rh) * SIGMA * (sky.ta + 273.15) ** 4;
  const reflected = {
    left: WALL.albedo * surf.irradiance.left,
    right: WALL.albedo * surf.irradiance.right,
    ground: GROUND.albedo * surf.irradiance.ground,
  };
  const face = (v: Views, direct: number) => ({
    k:
      direct +
      sky.dhi * v.sky +
      v.left * reflected.left +
      v.right * reflected.right +
      v.ground * reflected.ground,
    l:
      v.sky * lSky +
      v.left * surf.emitted.left +
      v.right * surf.emitted.right +
      v.ground * surf.emitted.ground,
  });
  const faces = [
    { w: PERSON.vertical, ...face(viewsUp(s, x, z), beam * dz) },
    { w: PERSON.vertical, ...face(viewsDown(s, x, z), 0) },
    { w: PERSON.side, ...face(viewsSide(s, x, z, 'right'), beam * Math.max(0, dx)) },
    { w: PERSON.side, ...face(viewsSide(s, x, z, 'left'), beam * Math.max(0, -dx)) },
    { w: PERSON.side, ...face(viewsAlong(s, x, z), beam * Math.max(0, along)) },
    { w: PERSON.side, ...face(viewsAlong(s, x, z), beam * Math.max(0, -along)) },
  ];
  let sstr = 0;
  for (const f of faces) sstr += f.w * (PERSON.absorbShort * f.k + PERSON.emissivity * f.l);
  return { tmrt: (sstr / (PERSON.emissivity * SIGMA)) ** 0.25 - 273.15, sun };
}
