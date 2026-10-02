import { MAX_AGE } from '../particles';
import type { Layers } from '../cpu/canvasRenderer';
import type { SimColors, ViewWindow } from '../view';
import type { GpuSolver } from './solver';

const VIEW_BYTES = 128;

const common = /* wgsl */ `
struct View {
  x0: f32, vw: f32, vh: f32, nx: f32,
  ny: f32, uRef: f32, speedOn: f32, steps: f32,
  canvasW: f32, canvasH: f32, lineWidth: f32, frame: f32,
  count: f32, maxAge: f32, fade: f32, windOn: f32,
  background: vec4<f32>,
  building: vec4<f32>,
  ink: vec4<f32>,
  particle: vec4<f32>,
};
struct Particle { pos: vec2<f32>, prev: vec2<f32>, age: f32, pad0: f32, pad1: f32, pad2: f32 };

fn hash(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  s = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (s >> 22u) ^ s;
}
fn rand(seed: u32) -> f32 { return f32(hash(seed)) / 4294967295.0; }
`;

const advectShader = /* wgsl */ `
${common}
@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> fields: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read_write> particles: array<Particle>;

fn isSolid(p: vec2<f32>) -> bool {
  let x = i32(floor(p.x));
  let y = i32(floor(p.y));
  if (x < 0 || y < 0 || x >= i32(V.nx) || y >= i32(V.ny)) { return true; }
  return solid[u32(y) * u32(V.nx) + u32(x)] != 0u;
}

fn velocity(p: vec2<f32>) -> vec2<f32> {
  let nx = i32(V.nx);
  let f = clamp(p - vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(V.nx - 1.001, V.ny - 1.001));
  let i = vec2<i32>(floor(f));
  let t = f - floor(f);
  let k = i.y * nx + i.x;
  let a = fields[k].yz;
  let b = fields[k + 1].yz;
  let c = fields[k + nx].yz;
  let d = fields[k + nx + 1].yz;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

fn respawn(i: u32) -> Particle {
  var p: Particle;
  for (var tries = 0u; tries < 16u; tries++) {
    let s = i * 7919u + u32(V.frame) * 104729u + tries * 15485863u;
    let pos = vec2<f32>(V.x0 + rand(s) * V.vw, rand(s ^ 0x9e3779b9u) * V.vh);
    p.pos = pos;
    p.prev = pos;
    p.age = 0.0;
    if (!isSolid(pos)) { break; }
  }
  return p;
}

@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(V.count)) { return; }
  var p = particles[i];
  if (p.age < 0.0) { particles[i] = respawn(i); return; }
  let next = p.pos + velocity(p.pos) * V.steps;
  let age = p.age + 1.0;
  let out = next.x < V.x0 || next.x >= V.x0 + V.vw || next.y < 0.0 || next.y >= V.vh;
  if (out || age > V.maxAge || isSolid(next)) {
    particles[i] = respawn(i);
    return;
  }
  p.prev = p.pos;
  p.pos = next;
  p.age = age;
  particles[i] = p;
}
`;

const trailShader = /* wgsl */ `
${common}
@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(3) var<storage, read> particles: array<Particle>;

struct Out { @builtin(position) pos: vec4<f32>, @location(0) alpha: f32 };

fn toClip(p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>((p.x - V.x0) / V.vw * 2.0 - 1.0, p.y / V.vh * 2.0 - 1.0);
}

@vertex
fn segment(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let p = particles[i];
  let a = toClip(p.prev);
  let b = toClip(p.pos);
  let px = vec2<f32>(2.0 / V.canvasW, 2.0 / V.canvasH);
  var dir = (b - a) / px;
  if (length(dir) < 0.001) { dir = vec2<f32>(1.0, 0.0); }
  let n = normalize(vec2<f32>(-dir.y, dir.x)) * V.lineWidth * 0.5 * px;
  let corners = array<vec2<f32>, 6>(a - n, a + n, b + n, a - n, b + n, b - n);
  var o: Out;
  o.pos = vec4<f32>(corners[v], 0.0, 1.0);
  // Fresh particles have no segment yet; fade new and old ones in and out.
  let life = p.age / V.maxAge;
  o.alpha = select(0.9 * min(1.0, 8.0 * life) * min(1.0, 8.0 * (1.0 - life)), 0.0, p.age < 1.0);
  return o;
}

@fragment
fn ink(i: Out) -> @location(0) vec4<f32> {
  return vec4<f32>(V.particle.rgb * i.alpha, i.alpha);
}

@vertex
fn fullscreen(@builtin(vertex_index) v: u32) -> @builtin(position) vec4<f32> {
  let p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[v], 0.0, 1.0);
}

@fragment
fn fade() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, V.fade);
}
`;

const composeShader = /* wgsl */ `
${common}
@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> fields: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(4) var trail: texture_2d<f32>;

@vertex
fn fullscreen(@builtin(vertex_index) v: u32) -> @builtin(position) vec4<f32> {
  let p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[v], 0.0, 1.0);
}

@fragment
fn compose(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = vec2<f32>(frag.x / V.canvasW, 1.0 - frag.y / V.canvasH);
  let x = u32(clamp(floor(V.x0 + uv.x * V.vw), 0.0, V.nx - 1.0));
  let y = u32(clamp(floor(uv.y * V.vh), 0.0, V.ny - 1.0));
  let k = y * u32(V.nx) + x;
  if (solid[k] != 0u) { return vec4<f32>(V.building.rgb, 1.0); }
  var c = V.background.rgb;
  if (V.speedOn > 0.5) {
    let u = fields[k].yz;
    let s = clamp(length(u) / (1.2 * V.uRef), 0.0, 1.0);
    c = mix(c, V.ink.rgb, 0.32 * s);
  }
  if (V.windOn > 0.5) {
    let t = textureLoad(trail, vec2<i32>(i32(frag.x), i32(frag.y)), 0);
    c = c * (1.0 - t.a) + t.rgb;
  }
  return vec4<f32>(c, 1.0);
}
`;

/**
 * Draws the GPU solver's fields without reading them back: a compute pass moves the wind
 * markers, a render pass accumulates their fading trails, and a final pass composes speed
 * shading, trails and buildings onto the canvas.
 */
export class GpuRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly viewBuffer: GPUBuffer;
  private readonly particleBuffer: GPUBuffer;
  private readonly advectPipeline: GPUComputePipeline;
  private readonly fadePipeline: GPURenderPipeline;
  private readonly segmentPipeline: GPURenderPipeline;
  private readonly composePipeline: GPURenderPipeline;
  private trail: GPUTexture | null = null;
  private advectGroup: GPUBindGroup | null = null;
  private trailGroup: GPUBindGroup | null = null;
  private composeGroup: GPUBindGroup | null = null;
  private solver: GpuSolver | null = null;
  private frame = 0;
  readonly count: number;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, count = 4096) {
    this.device = device;
    this.count = count;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU canvas context unavailable');
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: 'opaque' });

    this.viewBuffer = device.createBuffer({
      size: VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleBuffer = device.createBuffer({
      size: count * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.resetParticles();

    const advectModule = device.createShaderModule({ code: advectShader, label: 'advect' });
    this.advectPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: advectModule, entryPoint: 'advect' },
    });
    const trailModule = device.createShaderModule({ code: trailShader, label: 'trail' });
    const trailLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const trailPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [trailLayout] });
    this.fadePipeline = device.createRenderPipeline({
      layout: trailPipelineLayout,
      vertex: { module: trailModule, entryPoint: 'fullscreen' },
      fragment: {
        module: trailModule,
        entryPoint: 'fade',
        targets: [
          {
            format: 'rgba16float',
            // dst = dst * fade: the trails left by earlier frames die away.
            blend: {
              color: { srcFactor: 'zero', dstFactor: 'src-alpha', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'src-alpha', operation: 'add' },
            },
          },
        ],
      },
    });
    this.segmentPipeline = device.createRenderPipeline({
      layout: trailPipelineLayout,
      vertex: { module: trailModule, entryPoint: 'segment' },
      fragment: {
        module: trailModule,
        entryPoint: 'ink',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
    });
    const composeModule = device.createShaderModule({ code: composeShader, label: 'compose' });
    this.composePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: composeModule, entryPoint: 'fullscreen' },
      fragment: {
        module: composeModule,
        entryPoint: 'compose',
        targets: [{ format: this.format }],
      },
    });
  }

  resetParticles(): void {
    // A negative age asks the advect pass to place the particle on its first frame.
    const data = new Float32Array(this.count * 8);
    for (let i = 0; i < this.count; i++) data[i * 8 + 4] = -1;
    this.device.queue.writeBuffer(this.particleBuffer, 0, data);
  }

  attach(solver: GpuSolver, width: number, height: number): void {
    this.solver = solver;
    this.trail?.destroy();
    this.trail = this.device.createTexture({
      size: [Math.max(1, width), Math.max(1, height)],
      // 16-bit float, so the repeated fade decays to zero instead of stalling at 8-bit steps.
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const d = this.device;
    this.advectGroup = d.createBindGroup({
      layout: this.advectPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 1, resource: { buffer: solver.fieldsBuffer } },
        { binding: 2, resource: { buffer: solver.solidBuffer } },
        { binding: 3, resource: { buffer: this.particleBuffer } },
      ],
    });
    this.trailGroup = d.createBindGroup({
      layout: this.fadePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 3, resource: { buffer: this.particleBuffer } },
      ],
    });
    this.composeGroup = d.createBindGroup({
      layout: this.composePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 1, resource: { buffer: solver.fieldsBuffer } },
        { binding: 2, resource: { buffer: solver.solidBuffer } },
        { binding: 4, resource: this.trail.createView() },
      ],
    });
    this.resetParticles();
    // Clear old trails.
    const enc = d.createCommandEncoder();
    enc
      .beginRenderPass({
        colorAttachments: [
          {
            view: this.trail.createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      })
      .end();
    d.queue.submit([enc.finish()]);
  }

  draw(
    view: ViewWindow,
    uRef: number,
    steps: number,
    layers: Layers,
    colors: SimColors,
    width: number,
    height: number,
  ): void {
    const solver = this.solver;
    if (!solver || !this.trail || !this.advectGroup || !this.trailGroup || !this.composeGroup) {
      return;
    }
    this.frame += 1;
    const v = new Float32Array(VIEW_BYTES / 4);
    v.set([
      view.x0,
      view.width,
      view.height,
      solver.domain.nx,
      solver.domain.ny,
      uRef,
      layers.speed ? 1 : 0,
      steps,
      width,
      height,
      Math.max(1.5, 1.2 * (window.devicePixelRatio || 1)),
      this.frame,
      this.count,
      MAX_AGE,
      0.9,
      layers.wind ? 1 : 0,
    ]);
    v.set([...colors.background, 1], 16);
    v.set([...colors.building, 1], 20);
    v.set([...colors.ink, 1], 24);
    v.set([...colors.particle, 1], 28);
    this.device.queue.writeBuffer(this.viewBuffer, 0, v);

    const enc = this.device.createCommandEncoder();
    if (layers.wind) {
      const cp = enc.beginComputePass();
      cp.setPipeline(this.advectPipeline);
      cp.setBindGroup(0, this.advectGroup);
      cp.dispatchWorkgroups(Math.ceil(this.count / 64));
      cp.end();

      const tp = enc.beginRenderPass({
        colorAttachments: [{ view: this.trail.createView(), loadOp: 'load', storeOp: 'store' }],
      });
      tp.setBindGroup(0, this.trailGroup);
      tp.setPipeline(this.fadePipeline);
      tp.draw(3);
      tp.setPipeline(this.segmentPipeline);
      tp.draw(6, this.count);
      tp.end();
    }

    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [...colors.background, 1],
        },
      ],
    });
    pass.setPipeline(this.composePipeline);
    pass.setBindGroup(0, this.composeGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  destroy(): void {
    this.trail?.destroy();
    this.viewBuffer.destroy();
    this.particleBuffer.destroy();
  }
}
