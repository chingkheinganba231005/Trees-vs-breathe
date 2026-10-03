import type { SolverParams } from '../cpu/solver';
import { equilibrium } from '../cpu/solver';
import type { Domain } from '../domain';
import { Q } from '../lattice';
import { updateStrided } from '../span';
import { SIDE, stepShader } from './shaders';

const WORKGROUP: [number, number] = [8, 8];
const PARAM_BYTES = 96;
/** Populations per node: nine flow directions, then five for the tracer (unused without one). */
const SLOTS = Q + 5;

// Chrome can lose a device whose adapter has been garbage-collected, so adapters are kept here
// for as long as their devices live.
const liveAdapters = new Map<GPUDevice, GPUAdapter>();

/** Ask the browser for a WebGPU device; null when there is none (the caller falls back to CPU). */
export async function requestDevice(): Promise<GPUDevice | null> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    liveAdapters.set(device, adapter);
    void device.lost.then(() => liveAdapters.delete(device));
    return device;
  } catch {
    return null;
  }
}

/**
 * The same step as the CPU solver, in a WGSL compute shader with A-B buffers. Several steps are
 * encoded per submit; `fields` and `mean` stay on the GPU for rendering and are read back only
 * for probes and tests.
 */
export class GpuSolver {
  readonly device: GPUDevice;
  readonly domain: Domain;
  readonly n: number;
  params: SolverParams;
  time = 0;
  emaAlpha = 0;
  /** Weight of each step in the display mean of the fumes. */
  displayAlpha = 0;
  /** Set by restartExposure: the next step zeroes the exposure mean first. */
  private restartPending = false;
  readonly fBuffers: [GPUBuffer, GPUBuffer];
  readonly fieldsBuffer: GPUBuffer;
  readonly meanBuffer: GPUBuffer;
  readonly solidBuffer: GPUBuffer;
  /** Drag and tracer source per node, interleaved; bound to the step and compose passes. */
  readonly auxBuffer: GPUBuffer;
  private readonly aux: Float32Array;
  private readonly paramBuffer: GPUBuffer;
  private readonly checkpointBuffer: GPUBuffer;
  private checkpointTime = 0;
  private readonly inletBuffer: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroups: [GPUBindGroup, GPUBindGroup];
  /** Index of the buffer holding the current post-collision state. */
  private current: 0 | 1 = 0;

  constructor(device: GPUDevice, domain: Domain, params: SolverParams) {
    this.device = device;
    this.domain = domain;
    this.params = params;
    this.n = domain.nx * domain.ny;
    const fBytes = SLOTS * this.n * 4;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.fBuffers = [
      device.createBuffer({ size: fBytes, usage, label: 'fA' }),
      device.createBuffer({ size: fBytes, usage, label: 'fB' }),
    ];
    this.fieldsBuffer = device.createBuffer({ size: this.n * 16, usage, label: 'fields' });
    this.meanBuffer = device.createBuffer({ size: this.n * 16, usage, label: 'mean' });
    this.solidBuffer = device.createBuffer({ size: this.n * 4, usage, label: 'solid' });
    this.auxBuffer = device.createBuffer({ size: this.n * 8, usage, label: 'drag and source' });
    this.inletBuffer = device.createBuffer({
      size: Math.max(16, domain.ny * 4),
      usage,
      label: 'inletU',
    });
    this.checkpointBuffer = device.createBuffer({ size: fBytes, usage, label: 'checkpoint' });
    this.paramBuffer = device.createBuffer({
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'params',
    });

    const module = device.createShaderModule({ code: stepShader(WORKGROUP), label: 'lbm step' });
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'step' },
      label: 'lbm step',
    });
    const layout = this.pipeline.getBindGroupLayout(0);
    const group = (src: GPUBuffer, dst: GPUBuffer) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.paramBuffer } },
          { binding: 1, resource: { buffer: src } },
          { binding: 2, resource: { buffer: dst } },
          { binding: 3, resource: { buffer: this.solidBuffer } },
          { binding: 4, resource: { buffer: this.inletBuffer } },
          { binding: 5, resource: { buffer: this.fieldsBuffer } },
          { binding: 6, resource: { buffer: this.meanBuffer } },
          { binding: 7, resource: { buffer: this.auxBuffer } },
        ],
      });
    this.bindGroups = [
      group(this.fBuffers[0], this.fBuffers[1]),
      group(this.fBuffers[1], this.fBuffers[0]),
    ];

    device.queue.writeBuffer(this.solidBuffer, 0, Uint32Array.from(domain.solid));
    this.aux = new Float32Array(2 * this.n);
    for (let k = 0; k < this.n; k++) {
      this.aux[2 * k] = params.drag?.[k] ?? 0;
      this.aux[2 * k + 1] = params.tracer?.source[k] ?? 0;
    }
    device.queue.writeBuffer(this.auxBuffer, 0, this.aux);
    const inlet = new Float32Array(Math.max(4, domain.ny));
    if (params.inletU) inlet.set(Array.from(params.inletU));
    device.queue.writeBuffer(this.inletBuffer, 0, inlet);
    this.writeParams();

    const rho = new Float64Array(this.n).fill(1);
    const ux = new Float64Array(this.n);
    if (domain.left === 'inlet' && params.inletU) {
      for (let y = 0; y < domain.ny; y++) ux[y * domain.nx] = params.inletU[y]!;
    }
    this.setState(rho, ux, new Float64Array(this.n));
    this.saveCheckpoint();
  }

  /** Change the flow parameters; takes effect on the next step. */
  setParams(params: SolverParams): void {
    this.params = params;
    const inlet = new Float32Array(Math.max(4, this.domain.ny));
    if (params.inletU) inlet.set(Array.from(params.inletU));
    this.device.queue.writeBuffer(this.inletBuffer, 0, inlet);
    this.writeParams();
  }

  /** Replace the porous drag (lambda per node, 1/cell), e.g. when trees are moved. */
  setDrag(drag: ArrayLike<number> | null): void {
    const span = updateStrided(this.aux, drag, 2);
    if (!span) return;
    // A moved crown changes a band of rows; the rest of the field stays on the GPU as it is.
    const [lo, hi] = span;
    this.device.queue.writeBuffer(this.auxBuffer, lo * 8, this.aux, 2 * lo, 2 * (hi - lo + 1));
  }

  /**
   * Restart the exposure mean only, e.g. after the greenery changed: the next step zeroes it
   * before averaging. The display mean carries on, so the picture does not blank.
   */
  restartExposure(): void {
    this.restartPending = true;
  }

  /** Restart every running mean, e.g. after the street was rebuilt. */
  clearMean(): void {
    // Cleared on the GPU: no zero-filled copy has to cross from the page.
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.meanBuffer);
    this.device.queue.submit([enc.finish()]);
  }

  /** Copy the current state aside on the GPU; used after a health check passes. */
  saveCheckpoint(): void {
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(
      this.currentPopulations,
      0,
      this.checkpointBuffer,
      0,
      SLOTS * this.n * 4,
    );
    this.device.queue.submit([enc.finish()]);
    this.checkpointTime = this.time;
  }

  restoreCheckpoint(): void {
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(
      this.checkpointBuffer,
      0,
      this.currentPopulations,
      0,
      SLOTS * this.n * 4,
    );
    this.device.queue.submit([enc.finish()]);
    this.time = this.checkpointTime;
  }

  writeParams(restart = false): void {
    const d = this.domain;
    const p = this.params;
    const buf = new ArrayBuffer(PARAM_BYTES);
    const i32 = new Int32Array(buf);
    const u32 = new Uint32Array(buf);
    const f32 = new Float32Array(buf);
    i32[0] = d.nx;
    i32[1] = d.ny;
    u32[2] = SIDE[d.left];
    u32[3] = SIDE[d.right];
    u32[4] = SIDE[d.bottom];
    u32[5] = SIDE[d.top];
    f32[6] = p.tau0;
    f32[7] = p.smagorinsky;
    f32[8] = p.gx;
    f32[9] = p.gy;
    f32[10] = d.lidVelocity;
    f32[11] = this.emaAlpha;
    f32[12] = p.sponge?.sigma ?? 0;
    f32[13] = p.sponge?.inlet ?? 0;
    f32[14] = p.sponge?.outlet ?? 0;
    f32[15] = p.sponge?.top ?? 0;
    u32[16] = p.tracer ? 1 : 0;
    f32[17] = p.tracer?.diffusivity ?? 0;
    f32[18] = p.tracer?.schmidt ?? 1;
    f32[19] = this.displayAlpha;
    u32[20] = restart ? 1 : 0;
    this.device.queue.writeBuffer(this.paramBuffer, 0, buf);
  }

  setState(rho: ArrayLike<number>, ux: ArrayLike<number>, uy: ArrayLike<number>): void {
    const f = new Float32Array(Q * this.n);
    const feq = new Float64Array(Q);
    for (let k = 0; k < this.n; k++) {
      equilibrium(rho[k]!, ux[k]!, uy[k]!, feq);
      for (let i = 0; i < Q; i++) f[i * this.n + k] = feq[i]!;
    }
    this.uploadPopulations(f);
  }

  /** Write flow populations (Q per node); with a longer array, tracer populations follow. */
  uploadPopulations(f: Float32Array): void {
    this.device.queue.writeBuffer(this.fBuffers[this.current], 0, f);
  }

  /** Encode `steps` steps into one submit. */
  step(steps = 1): void {
    if (this.restartPending && steps > 0) {
      // Parameter writes are ordered with submissions, not inside one: the restarting step goes
      // in a submission of its own, between a write that sets the flag and one that clears it.
      this.restartPending = false;
      this.writeParams(true);
      this.dispatch(1);
      this.writeParams(false);
      steps -= 1;
    }
    if (steps > 0) this.dispatch(steps);
  }

  private dispatch(steps: number): void {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline);
    const gx = Math.ceil(this.domain.nx / WORKGROUP[0]);
    const gy = Math.ceil(this.domain.ny / WORKGROUP[1]);
    for (let s = 0; s < steps; s++) {
      pass.setBindGroup(0, this.bindGroups[this.current]);
      pass.dispatchWorkgroups(gx, gy);
      this.current = this.current === 0 ? 1 : 0;
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.time += steps;
  }

  get currentPopulations(): GPUBuffer {
    return this.fBuffers[this.current];
  }

  async read(buffer: GPUBuffer, bytes: number): Promise<Float32Array> {
    const staging = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }

  /** Flow populations (Q blocks of n), then the tracer's (5 blocks of n). */
  readPopulations(): Promise<Float32Array> {
    return this.read(this.currentPopulations, SLOTS * this.n * 4);
  }

  /** rho, ux, uy, tau per node of the last step, interleaved. */
  readFields(): Promise<Float32Array> {
    return this.read(this.fieldsBuffer, this.n * 16);
  }

  readMean(): Promise<Float32Array> {
    return this.read(this.meanBuffer, this.n * 16);
  }

  destroy(): void {
    for (const b of [
      ...this.fBuffers,
      this.fieldsBuffer,
      this.meanBuffer,
      this.checkpointBuffer,
      this.solidBuffer,
      this.auxBuffer,
      this.paramBuffer,
      this.inletBuffer,
    ]) {
      b.destroy();
    }
  }
}
