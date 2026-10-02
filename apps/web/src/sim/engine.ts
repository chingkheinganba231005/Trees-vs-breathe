// Which solver backend to run. `?engine=gpu|cpu` forces one (Playwright uses cpu);
// otherwise WebGPU is used when the browser exposes it. P1 adds an adapter probe,
// since navigator.gpu can exist while requestAdapter() still returns null.

export type EngineChoice = 'auto' | 'gpu' | 'cpu';
export type Engine = 'gpu' | 'cpu';

export function parseEngineParam(search: string): EngineChoice {
  const value = new URLSearchParams(search).get('engine');
  return value === 'gpu' || value === 'cpu' ? value : 'auto';
}

export function browserHasWebGPU(nav: object | undefined): boolean {
  return nav !== undefined && 'gpu' in nav && (nav as { gpu?: unknown }).gpu != null;
}

export function resolveEngine(choice: EngineChoice, webgpu: boolean): Engine {
  if (choice === 'cpu') return 'cpu';
  if (choice === 'gpu') return webgpu ? 'gpu' : 'cpu';
  return webgpu ? 'gpu' : 'cpu';
}
