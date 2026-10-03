/**
 * The surrogate in the browser (BRIEF.md 7.6): onnxruntime-web, loaded only when a screen asks
 * for it. WebGPU first where the browser has it, the wasm backend otherwise or if WebGPU fails;
 * `?ai=wasm` forces wasm (the end-to-end tests use it). The models are files in public/models,
 * written by colab/04_train_surrogate.ipynb.
 */
import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { FIELD_CHANNELS, FIELD_COLS, FIELD_ROWS } from './fieldInput';
import { FEATURES } from './features';
import type { GuardData } from './guard';

type Ort = typeof import('onnxruntime-web');
export type AiBackend = 'webgpu' | 'wasm';

export interface Surrogate {
  backend: AiBackend;
  guard: GuardData;
  /** Ensemble outputs for each design: members x [log ratio A, log ratio B, log wind A, B]. */
  scalar(features: Float32Array[]): Promise<number[][][]>;
  /** log(1 + c+) and wind speed over the street, FIELD_ROWS x FIELD_COLS each. */
  field(input: Float32Array): Promise<{ cplus: Float32Array; speed: Float32Array }>;
}

export const MEMBERS = 5;
const OUTPUTS = 4;

function modelUrl(name: string): string {
  return `${import.meta.env.BASE_URL}models/${name}`;
}

/** Whether the trained models are in the build (they arrive from Colab, not with the code). */
export async function modelsPresent(): Promise<boolean> {
  try {
    const r = await fetch(modelUrl('guard.json'), { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

async function loadOrt(preferWasm: boolean): Promise<{ ort: Ort; backend: AiBackend }> {
  if (!preferWasm && typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const ort = (await import('onnxruntime-web/webgpu')) as Ort;
      ort.env.wasm.numThreads = 1;
      return { ort, backend: 'webgpu' };
    } catch {
      // Fall through to wasm.
    }
  }
  const ort = (await import('onnxruntime-web/wasm')) as Ort;
  // Pages are not cross-origin isolated, so the wasm backend runs on one thread.
  ort.env.wasm.numThreads = 1;
  return { ort, backend: 'wasm' };
}

async function session(ort: Ort, name: string, backend: AiBackend): Promise<InferenceSession> {
  return ort.InferenceSession.create(modelUrl(name), { executionProviders: [backend] });
}

let loading: Promise<Surrogate> | null = null;

/** The surrogate, loaded once per page; rejects if the models are missing or will not run. */
export function loadSurrogate(preferWasm = false): Promise<Surrogate> {
  loading ??= (async () => {
    let { ort, backend } = await loadOrt(preferWasm);
    let scalarSession: InferenceSession;
    let fieldSession: InferenceSession;
    try {
      scalarSession = await session(ort, 'scalar.onnx', backend);
      fieldSession = await session(ort, 'field.onnx', backend);
    } catch (e) {
      if (backend === 'wasm') throw e;
      ({ ort, backend } = await loadOrt(true));
      scalarSession = await session(ort, 'scalar.onnx', backend);
      fieldSession = await session(ort, 'field.onnx', backend);
    }
    const guard = (await (await fetch(modelUrl('guard.json'))).json()) as GuardData;
    const T = ort.Tensor;
    return {
      backend,
      guard,
      async scalar(features) {
        const n = features.length;
        const data = new Float32Array(n * FEATURES.length);
        features.forEach((f, i) => data.set(f, i * FEATURES.length));
        const out = await scalarSession.run({
          features: new T('float32', data, [n, FEATURES.length]),
        });
        const y = (out.outputs as Tensor).data as Float32Array;
        return Array.from({ length: n }, (_, i) =>
          Array.from({ length: MEMBERS }, (_, m) =>
            Array.from(y.subarray((i * MEMBERS + m) * OUTPUTS, (i * MEMBERS + m + 1) * OUTPUTS)),
          ),
        );
      },
      async field(input) {
        const out = await fieldSession.run({
          design: new T('float32', input, [1, FIELD_CHANNELS, FIELD_ROWS, FIELD_COLS]),
        });
        const y = (out.fields as Tensor).data as Float32Array;
        const plane = FIELD_ROWS * FIELD_COLS;
        return { cplus: y.slice(0, plane), speed: y.slice(plane, 2 * plane) };
      },
    };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
