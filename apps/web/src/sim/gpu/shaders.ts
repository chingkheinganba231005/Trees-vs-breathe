import { CS2, CX, CY, MIRROR_Y, OPP, Q, W } from '../lattice';

// Side codes shared with solver.ts.
export const SIDE = { periodic: 0, wall: 1, inlet: 2, outlet: 3, moving: 4, freeslip: 5 } as const;

/**
 * WGSL for one solver step. The nine directions are unrolled with the lattice constants inlined,
 * and the pull rules follow build_stream_map in python/treesvb/solver2d/domain.py line by line.
 */
export function stepShader(workgroup: [number, number]): string {
  const pulls = Array.from({ length: Q }, (_, i) => pullFunction(i)).join('\n');
  const loads = Array.from({ length: Q }, (_, i) => `  let f${i} = pull${i}(x, y, k);`).join('\n');
  return /* wgsl */ `
struct Params {
  nx: i32, ny: i32, left: u32, right: u32,
  bottom: u32, top: u32, tau0: f32, cs: f32,
  gx: f32, gy: f32, lid: f32, emaAlpha: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> fIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> fOut: array<f32>;
@group(0) @binding(3) var<storage, read> solid: array<u32>;
@group(0) @binding(4) var<storage, read> inletU: array<f32>;
// rho, ux, uy, tau of the state this step collided.
@group(0) @binding(5) var<storage, read_write> fields: array<vec4<f32>>;
// Exponential moving average of ux, uy, |u| (the fourth component is unused).
@group(0) @binding(6) var<storage, read_write> mean: array<vec4<f32>>;

fn N() -> i32 { return P.nx * P.ny; }
fn at(i: i32, k: i32) -> f32 { return fIn[i * N() + k]; }

${pulls}

fn feq(i: i32, rho: f32, ux: f32, uy: f32) -> f32 {
  let w = array<f32, 9>(${W.map((w) => w.toFixed(9)).join(', ')});
  let cx = array<f32, 9>(${CX.map((c) => `${c}.0`).join(', ')});
  let cy = array<f32, 9>(${CY.map((c) => `${c}.0`).join(', ')});
  let cu = cx[i] * ux + cy[i] * uy;
  return w[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

fn write(k: i32, f: array<f32, 9>) {
  let n = N();
  for (var i = 0; i < 9; i++) { fOut[i * n + k] = f[i]; }
}

@compute @workgroup_size(${workgroup[0]}, ${workgroup[1]})
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= P.nx || y >= P.ny) { return; }
  let k = y * P.nx + x;

  if (P.left == ${SIDE.inlet}u && x == 0) {
    // Equilibrium at the inlet velocity and the previous density of column 1.
    var rhoIn = 0.0;
    for (var i = 0; i < 9; i++) { rhoIn += at(i, k + 1); }
    let u = inletU[y];
    var f: array<f32, 9>;
    for (var i = 0; i < 9; i++) { f[i] = feq(i, rhoIn, u, 0.0); }
    write(k, f);
    fields[k] = vec4<f32>(rhoIn, u, 0.0, P.tau0);
    return;
  }

  if (solid[k] != 0u) {
    var f: array<f32, 9>;
    for (var i = 0; i < 9; i++) { f[i] = at(i, k); }
    write(k, f);
    fields[k] = vec4<f32>(1.0, 0.0, 0.0, 0.0);
    return;
  }

${loads}
  let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  let ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho + 0.5 * P.gx;
  let uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho + 0.5 * P.gy;
  let fx = rho * P.gx;
  let fy = rho * P.gy;
  let usq = 1.5 * (ux * ux + uy * uy);
  let a = ux + uy;
  let b = -ux + uy;
  let e0 = ${W[0].toFixed(9)} * rho * (1.0 - usq);
  let e1 = ${W[1].toFixed(9)} * rho * (1.0 + 3.0 * ux + 4.5 * ux * ux - usq);
  let e2 = ${W[2].toFixed(9)} * rho * (1.0 + 3.0 * uy + 4.5 * uy * uy - usq);
  let e3 = ${W[3].toFixed(9)} * rho * (1.0 - 3.0 * ux + 4.5 * ux * ux - usq);
  let e4 = ${W[4].toFixed(9)} * rho * (1.0 - 3.0 * uy + 4.5 * uy * uy - usq);
  let e5 = ${W[5].toFixed(9)} * rho * (1.0 + 3.0 * a + 4.5 * a * a - usq);
  let e6 = ${W[6].toFixed(9)} * rho * (1.0 + 3.0 * b + 4.5 * b * b - usq);
  let e7 = ${W[7].toFixed(9)} * rho * (1.0 - 3.0 * a + 4.5 * a * a - usq);
  let e8 = ${W[8].toFixed(9)} * rho * (1.0 - 3.0 * b + 4.5 * b * b - usq);

  var tau = P.tau0;
  if (P.cs > 0.0) {
    // Non-equilibrium flux with the Guo force contribution removed (see core.py).
    let pxx = (f1 - e1) + (f3 - e3) + (f5 - e5) + (f6 - e6) + (f7 - e7) + (f8 - e8) + fx * ux;
    let pyy = (f2 - e2) + (f4 - e4) + (f5 - e5) + (f6 - e6) + (f7 - e7) + (f8 - e8) + fy * uy;
    let pxy = (f5 - e5) - (f6 - e6) + (f7 - e7) - (f8 - e8) + 0.5 * (fx * uy + fy * ux);
    let q = sqrt(pxx * pxx + pyy * pyy + 2.0 * pxy * pxy);
    tau = 0.5 * (P.tau0 + sqrt(P.tau0 * P.tau0 + ${(18 * Math.SQRT2).toFixed(9)} * P.cs * P.cs * q / rho));
  }
  let om = 1.0 / tau;
  let pre = 1.0 - 0.5 * om;
  let w0 = ${W[0].toFixed(9)};
  let w1 = ${W[1].toFixed(9)};
  let w5 = ${W[5].toFixed(9)};
  let s0 = pre * w0 * (-3.0 * ux * fx - 3.0 * uy * fy);
  let s1 = pre * w1 * ((3.0 * (1.0 - ux) + 9.0 * ux) * fx - 3.0 * uy * fy);
  let s2 = pre * w1 * (-3.0 * ux * fx + (3.0 * (1.0 - uy) + 9.0 * uy) * fy);
  let s3 = pre * w1 * ((3.0 * (-1.0 - ux) + 9.0 * ux) * fx - 3.0 * uy * fy);
  let s4 = pre * w1 * (-3.0 * ux * fx + (3.0 * (-1.0 - uy) + 9.0 * uy) * fy);
  let s5 = pre * w5 * ((3.0 * (1.0 - ux) + 9.0 * a) * fx + (3.0 * (1.0 - uy) + 9.0 * a) * fy);
  let s6 = pre * w5 * ((3.0 * (-1.0 - ux) - 9.0 * b) * fx + (3.0 * (1.0 - uy) + 9.0 * b) * fy);
  let s7 = pre * w5 * ((3.0 * (-1.0 - ux) + 9.0 * a) * fx + (3.0 * (-1.0 - uy) + 9.0 * a) * fy);
  let s8 = pre * w5 * ((3.0 * (1.0 - ux) - 9.0 * b) * fx + (3.0 * (-1.0 - uy) + 9.0 * b) * fy);

  var out: array<f32, 9>;
  out[0] = f0 - om * (f0 - e0) + s0;
  out[1] = f1 - om * (f1 - e1) + s1;
  out[2] = f2 - om * (f2 - e2) + s2;
  out[3] = f3 - om * (f3 - e3) + s3;
  out[4] = f4 - om * (f4 - e4) + s4;
  out[5] = f5 - om * (f5 - e5) + s5;
  out[6] = f6 - om * (f6 - e6) + s6;
  out[7] = f7 - om * (f7 - e7) + s7;
  out[8] = f8 - om * (f8 - e8) + s8;
  write(k, out);
  fields[k] = vec4<f32>(rho, ux, uy, tau);
  if (P.emaAlpha > 0.0) {
    let m = mean[k];
    let cur = vec4<f32>(ux, uy, sqrt(ux * ux + uy * uy), 0.0);
    mean[k] = m + P.emaAlpha * (cur - m);
  }
}
`;
}

/** WGSL for the population pulled into direction i, per the rules of build_stream_map. */
function pullFunction(i: number): string {
  const cx = CX[i]!;
  const cy = CY[i]!;
  const opp = OPP[i]!;
  const mirror = MIRROR_Y[i]!;
  const lidTerm = ((2 * W[i]! * cx) / CS2).toFixed(9);
  return `fn pull${i}(x: i32, y: i32, k: i32) -> f32 {
  var sx = x - (${cx});
  var sy = y - (${cy});
  if (P.left == ${SIDE.periodic}u) {
    sx = (sx + P.nx) % P.nx;
  } else {
    if (sx < 0 && P.left == ${SIDE.wall}u) { return at(${opp}, k); }
    if (sx >= P.nx) {
      if (P.right == ${SIDE.wall}u) { return at(${opp}, k); }
      if (P.right == ${SIDE.outlet}u) { sx = x; }
    }
    sx = clamp(sx, 0, P.nx - 1);
  }
  if (P.bottom == ${SIDE.periodic}u) {
    sy = (sy + P.ny) % P.ny;
  } else {
    if (sy < 0) { return at(${opp}, k); }
    if (sy >= P.ny) {
      if (P.top == ${SIDE.freeslip}u) { return at(${mirror}, (P.ny - 1) * P.nx + sx); }
      if (P.top == ${SIDE.moving}u) { return at(${opp}, k) + ${lidTerm} * P.lid; }
      return at(${opp}, k);
    }
  }
  let s = sy * P.nx + sx;
  if (solid[s] != 0u) { return at(${opp}, k); }
  return at(${i}, s);
}`;
}
