/// <reference lib="webworker" />
import type { CheckMessage, CheckRequest } from './physicsCheck';
import { runPhysics } from './physicsRun';

function post(m: CheckMessage) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
}

self.onmessage = (ev: MessageEvent<CheckRequest>) => {
  try {
    const result = runPhysics(ev.data, (steps, total) => post({ type: 'progress', steps, total }));
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
