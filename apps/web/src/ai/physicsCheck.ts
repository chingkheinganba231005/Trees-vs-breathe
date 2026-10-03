/**
 * "Check with physics" (BRIEF.md 7.5): the live solver runs one design for the dataset's run
 * length, off the main thread and as fast as the CPU allows, and returns the same readouts the
 * dataset holds, so a prediction can be set beside a simulation of the same kind (D-036).
 */
import type { GreenElement } from '../sim/greenery';

/** The dataset's run (FULL in python/treesvb/dataset.py): spin-up and average, in steps. */
export const CHECK_RUN = { spinUp: 96_000, average: 96_000, every: 48 } as const;

/**
 * The run a check uses: CHECK_RUN, or a shorter one of `checkSteps` steps in all from the URL,
 * which the end-to-end tests use to finish in time (the result then says so by its length).
 */
export function checkRun(search = globalThis.location?.search ?? '') {
  const total = Number(new URLSearchParams(search).get('checkSteps'));
  if (!(total > 0)) return CHECK_RUN;
  const half = Math.max(
    CHECK_RUN.every * 2,
    Math.round(total / 2 / CHECK_RUN.every) * CHECK_RUN.every,
  );
  return { spinUp: half, average: half, every: CHECK_RUN.every };
}

export interface CheckRequest {
  aspect: number;
  elements: GreenElement[];
  spinUp: number;
  average: number;
  every: number;
}

export interface CheckResult {
  /** Mean c+ on pavements A and B, over each half of the averaging window. */
  exposure: [{ A: number; B: number }, { A: number; B: number }];
  /** Mean wind on the pavements as a share of the inflow speed, per half. */
  wind: [{ A: number; B: number }, { A: number; B: number }];
  /** Share of the fumes released in each half that the street kept (dataset.FILLING). */
  retained: [number, number];
  healthy: boolean;
  seconds: number;
}

export type CheckMessage =
  | { type: 'progress'; steps: number; total: number }
  | { type: 'done'; result: CheckResult }
  | { type: 'error'; message: string };

/** A run is still filling if its street kept more than this share in the second half. */
export const FILLING = 0.1;

export function meanOfHalves(h: [{ A: number; B: number }, { A: number; B: number }]) {
  return { A: 0.5 * (h[0].A + h[1].A), B: 0.5 * (h[0].B + h[1].B) };
}

/** Run a check in a worker; resolves with the result, rejects on error or abort. */
export function runCheck(
  req: CheckRequest,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CheckResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./physicsWorker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', stop, { once: true });
    worker.onmessage = (ev: MessageEvent<CheckMessage>) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.steps, m.total);
      else {
        signal?.removeEventListener('abort', stop);
        worker.terminate();
        if (m.type === 'done') resolve(m.result);
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(req);
  });
}
