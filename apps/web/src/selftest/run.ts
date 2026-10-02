import { CpuSolver } from '../sim/cpu/solver';
import { concentrationError, goldenDomain, goldenParams, velocityError } from '../sim/golden';
import { Q } from '../sim/lattice';
import type { GoldenCase } from '../sim/golden';
import { GpuSolver } from '../sim/gpu/solver';

export interface SelfTestRow {
  name: string;
  description: string;
  cells: number;
  steps: number;
  cpuError: number;
  cpuMs: number;
  gpuError: number | null;
  gpuMs: number | null;
}

export interface SelfTestResult {
  adapter: string;
  userAgent: string;
  rows: SelfTestRow[];
  /**
   * Largest error across CPU and GPU: velocity as a fraction of each case's reference speed and,
   * for cases with a tracer, concentration as a fraction of the peak reference concentration.
   */
  worst: number;
  threshold: number;
  passed: boolean;
}

export const THRESHOLD = 0.005;

function start(s: CpuSolver | GpuSolver, g: GoldenCase): void {
  if (g.initial) {
    s.setState(new Float64Array(g.initial.ux.length).fill(1), g.initial.ux, g.initial.uy);
  }
}

/** Run every golden case on the CPU solver and, when a device is given, the GPU solver. */
export async function runSelfTest(
  goldens: GoldenCase[],
  device: GPUDevice | null,
  adapter: string,
): Promise<SelfTestResult> {
  const rows: SelfTestRow[] = [];
  for (const g of goldens) {
    const domain = goldenDomain(g);
    const params = goldenParams(g);

    const cpu = new CpuSolver(domain, params);
    start(cpu, g);
    let t = performance.now();
    cpu.step(g.steps);
    const cpuMs = performance.now() - t;
    const cf = cpu.fields();
    const cpuError = Math.max(
      velocityError(g, cf.ux, cf.uy),
      concentrationError(g, cpu.concentration()),
    );

    let gpuError: number | null = null;
    let gpuMs: number | null = null;
    if (device) {
      const gpu = new GpuSolver(device, domain, params);
      start(gpu, g);
      t = performance.now();
      gpu.step(g.steps);
      const f = await gpu.readPopulations();
      gpuMs = performance.now() - t;
      // Evaluate the GPU state with the CPU's streaming, exactly as the reference does.
      const probe = new CpuSolver(domain, params);
      const n = domain.nx * domain.ny;
      probe.fPost.set(f.subarray(0, Q * n));
      probe.gPost?.set(f.subarray(Q * n, (Q + 5) * n));
      const gf = probe.fields();
      gpuError = Math.max(
        velocityError(g, gf.ux, gf.uy),
        concentrationError(g, probe.concentration()),
      );
      gpu.destroy();
    }
    rows.push({
      name: g.name,
      description: g.description,
      cells: domain.nx * domain.ny,
      steps: g.steps,
      cpuError,
      cpuMs,
      gpuError,
      gpuMs,
    });
  }
  const worst = Math.max(...rows.flatMap((r) => [r.cpuError, r.gpuError ?? 0]));
  return {
    adapter,
    userAgent: navigator.userAgent,
    rows,
    worst,
    threshold: THRESHOLD,
    passed: worst < THRESHOLD && (device === null || rows.every((r) => r.gpuError !== null)),
  };
}
