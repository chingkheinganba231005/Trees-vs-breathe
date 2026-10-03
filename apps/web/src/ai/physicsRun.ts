import { CpuSolver } from '../sim/cpu/solver';
import { pavementExposure, pavementSpeed } from '../sim/greenery';
import { canyonDomain, canyonGeometry, canyonNx, streetColumns, uniformStart } from '../sim/street';
import { LIVE_FLOW, liveParams } from '../sim/streetSim';
import { AI_GRID } from './designs';
import type { CheckRequest, CheckResult } from './physicsCheck';

/**
 * One design on the live grid with the live settings: spin-up, then the average over two halves,
 * sampled every `every` steps; `onProgress` gets the steps done and the total.
 */
export function runPhysics(
  req: CheckRequest,
  onProgress: (steps: number, total: number) => void = () => {},
): CheckResult {
  const t0 = performance.now();
  const g = canyonGeometry(AI_GRID, req.aspect);
  const domain = canyonDomain(g);
  const params = liveParams(g, domain.solid, LIVE_FLOW, req.elements);
  const solver = new CpuSolver(domain, params);
  const init = uniformStart(LIVE_FLOW.uRef, domain.solid);
  solver.setState(init.rho, init.ux, init.uy);
  const total = req.spinUp + req.average;
  const nx = canyonNx(g);
  const [x0, x1] = streetColumns(g);
  const streetMass = () => {
    const g5 = solver.gPost!;
    let m = 0;
    for (let y = 0; y < g.height; y++) {
      for (let x = x0; x < x1; x++) {
        const k = y * nx + x;
        for (let i = 0; i < 5; i++) m += g5[i * solver.n + k]!;
      }
    }
    return m;
  };
  const advance = (n: number) => {
    for (let done = 0; done < n;) {
      const s = Math.min(2000, n - done);
      solver.step(s);
      done += s;
      onProgress(solver.time, total);
    }
  };
  advance(req.spinUp);
  const half = Math.floor(req.average / req.every / 2);
  const masses = [streetMass()];
  const exposure: CheckResult['exposure'] = [
    { A: 0, B: 0 },
    { A: 0, B: 0 },
  ];
  const wind: CheckResult['wind'] = [
    { A: 0, B: 0 },
    { A: 0, B: 0 },
  ];
  let healthy = true;
  for (let h = 0; h < 2; h++) {
    for (let k = 0; k < half; k++) {
      solver.step(req.every);
      const c = pavementExposure(g, solver.concentration(), 1, 0, LIVE_FLOW.uRef);
      const f = solver.fields();
      const v = pavementSpeed(g, f.ux, 1, 0, 0, LIVE_FLOW.uRef, f.uy);
      exposure[h]!.A += c.A / half;
      exposure[h]!.B += c.B / half;
      wind[h]!.A += v.A / half;
      wind[h]!.B += v.B / half;
      if (k % 40 === 0) onProgress(solver.time, total);
    }
    masses.push(streetMass());
    healthy &&= [exposure[h]!.A, exposure[h]!.B].every(Number.isFinite);
  }
  onProgress(solver.time, total);
  const released = Array.from(params.tracer!.source).reduce((s, v) => s + v, 0) * half * req.every;
  return {
    exposure,
    wind,
    retained: [(masses[1]! - masses[0]!) / released, (masses[2]! - masses[1]!) / released],
    healthy,
    seconds: (performance.now() - t0) / 1000,
  };
}
