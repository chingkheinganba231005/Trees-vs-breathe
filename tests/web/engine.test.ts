import { describe, expect, it } from 'vitest';
import { browserHasWebGPU, parseEngineParam, resolveEngine } from '../../apps/web/src/sim/engine';

describe('engine selection', () => {
  it.each([
    ['?engine=gpu', 'gpu'],
    ['?engine=cpu', 'cpu'],
    ['?engine=fast', 'auto'],
    ['', 'auto'],
  ] as const)('%s -> %s', (search, choice) => {
    expect(parseEngineParam(search)).toBe(choice);
  });

  it('detects navigator.gpu', () => {
    expect(browserHasWebGPU({ gpu: {} })).toBe(true);
    expect(browserHasWebGPU({})).toBe(false);
    expect(browserHasWebGPU(undefined)).toBe(false);
  });

  it('falls back to the CPU worker when WebGPU is missing', () => {
    expect(resolveEngine('auto', true)).toBe('gpu');
    expect(resolveEngine('auto', false)).toBe('cpu');
    expect(resolveEngine('gpu', false)).toBe('cpu');
    expect(resolveEngine('cpu', true)).toBe('cpu');
  });
});
