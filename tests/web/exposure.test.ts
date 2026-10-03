import { describe, expect, it } from 'vitest';
import { addReading, compare, EMPTY_EXPOSURE, KEEP } from '../../apps/web/src/sim/exposure';

const settled = (A: number, B: number, greenCount: number) => ({
  exposure: { A, B },
  meanSteps: 100,
  settleSteps: 50,
  greenCount,
});

describe('exposure against the tree-free street', () => {
  it('ignores readings that have not settled', () => {
    const s = addReading(
      EMPTY_EXPOSURE,
      { exposure: { A: 1, B: 1 }, meanSteps: 10, settleSteps: 50, greenCount: 0 },
      '1.0',
      'none',
    );
    expect(s.baselines['1.0']).toBeUndefined();
  });

  it('compares greenery with the baseline of the same street shape', () => {
    let s = addReading(EMPTY_EXPOSURE, settled(20, 10, 0), '1.0', 'none');
    s = addReading(s, settled(30, 5, 1), '1.0', 'trees');
    s = addReading(s, settled(32, 6, 1), '1.0', 'trees');
    const c = compare(s, '1.0')!;
    expect(c.A[0]).toBeCloseTo(0.5, 12);
    expect(c.A[1]).toBeCloseTo(0.6, 12);
    expect(c.B[0]).toBeCloseTo(-0.5, 12);
    expect(compare(s, '2.0')).toBeNull();
  });

  it('starts the greenery readings again when the design changes', () => {
    let s = addReading(EMPTY_EXPOSURE, settled(20, 10, 0), '1.0', 'none');
    s = addReading(s, settled(30, 5, 1), '1.0', 'trees');
    s = addReading(s, settled(10, 5, 1), '1.0', 'hedge');
    expect(s.green).toHaveLength(1);
    expect(compare(s, '1.0')!.A[0]).toBeCloseTo(-0.5, 12);
  });

  it(`keeps the last ${KEEP} readings`, () => {
    let s = EMPTY_EXPOSURE;
    for (let i = 0; i < 9; i++) s = addReading(s, settled(i, i, 0), '1.0', 'none');
    expect(s.baselines['1.0']).toHaveLength(KEEP);
    expect(s.baselines['1.0']![0]!.A).toBe(9 - KEEP);
  });
});
