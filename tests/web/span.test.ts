import { describe, expect, it } from 'vitest';
import { updateStrided } from '../../apps/web/src/sim/span';

describe('updateStrided', () => {
  it('writes every stride-th slot and reports the changed node span', () => {
    const into = new Float32Array([0, 9, 0, 9, 0, 9, 0, 9]);
    expect(updateStrided(into, [0, 0.1, 0.2, 0], 2)).toEqual([1, 2]);
    expect(Array.from(into)).toEqual([0, 9, Math.fround(0.1), 9, Math.fround(0.2), 9, 0, 9]);
  });

  it('reports nothing when the field is unchanged, including float32 rounding', () => {
    const into = new Float32Array(6);
    updateStrided(into, [0.1, 0.3, 0.7], 2);
    expect(updateStrided(into, [0.1, 0.3, 0.7], 2)).toBeNull();
  });

  it('treats a null field as all zero and leaves the other slots alone', () => {
    const into = new Float32Array([1, 5, 0, 5, 2, 5]);
    expect(updateStrided(into, null, 2)).toEqual([0, 2]);
    expect(Array.from(into)).toEqual([0, 5, 0, 5, 0, 5]);
  });
});
