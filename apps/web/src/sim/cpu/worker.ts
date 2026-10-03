/// <reference lib="webworker" />
import { StepClock } from '../clock';
import { isHealthy } from '../guard';
import { Q } from '../lattice';
import type { FromWorker, ToWorker } from './protocol';
import { CpuSolver } from './solver';

// Runs the CPU solver off the main thread. It steps continuously on its own copy of the playback
// clock, in short slices so frame requests are answered promptly, rather than only while the
// page waits for a frame: on a slow CPU that keeps the core busy and the street closer to normal
// speed. It keeps a copy of the last healthy state so a blow-up costs a few seconds of flow, not
// the demo.

const CHECKPOINT_EVERY = 2000;
/** Longest stretch of stepping before the worker looks at its messages again. */
const SLICE_MS = 8;
/** Without a frame request for this long the page is hidden or gone: stop stepping. */
const PAUSE_MS = 1000;

let solver: CpuSolver | null = null;
let checkpoint: Float32Array | null = null;
let checkpointTracer: Float32Array | null = null;
let checkpointTime = 0;
// Running mean of the concentration: m += b (c - m) per slice, b = 1 - (1 - 1/T)^steps.
let meanC: Float32Array | null = null;
let conc: Float32Array | null = null;
let meanSteps = 0;
let averaging = 10_000;
let clock = new StepClock(1);
let stepsPerFlowThrough = 480;
let sinceFrame = 0;
let lastRequest = 0;
/** Not stepping: no frame was requested yet, or none for PAUSE_MS. */
let paused = true;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

// A message to ourselves runs the next slice as soon as pending messages are handled; setTimeout
// would add a delay of several milliseconds once calls nest.
const channel = new MessageChannel();
let scheduled = false;
function schedule(delayMs: number): void {
  if (scheduled) return;
  scheduled = true;
  if (delayMs > 0) setTimeout(slice, delayMs);
  else channel.port2.postMessage(null);
}
channel.port1.onmessage = () => slice();

function slice(): void {
  scheduled = false;
  if (!solver) return;
  const start = performance.now();
  if (start - lastRequest > PAUSE_MS) {
    paused = true;
    return;
  }
  const due = clock.due(start, stepsPerFlowThrough);
  let ran = 0;
  while (ran + 4 <= due && performance.now() - start < SLICE_MS) {
    solver.step(4);
    ran += 4;
  }
  clock.ran(ran, performance.now());
  if (ran > 0 && meanC) {
    conc = solver.concentration(conc ?? undefined);
    const b = 1 - Math.pow(1 - 1 / averaging, ran);
    for (let k = 0; k < conc.length; k++) meanC[k] = meanC[k]! + b * (conc[k]! - meanC[k]!);
    meanSteps += ran;
    sinceFrame += ran;
  }
  // At once while steps are owed; otherwise when the next four fall due.
  const owed = due - ran;
  schedule(owed >= 4 ? 0 : ((4 - owed) / (clock.rate * stepsPerFlowThrough)) * 1000);
}

function frame(): void {
  if (!solver) return;
  const fields = solver.fields();
  let maxSpeed = 0;
  for (let k = 0; k < fields.ux.length; k++) {
    const s = Math.hypot(fields.ux[k]!, fields.uy[k]!);
    if (!(s <= maxSpeed)) maxSpeed = s;
  }
  let recovered = false;
  if (!isHealthy(maxSpeed)) {
    if (checkpoint) solver.fPost.set(checkpoint);
    if (checkpointTracer) solver.gPost?.set(checkpointTracer);
    solver.time = checkpointTime;
    recovered = true;
  } else if (solver.time - checkpointTime >= CHECKPOINT_EVERY) {
    checkpoint = solver.fPost.slice(0, Q * solver.n);
    checkpointTracer = solver.gPost?.slice() ?? null;
    checkpointTime = solver.time;
  }
  const meanOut = meanC ? meanC.slice() : new Float32Array(solver.n);
  post(
    {
      type: 'frame',
      ux: fields.ux,
      uy: fields.uy,
      steps: sinceFrame,
      time: solver.time,
      maxSpeed,
      recovered,
      conc: meanOut,
      meanSteps,
      achieved: clock.achieved,
    },
    [fields.ux.buffer, fields.uy.buffer, meanOut.buffer],
  );
  sinceFrame = 0;
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      solver = new CpuSolver(msg.domain, msg.params);
      const n = msg.domain.nx * msg.domain.ny;
      solver.setState(new Float32Array(n).fill(1), msg.initial.ux, msg.initial.uy);
      checkpoint = solver.fPost.slice();
      checkpointTracer = solver.gPost?.slice() ?? null;
      checkpointTime = 0;
      meanC = new Float32Array(n);
      conc = null;
      meanSteps = 0;
      sinceFrame = 0;
      clock.reset();
      return;
    }
    if (msg.type === 'averaging') {
      averaging = msg.steps;
      return;
    }
    if (msg.type === 'clock') {
      if (msg.rate !== clock.rate) clock = new StepClock(msg.rate);
      stepsPerFlowThrough = msg.stepsPerFlowThrough;
      return;
    }
    if (!solver) return;
    if (msg.type === 'params') {
      solver.setParams(msg.params);
      return;
    }
    if (msg.type === 'greenery') {
      solver.setDrag(msg.drag);
      meanC?.fill(0);
      meanSteps = 0;
      return;
    }
    // A frame request: answer, and keep stepping (or start again after a pause).
    lastRequest = performance.now();
    frame();
    if (paused) {
      paused = false;
      clock.reset();
      schedule(0);
    }
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
