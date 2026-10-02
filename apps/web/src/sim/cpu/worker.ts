/// <reference lib="webworker" />
import { isHealthy } from '../guard';
import { Q } from '../lattice';
import type { FromWorker, ToWorker } from './protocol';
import { CpuSolver } from './solver';

// Runs the CPU solver off the main thread. Keeps a copy of the last healthy state so a blow-up
// costs a few seconds of flow, not the demo.

const CHECKPOINT_EVERY = 2000;
let solver: CpuSolver | null = null;
let checkpoint: Float32Array | null = null;
let checkpointTime = 0;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      solver = new CpuSolver(msg.domain, msg.params);
      const n = msg.domain.nx * msg.domain.ny;
      solver.setState(new Float32Array(n).fill(1), msg.initial.ux, msg.initial.uy);
      checkpoint = solver.fPost.slice();
      checkpointTime = 0;
      return;
    }
    if (!solver) return;
    if (msg.type === 'params') {
      solver.setParams(msg.params);
      return;
    }
    const start = performance.now();
    let steps = 0;
    while (steps < msg.maxSteps && performance.now() - start < msg.budgetMs) {
      solver.step(4);
      steps += 4;
    }
    const fields = solver.fields();
    let maxSpeed = 0;
    for (let k = 0; k < fields.ux.length; k++) {
      const s = Math.hypot(fields.ux[k]!, fields.uy[k]!);
      if (!(s <= maxSpeed)) maxSpeed = s;
    }
    let recovered = false;
    if (!isHealthy(maxSpeed)) {
      if (checkpoint) solver.fPost.set(checkpoint);
      solver.time = checkpointTime;
      recovered = true;
    } else if (solver.time - checkpointTime >= CHECKPOINT_EVERY) {
      checkpoint = solver.fPost.slice(0, Q * solver.n);
      checkpointTime = solver.time;
    }
    post(
      {
        type: 'frame',
        ux: fields.ux,
        uy: fields.uy,
        steps,
        time: solver.time,
        maxSpeed,
        recovered,
      },
      [fields.ux.buffer, fields.uy.buffer],
    );
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
