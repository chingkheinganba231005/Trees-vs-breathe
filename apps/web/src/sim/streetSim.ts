import { result } from '../content/results';
import type { CalibrationResult } from '../content/results';
import type { Layers } from './cpu/canvasRenderer';
import type { SolverParams } from './cpu/solver';
import type { GreenElement } from './greenery';
import { dragField, laneOffsets, lineSources, pavementExposure, SOURCE_TOTAL } from './greenery';
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

/**
 * Turbulent Schmidt number of the fumes: the value calibrated on CODASC when
 * results/trees/calibration.json exists, otherwise the 1.0 of Gromke (2008, p. 87).
 */
export function liveSchmidt(): number {
  return result<CalibrationResult>('trees/calibration.json')?.schmidt ?? 1.0;
}

/**
 * Turnovers of the street vortex in the running mean's time constant: 3, or the value of the
 * `averaging` URL parameter. A short window gives a rougher mean; the end-to-end tests use one to
 * finish in time.
 */
export function averagingTurnovers(search = globalThis.location?.search ?? ''): number {
  const v = Number(new URLSearchParams(search).get('averaging'));
  return v > 0 ? v : 3;
}

/**
 * Time constant of the running means, in steps: averagingTurnovers() turnovers of the street
 * vortex, whose turnover time is about (W + H) / (0.25 u_H) (Gromke 2008, Eq. 5.8).
 */
export function averagingSteps(
  g: CanyonGeometry,
  uRef: number,
  turnovers = averagingTurnovers(),
): number {
  return Math.round((turnovers * (g.width + g.height)) / (0.25 * uRef));
}

/** Pavement exposure counts as settled after this many averaging time constants. */
export const SETTLE_CONSTANTS = 2;

/** Solver parameters for the live street: flow, greenery drag and the traffic fumes. */
export function liveParams(
  g: CanyonGeometry,
  solid: Uint8Array,
  flow: FlowSettings,
  greenery: GreenElement[],
): SolverParams {
  const base = canyonParams(g, flow);
  return {
    ...base,
    drag: dragField(g, solid, greenery),
    tracer: {
      source: lineSources(g, laneOffsets(g.width / g.height), SOURCE_TOTAL),
      // Molecular diffusivity equal to the molecular viscosity (docs/assumptions.md A-009).
      diffusivity: (base.tau0 - 0.5) / 3,
      schmidt: liveSchmidt(),
    },
  };
}

/** Running-mean c+ on the two pavements, corrected for the mean's start from zero. */
function exposureFrom(
  g: CanyonGeometry,
  data: ArrayLike<number>,
  stride: number,
  offset: number,
  uRef: number,
  meanSteps: number,
  averaging: number,
): { A: number; B: number } | null {
  if (meanSteps <= 0) return null;
  const w = 1 - Math.pow(1 - 1 / averaging, meanSteps);
  const e = pavementExposure(g, data, stride, offset, uRef);
  return { A: e.A / w, B: e.B / w };
}

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
  /** Running-mean c+ on the leeward (A) and windward (B) pavements; null before any average. */
  exposure: { A: number; B: number } | null;
  /** Steps averaged since the street or its greenery last changed. */
  meanSteps: number;
  /** Steps after which the exposure counts as settled. */
  settleSteps: number;
  /** Number of greenery elements in the street. */
  greenCount: number;
}

export interface StreetSimOptions {
  aspect: number;
  greenery: GreenElement[];
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
  setGreenery(greenery: GreenElement[]): void;
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
  protected greenery: GreenElement[];
  /** Greenery waiting for the next frame: a dragged slider sends many more changes than frames. */
  private pendingGreenery: GreenElement[] | null = null;
  /** Counts restarts of the running means, so a read begun before one is not used after it. */
  protected generation = 0;
  protected solid!: Uint8Array;
  protected averaging = 10_000;
  protected meanSteps = 0;
  protected exposure: { A: number; B: number } | null = null;

  constructor(opts: StreetSimOptions) {
    this.opts = opts;
    this.aspect = opts.aspect;
    this.layers = opts.layers;
    this.colors = opts.colors;
    this.greenery = opts.greenery;
  }

  protected params(): SolverParams {
    return liveParams(this.geometry, this.solid, this.flow, this.greenery);
  }

  /** Converts the running-mean concentration to c+, corrected for the mean's start. */
  protected cScale(): number {
    if (this.meanSteps <= 0) return 0;
    const w = 1 - Math.pow(1 - 1 / this.averaging, this.meanSteps);
    return (this.flow.uRef * this.geometry.height) / SOURCE_TOTAL / w;
  }

  setLayers(layers: Layers): void {
    this.layers = layers;
  }

  setGreenery(greenery: GreenElement[]): void {
    this.pendingGreenery = greenery;
  }

  /** Applies the latest greenery, if any arrived since the last frame; called once per frame. */
  protected takeGreenery(): void {
    const greenery = this.pendingGreenery;
    if (!greenery) return;
    this.pendingGreenery = null;
    this.greenery = greenery;
    this.generation += 1;
    this.meanSteps = 0;
    this.exposure = null;
    this.applyDrag(dragField(this.geometry, this.solid, greenery));
    this.report();
  }

  /** Gives the solver a new drag field and restarts its running means. */
  protected abstract applyDrag(drag: Float32Array): void;

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
      exposure: this.exposure,
      meanSteps: this.meanSteps,
      settleSteps: SETTLE_CONSTANTS * this.averaging,
      greenCount: this.greenery.length,
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
    this.solid = domain.solid;
    this.solver = new GpuSolver(this.device, domain, this.params());
    this.averaging = averagingSteps(this.geometry, this.flow.uRef);
    this.solver.emaAlpha = 1 / this.averaging;
    this.solver.writeParams();
    this.meanSteps = 0;
    this.generation += 1;
    this.exposure = null;
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

  protected applyDrag(drag: Float32Array): void {
    this.solver.setDrag(drag);
    this.solver.clearMean();
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

    this.takeGreenery();
    this.solver.step(this.substeps);
    this.meanSteps += this.substeps;
    this.renderer.draw(
      this.view,
      this.flow.uRef,
      this.substeps,
      this.layers,
      this.colors,
      this.width,
      this.heightPx,
      this.cScale(),
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
    const generation = this.generation;
    try {
      const f = await this.solver.readFields();
      let maxSpeed = 0;
      for (let k = 0; k < f.length; k += 4) {
        const s = Math.hypot(f[k + 1]!, f[k + 2]!);
        if (!(s <= maxSpeed)) maxSpeed = s;
      }
      if (isHealthy(maxSpeed)) {
        this.solver.saveCheckpoint();
        const mean = await this.solver.readMean();
        // The means restarted while the copy was in flight; it belongs to the old design.
        if (generation !== this.generation) return;
        this.exposure = exposureFrom(
          this.geometry,
          mean,
          4,
          3,
          this.flow.uRef,
          this.meanSteps,
          this.averaging,
        );
      } else {
        this.solver.restoreCheckpoint();
        this.flow = lowerTimeStep(this.flow, this.geometry.height).flow;
        this.solver.setParams(this.params());
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
  private drag: Float32Array | null = null;
  private conc: Float32Array | null = null;
  private framesSinceExposure = 0;
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
    const params = this.params();
    this.drag = Float32Array.from(params.drag ?? []);
    this.averaging = averagingSteps(this.geometry, this.flow.uRef);
    this.send({ type: 'averaging', steps: this.averaging });
    this.send({
      type: 'init',
      domain,
      params,
      initial: { ux: start.ux, uy: start.uy },
    });
    this.meanSteps = 0;
    this.exposure = null;
    this.conc = null;
    const solid = solidAt(this.geometry, domain.solid);
    if (this.particles) this.particles.setView(this.view, solid);
    else this.particles = new Particles(900, this.view, solid, 11);
    this.time = 0;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.build();
  }

  protected applyDrag(drag: Float32Array): void {
    this.drag = drag;
    const copy = drag.slice();
    // The worker restarts its mean; the last fumes frame stays on screen until the next arrives.
    this.send({ type: 'greenery', drag: copy }, [copy.buffer]);
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
    this.takeGreenery();
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
      this.send({ type: 'params', params: this.params() });
      this.recoveries += 1;
    }
    this.time = msg.time;
    this.conc = msg.conc;
    this.meanSteps = msg.meanSteps;
    this.framesSinceExposure += 1;
    if (this.framesSinceExposure >= 30) {
      this.framesSinceExposure = 0;
      this.exposure = exposureFrom(
        this.geometry,
        msg.conc,
        1,
        0,
        this.flow.uRef,
        msg.meanSteps,
        this.averaging,
      );
    }
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
        { conc: this.conc, cScale: this.cScale(), drag: this.drag },
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
