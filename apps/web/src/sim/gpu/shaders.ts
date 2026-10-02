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
  const tracerPulls = Array.from({ length: 5 }, (_, i) => pullFunction(i, Q)).join('\n');
  return /* wgsl */ `
struct Params {
  nx: i32, ny: i32, left: u32, right: u32,
  bottom: u32, top: u32, tau0: f32, cs: f32,
  gx: f32, gy: f32, lid: f32, emaAlpha: f32,
  spongeSigma: f32, spongeIn: f32, spongeOut: f32, spongeTop: f32,
  tracer: u32, d0: f32, sct: f32, pad: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> fIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> fOut: array<f32>;
@group(0) @binding(3) var<storage, read> solid: array<u32>;
@group(0) @binding(4) var<storage, read> inletU: array<f32>;
// rho, ux, uy, tau of the state this step collided.
@group(0) @binding(5) var<storage, read_write> fields: array<vec4<f32>>;
// Exponential moving average of ux, uy, |u| and the tracer concentration.
@group(0) @binding(6) var<storage, read_write> mean: array<vec4<f32>>;
// Per node: pressure-loss coefficient lambda (1/cell) and tracer source per step.
@group(0) @binding(7) var<storage, read> aux: array<vec2<f32>>;

// Populations: nine flow directions, then five tracer directions (D2Q5), each a block of N.
fn N() -> i32 { return P.nx * P.ny; }
fn at(i: i32, k: i32) -> f32 { return fIn[i * N() + k]; }

${pulls}
${tracerPulls}

// Tracer equilibrium w_i C (1 + 3 c_i . u), D2Q5 weights 1/3 and 1/6.
fn geq(c: f32, ux: f32, uy: f32) -> array<f32, 5> {
  let a = c / 6.0;
  return array<f32, 5>(c / 3.0, a * (1.0 + 3.0 * ux), a * (1.0 + 3.0 * uy), a * (1.0 - 3.0 * ux), a * (1.0 - 3.0 * uy));
}

fn writeTracer(k: i32, g: array<f32, 5>) {
  let n = N();
  for (var i = 0; i < 5; i++) { fOut[(${Q} + i) * n + k] = g[i]; }
}

fn feq(i: i32, rho: f32, ux: f32, uy: f32) -> f32 {
  let w = array<f32, 9>(${W.map((w) => w.toFixed(9)).join(', ')});
  let cx = array<f32, 9>(${CX.map((c) => `${c}.0`).join(', ')});
  let cy = array<f32, 9>(${CY.map((c) => `${c}.0`).join(', ')});
  let cu = cx[i] * ux + cy[i] * uy;
  return w[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

fn ramp(v: f32) -> f32 { let c = clamp(v, 0.0, 1.0); return c * c; }

// Absorbing-layer strength, as core.sponge_field in Python.
fn sponge(x: i32, y: i32) -> f32 {
  if (P.spongeSigma == 0.0) { return 0.0; }
  var r = 0.0;
  if (P.spongeIn > 0.0) { r = max(r, ramp((P.spongeIn - f32(x)) / P.spongeIn)); }
  if (P.spongeOut > 0.0) {
    r = max(r, ramp((f32(x) - (f32(P.nx) - 1.0 - P.spongeOut)) / P.spongeOut));
  }
  if (P.spongeTop > 0.0) {
    r = max(r, ramp((f32(y) - (f32(P.ny) - 1.0 - P.spongeTop)) / P.spongeTop));
  }
  return P.spongeSigma * r;
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
    // Clean air comes in.
    if (P.tracer != 0u) { writeTracer(k, array<f32, 5>(0.0, 0.0, 0.0, 0.0, 0.0)); }
    fields[k] = vec4<f32>(rhoIn, u, 0.0, P.tau0);
    return;
  }

  if (P.right == ${SIDE.outlet}u && x == P.nx - 1) {
    // Density 1 and the neighbour's previous velocity (see core.py).
    var rho = 0.0;
    var jx = 0.0;
    var jy = 0.0;
    let cxs = array<f32, 9>(${CX.map((c) => `${c}.0`).join(', ')});
    let cys = array<f32, 9>(${CY.map((c) => `${c}.0`).join(', ')});
    for (var i = 0; i < 9; i++) {
      let f = at(i, k - 1);
      rho += f;
      jx += f * cxs[i];
      jy += f * cys[i];
    }
    var f: array<f32, 9>;
    for (var i = 0; i < 9; i++) { f[i] = feq(i, 1.0, jx / rho, jy / rho); }
    write(k, f);
    if (P.tracer != 0u) {
      // Equilibrium at the neighbour's previous concentration and velocity.
      var c = 0.0;
      for (var i = 0; i < 5; i++) { c += at(${Q} + i, k - 1); }
      writeTracer(k, geq(c, jx / rho, jy / rho));
    }
    fields[k] = vec4<f32>(1.0, jx / rho, jy / rho, P.tau0);
    return;
  }

  if (solid[k] != 0u) {
    var f: array<f32, 9>;
    for (var i = 0; i < 9; i++) { f[i] = at(i, k); }
    write(k, f);
    if (P.tracer != 0u) {
      var g: array<f32, 5>;
      for (var i = 0; i < 5; i++) { g[i] = at(${Q} + i, k); }
      writeTracer(k, g);
    }
    fields[k] = vec4<f32>(1.0, 0.0, 0.0, 0.0);
    return;
  }

${loads}
  let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  var ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho + 0.5 * P.gx;
  var uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho + 0.5 * P.gy;
  var fx = rho * P.gx;
  var fy = rho * P.gy;
  let lam = aux[k].x;
  if (lam > 0.0) {
    // Porous drag -(lambda/2) rho |u| u, with u solved implicitly (core.macros).
    let kk = 2.0 / (1.0 + sqrt(1.0 + lam * length(vec2<f32>(ux, uy))));
    ux *= kk;
    uy *= kk;
    let dr = 0.5 * lam * length(vec2<f32>(ux, uy));
    fx -= rho * dr * ux;
    fy -= rho * dr * uy;
  }
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

  // Absorbing layers: f_eq(1, u) - f_eq(rho, u) = (1 - rho) / rho f_eq(rho, u).
  let sp = sponge(x, y) * (1.0 - rho) / rho;
  var out: array<f32, 9>;
  out[0] = f0 - om * (f0 - e0) + s0 + sp * e0;
  out[1] = f1 - om * (f1 - e1) + s1 + sp * e1;
  out[2] = f2 - om * (f2 - e2) + s2 + sp * e2;
  out[3] = f3 - om * (f3 - e3) + s3 + sp * e3;
  out[4] = f4 - om * (f4 - e4) + s4 + sp * e4;
  out[5] = f5 - om * (f5 - e5) + s5 + sp * e5;
  out[6] = f6 - om * (f6 - e6) + s6 + sp * e6;
  out[7] = f7 - om * (f7 - e7) + s7 + sp * e7;
  out[8] = f8 - om * (f8 - e8) + s8 + sp * e8;
  write(k, out);
  fields[k] = vec4<f32>(rho, ux, uy, tau);

  var conc = 0.0;
  if (P.tracer != 0u) {
    let g0 = pullT0(x, y, k);
    let g1 = pullT1(x, y, k);
    let g2 = pullT2(x, y, k);
    let g3 = pullT3(x, y, k);
    let g4 = pullT4(x, y, k);
    conc = g0 + g1 + g2 + g3 + g4;
    // Eddy diffusivity nu_t / Sc_t from this step's Smagorinsky relaxation time.
    let tauC = 0.5 + 3.0 * (P.d0 + (tau - P.tau0) / 3.0 / P.sct);
    let oc = 1.0 / tauC;
    let e = geq(conc, ux, uy);
    let q = aux[k].y;
    writeTracer(k, array<f32, 5>(
      g0 - oc * (g0 - e[0]) + q / 3.0,
      g1 - oc * (g1 - e[1]) + q / 6.0,
      g2 - oc * (g2 - e[2]) + q / 6.0,
      g3 - oc * (g3 - e[3]) + q / 6.0,
      g4 - oc * (g4 - e[4]) + q / 6.0,
    ));
  }

  if (P.emaAlpha > 0.0) {
    let m = mean[k];
    let cur = vec4<f32>(ux, uy, sqrt(ux * ux + uy * uy), conc);
    mean[k] = m + P.emaAlpha * (cur - m);
  }
}
`;
}

/**
 * WGSL for the population pulled into direction i, per the rules of build_stream_map. With an
 * offset the same rules read the tracer block (directions 0-4 only reference each other), and
 * the moving-lid term is dropped, as the tracer does not support a moving lid.
 */
function pullFunction(i: number, offset = 0): string {
  const cx = CX[i]!;
  const cy = CY[i]!;
  const opp = OPP[i]! + offset;
  const mirror = MIRROR_Y[i]! + offset;
  const self = i + offset;
  const lidTerm = offset ? '0.0' : ((2 * W[i]! * cx) / CS2).toFixed(9);
  const name = offset ? `pullT${i}` : `pull${i}`;
  return `fn ${name}(x: i32, y: i32, k: i32) -> f32 {
  var sx = x - (${cx});
  var sy = y - (${cy});
  if (P.left == ${SIDE.periodic}u) {
    sx = (sx + P.nx) % P.nx;
  } else {
    if (sx < 0 && P.left == ${SIDE.wall}u) { return at(${opp}, k); }
    if (sx >= P.nx && P.right == ${SIDE.wall}u) { return at(${opp}, k); }
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
  return at(${self}, s);
}`;
}
