import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playbackSpeed, StepClock } from '../../apps/web/src/sim/clock';

/** Drives a clock at a fixed frame interval; `capacity` is the most steps a frame can run. */
function drive(
  clock: StepClock,
  frames: number,
  frameMs: number,
  stepsPerUnit: number,
  capacity = Infinity,
) {
  let total = 0;
  for (let i = 0; i <= frames; i++) {
    const now = i * frameMs;
    const steps = Math.min(clock.due(now, stepsPerUnit), capacity);
    clock.ran(steps, now);
    total += steps;
  }
  return total;
}

describe('StepClock', () => {
  it('runs the same simulated time per second at any frame rate', () => {
    // 480 steps per flow-through time, one flow-through per second, for two seconds.
    const at60 = drive(new StepClock(1), 120, 1000 / 60, 480);
    const at144 = drive(new StepClock(1), 288, 1000 / 144, 480);
    const at30 = drive(new StepClock(1), 60, 1000 / 30, 480);
    for (const n of [at60, at144, at30]) expect(Math.abs(n - 960)).toBeLessThanOrEqual(1);
  });

  it('scales with the grid, so the same simulated time on any grid', () => {
    expect(Math.abs(drive(new StepClock(1), 120, 1000 / 60, 960) - 1920)).toBeLessThanOrEqual(1);
  });

  it('reports a device that keeps up as full speed', () => {
    const clock = new StepClock(1);
    drive(clock, 180, 1000 / 60, 480);
    expect(clock.achieved).toBe(1);
  });

  it('lets a slow device fall behind without a backlog, and says by how much', () => {
    const clock = new StepClock(1);
    // Needs 8 steps a frame at 60 Hz but can run only 4.
    const total = drive(clock, 300, 1000 / 60, 480, 4);
    expect(clock.achieved).toBeGreaterThan(0.45);
    expect(clock.achieved).toBeLessThan(0.55);
    // Once the device can keep up again it does not race to repay the lost time.
    const after = drive(clock, 60, 1000 / 60, 480);
    expect(total).toBe(4 * 300);
    expect(after).toBeLessThan(480 + 0.25 * 480 + 1);
  });

  it('counts very slow frames as falling behind', () => {
    const slow = new StepClock(1);
    for (let i = 0; i <= 10; i++) slow.ran(slow.due(i * 300, 480), i * 300);
    expect(slow.achieved).toBeLessThan(0.5);
  });

  it('starts afresh after a reset, without a burst for the time away', () => {
    const clock = new StepClock(1);
    clock.ran(clock.due(0, 480), 0);
    clock.reset();
    expect(clock.due(60_000, 480)).toBe(0);
    // One frame at 60 Hz earns eight steps, give or take the fraction carried over.
    expect(Math.abs(clock.due(60_000 + 1000 / 60, 480) - 8)).toBeLessThanOrEqual(1);
  });

  it('reads the speed from the address, defaulting to normal', () => {
    expect(playbackSpeed('')).toBe(1);
    expect(playbackSpeed('?speed=4')).toBe(4);
    expect(playbackSpeed('?speed=-1')).toBe(1);
  });
});

describe('live grid', () => {
  it('reads calibration and regime results computed on the grid every engine runs', async () => {
    const { HEIGHT, liveSchmidt, checkedAspectMax } =
      await import('../../apps/web/src/sim/streetSim');
    const read = (p: string) =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, '../../results', p), 'utf8'));
    expect(read('trees/calibration.json').height_cells).toBe(HEIGHT);
    for (const row of read('street/regimes.json').rows) expect(row.height_cells).toBe(HEIGHT);
    expect(liveSchmidt()).toBe(read('trees/calibration.json').schmidt);
    expect(checkedAspectMax()).toBe(
      Math.max(...read('street/regimes.json').rows.map((r: { aspect: number }) => r.aspect)),
    );
  });
});
