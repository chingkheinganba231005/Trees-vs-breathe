import type { Layers } from './cpu/canvasRenderer';
import { CanvasRenderer } from './cpu/canvasRenderer';
import type { FromWorker, ToWorker } from './cpu/protocol';
import type { Engine, EngineChoice } from './engine';
import { isHealthy, lowerTimeStep } from './guard';
import { GpuRenderer } from './gpu/render';
import { GpuSolver, requestDevice } from './gpu/solver';
import { Particles } from './particles';
import type { CanyonGeometry, FlowSettings } from './street';
import { canyonDomain, canyonGeometry, canyonNx, canyonParams, uniformStart } from './street';
import type { SimColors, ViewWindow } from './view';
import { streetView } from './view';

/**
 * Live settings. Chosen from the stability sweep in results/street/stability.json: BGK with the
 * Smagorinsky model stays stable at this Reynolds number with Cs = 0.17 but not with Cs = 0.1.
 */
export const LIVE_FLOW: FlowSettings = { uRef: 0.05, reynolds: 20000, smagorinsky: 0.17 };
/** Building height in cells: 48 on WebGPU (BRIEF.md 5.1), 24 for the CPU worker. */
export const HEIGHT = { gpu: 48, cpu: 24 } as const;

export type EngineNote =
  | 'engineNote.gpu'
  | 'engineNote.noWebgpu'
  | 'engineNote.webgpuFailed'
  | 'engineNote.cpuChosen'
  | 'engineNote.gpuLost';

export interface SimStats {
  engine: Engine;
  height: number;
  aspect: number;
  cells: number;
  reynolds: number;
  uRef: number;
  tau0: number;
  smagorinsky: number;
  /** Lattice steps per second of wall time. */
  stepsPerSecond: number;
  fps: number;
  /** Lattice steps since the street was built. */
  time: number;
  /** Times the guard restored the last good state and lowered the time step. */
  recoveries: number;
  /** Why the engine is what it is; a key into the strings files. */
  note: EngineNote;
}

export interface StreetSimOptions {
  aspect: number;
  layers: Layers;
  colors: SimColors;
  engine: EngineChoice;
  onStats: (stats: SimStats) => void;
  /** Called when the GPU stops working, so the caller can restart on the CPU. */
  onFallback?: (reason: EngineNote) => void;
}

export interface StreetSim {
  readonly engine: Engine;
  setAspect(aspect: number): void;
  setLayers(layers: Layers): void;
  setColors(colors: SimColors): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

function solidAt(g: CanyonGeometry, solid: Uint8Array) {
  const nx = canyonNx(g);
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= nx || iy >= g.top) return true;
    return solid[iy * nx + ix] === 1;
  };
}

/** Build the live street on WebGPU if the device has it, otherwise on the CPU worker. */
export async function createStreetSim(
  canvas: HTMLCanvasElement,
  opts: StreetSimOptions,
  fallbackNote?: EngineNote,
): Promise<StreetSim> {
  if (fallbackNote) return new CpuStreetSim(canvas, opts, fallbackNote);
  if (opts.engine !== 'cpu') {
    const device = await requestDevice();
    if (device) {
      try {
        return new GpuStreetSim(device, canvas, opts);
      } catch (err) {
        console.warn('WebGPU solver failed to start; using the CPU worker instead.', err);
        return new CpuStreetSim(canvas, opts, 'engineNote.webgpuFailed');
      }
    }
    return new CpuStreetSim(canvas, opts, 'engineNote.noWebgpu');
  }
  return new CpuStreetSim(canvas, opts, 'engineNote.cpuChosen');
}

abstract class BaseSim {
  protected aspect: number;
  protected layers: Layers;
  protected colors: SimColors;
  protected flow: FlowSettings = { ...LIVE_FLOW };
  protected geometry!: CanyonGeometry;
  protected view!: ViewWindow;
  protected width = 1;
  protected heightPx = 1;
  protected recoveries = 0;
  protected raf = 0;
  protected stopped = false;
  protected readonly opts: StreetSimOptions;
  private frames = 0;
  private stepsInWindow = 0;
  private windowStart = performance.now();
  protected stepsPerSecond = 0;
  protected fps = 0;

  constructor(opts: StreetSimOptions) {
    this.opts = opts;
    this.aspect = opts.aspect;
    this.layers = opts.layers;
    this.colors = opts.colors;
  }

  setLayers(layers: Layers): void {
    this.layers = layers;
  }

  protected countFrame(steps: number): void {
    this.frames += 1;
    this.stepsInWindow += steps;
    const now = performance.now();
    if (now - this.windowStart >= 1000) {
      const dt = (now - this.windowStart) / 1000;
      this.fps = this.frames / dt;
      this.stepsPerSecond = this.stepsInWindow / dt;
      this.frames = 0;
      this.stepsInWindow = 0;
      this.windowStart = now;
      this.report();
    }
  }

  protected abstract report(): void;

  protected stats(engine: Engine, time: number, note: EngineNote): SimStats {
    const g = this.geometry;
    const params = canyonParams(g, this.flow);
    return {
      engine,
      height: g.height,
      aspect: this.aspect,
      cells: canyonNx(g) * g.top,
      reynolds: this.flow.reynolds,
      uRef: this.flow.uRef,
      tau0: params.tau0,
      smagorinsky: this.flow.smagorinsky,
      stepsPerSecond: this.stepsPerSecond,
      fps: this.fps,
      time,
      recoveries: this.recoveries,
      note,
    };
  }
}

class GpuStreetSim extends BaseSim implements StreetSim {
  readonly engine = 'gpu' as const;
  private readonly device: GPUDevice;
  private readonly renderer: GpuRenderer;
  private solver!: GpuSolver;
  private substeps = 12;
  private lastFrame = performance.now();
  private frameMs = 16;
  private checking = false;
  private framesSinceCheck = 0;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, opts: StreetSimOptions) {
    super(opts);
    this.device = device;
    this.renderer = new GpuRenderer(device, canvas);
    this.build();
    void device.lost.then((info) => {
      if (this.stopped) return;
      console.warn('WebGPU device lost:', info.message);
      this.stopped = true;
      this.opts.onFallback?.('engineNote.gpuLost');
    });
    this.loop();
  }

  private build(): void {
    this.solver?.destroy();
    this.geometry = canyonGeometry(HEIGHT.gpu, this.aspect);
    this.view = streetView(this.geometry);
    const domain = canyonDomain(this.geometry);
    this.solver = new GpuSolver(this.device, domain, canyonParams(this.geometry, this.flow));
    // Starting from rest would send a pressure pulse through the domain (cases.uniform_start).
    const start = uniformStart(this.flow.uRef, domain.solid);
    this.solver.setState(start.rho, start.ux, start.uy);
    this.solver.saveCheckpoint();
    this.renderer.attach(this.solver, this.width, this.heightPx);
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.build();
  }

  setColors(colors: SimColors): void {
    this.colors = colors;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.heightPx = height;
    this.renderer.attach(this.solver, width, height);
  }

  private loop = (): void => {
    if (this.stopped) return;
    const now = performance.now();
    this.frameMs = 0.9 * this.frameMs + 0.1 * (now - this.lastFrame);
    this.lastFrame = now;
    // Keep the frame rate above 30 fps by trading lattice steps per frame.
    if (this.frameMs > 30 && this.substeps > 2) this.substeps -= 1;
    else if (this.frameMs < 18 && this.substeps < 40) this.substeps += 1;

    this.solver.step(this.substeps);
    this.renderer.draw(
      this.view,
      this.flow.uRef,
      this.substeps,
      this.layers,
      this.colors,
      this.width,
      this.heightPx,
    );
    this.countFrame(this.substeps);
    this.framesSinceCheck += 1;
    if (this.framesSinceCheck >= 90 && !this.checking) {
      this.framesSinceCheck = 0;
      void this.healthCheck();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private async healthCheck(): Promise<void> {
    this.checking = true;
    try {
      const f = await this.solver.readFields();
      let maxSpeed = 0;
      for (let k = 0; k < f.length; k += 4) {
        const s = Math.hypot(f[k + 1]!, f[k + 2]!);
        if (!(s <= maxSpeed)) maxSpeed = s;
      }
      if (isHealthy(maxSpeed)) {
        this.solver.saveCheckpoint();
      } else {
        this.solver.restoreCheckpoint();
        this.flow = lowerTimeStep(this.flow, this.geometry.height).flow;
        this.solver.setParams(canyonParams(this.geometry, this.flow));
        this.recoveries += 1;
        this.report();
      }
    } finally {
      this.checking = false;
    }
  }

  protected report(): void {
    this.opts.onStats(this.stats('gpu', this.solver.time, 'engineNote.gpu'));
  }

  destroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.solver.destroy();
    this.renderer.destroy();
    this.device.destroy();
  }
}

class CpuStreetSim extends BaseSim implements StreetSim {
  readonly engine = 'cpu' as const;
  private readonly worker: Worker;
  private readonly renderer: CanvasRenderer;
  private particles!: Particles;
  private solid!: Uint8Array;
  private time = 0;
  private readonly note: EngineNote;
  private waiting = false;

  constructor(canvas: HTMLCanvasElement, opts: StreetSimOptions, note: EngineNote) {
    super(opts);
    this.note = note;
    this.renderer = new CanvasRenderer(canvas, opts.colors);
    this.worker = new Worker(new URL('./cpu/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onFrame(ev.data);
    this.build();
    this.requestFrame();
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private build(): void {
    this.geometry = canyonGeometry(HEIGHT.cpu, this.aspect);
    this.view = streetView(this.geometry);
    const domain = canyonDomain(this.geometry);
    this.solid = domain.solid;
    const start = uniformStart(this.flow.uRef, domain.solid);
    this.send({
      type: 'init',
      domain,
      params: canyonParams(this.geometry, this.flow),
      initial: { ux: start.ux, uy: start.uy },
    });
    const solid = solidAt(this.geometry, domain.solid);
    if (this.particles) this.particles.setView(this.view, solid);
    else this.particles = new Particles(900, this.view, solid, 11);
    this.time = 0;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.build();
  }

  setColors(colors: SimColors): void {
    this.colors = colors;
    this.renderer.setColors(colors);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.heightPx = height;
    this.renderer.resize(width, height);
  }

  private requestFrame(): void {
    if (this.stopped || this.waiting) return;
    this.waiting = true;
    this.send({ type: 'run', budgetMs: 14, maxSteps: 400 });
  }

  private onFrame(msg: FromWorker): void {
    this.waiting = false;
    if (this.stopped) return;
    if (msg.type === 'error') {
      console.error('CPU solver error:', msg.message);
      return;
    }
    if (msg.recovered) {
      this.flow = lowerTimeStep(this.flow, this.geometry.height).flow;
      this.send({ type: 'params', params: canyonParams(this.geometry, this.flow) });
      this.recoveries += 1;
    }
    this.time = msg.time;
    const nx = canyonNx(this.geometry);
    this.particles.advect(msg.ux, msg.uy, nx, this.geometry.top, msg.steps);
    this.raf = requestAnimationFrame(() => {
      this.renderer.draw(
        this.view,
        nx,
        this.solid,
        msg.ux,
        msg.uy,
        this.flow.uRef,
        this.particles,
        this.layers,
      );
      this.countFrame(msg.steps);
      this.requestFrame();
    });
  }

  protected report(): void {
    this.opts.onStats(this.stats('cpu', this.time, this.note));
  }

  destroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.worker.terminate();
  }
}
