/**
 * Playback clock shared by both engines, so the street runs at the same speed on every device.
 *
 * A lattice Boltzmann step cannot be stretched to fit a frame: its length in time is fixed by the
 * grid and the viscosity, and changing it changes the physics. So each frame runs as many fixed
 * steps as the elapsed wall time calls for, carrying the remainder to the next frame. Game engines
 * advance their physics the same way (a fixed time step, with the frame's delta time only deciding
 * how many steps to take). A device that cannot compute that many steps runs slower; it does not
 * pile up a backlog it could never repay, and `achieved` says how far behind it is.
 */

/** Flow-through times (H / u_ref) per second at normal speed: the wind above the roofs moves one
 * building height per second. */
export const PLAYBACK_RATE = 1;

/** Longest wall time one frame may claim, so a slow frame does not cause a burst of steps. A
 * hidden tab is not a slow device: callers reset the clock when the page comes back. */
const MAX_FRAME_S = 0.1;
/** Most simulated time a slow device may owe before it is let off, in seconds of playback. */
const MAX_BACKLOG_S = 0.25;

/**
 * Playback speed relative to normal: 1, or the value of the `speed` URL parameter (for example
 * `?speed=4` to fast-forward a demo). Every device given the same value runs at the same speed.
 */
export function playbackSpeed(search = globalThis.location?.search ?? ''): number {
  const v = Number(new URLSearchParams(search).get('speed'));
  return v > 0 ? v : 1;
}

export class StepClock {
  /** Flow-through times per second of wall time. */
  readonly rate: number;
  private owed = 0;
  private last: number | null = null;
  private windowStart: number | null = null;
  private windowTarget = 0;
  private windowDropped = 0;
  /** Share of the target speed reached over the last full second, at most 1. */
  achieved = 1;

  constructor(rate = PLAYBACK_RATE * playbackSpeed()) {
    this.rate = rate;
  }

  /**
   * Steps due at wall time `now` (ms) on a grid that needs `stepsPerFlowThrough` steps for one
   * flow-through time. Call once per frame, then report the steps actually run with `ran`.
   */
  due(now: number, stepsPerFlowThrough: number): number {
    const gap = this.last === null ? 0 : (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(gap, MAX_FRAME_S);
    const perSecond = this.rate * stepsPerFlowThrough;
    const add = dt * perSecond;
    const cap = MAX_BACKLOG_S * perSecond;
    // Time the device could not compute is given up and counted against `achieved`: the part of a
    // slow frame beyond MAX_FRAME_S, and whatever would exceed the backlog cap.
    const slowFrame = (gap - dt) * perSecond;
    this.windowTarget += add + slowFrame;
    this.windowDropped += slowFrame + Math.max(0, this.owed + add - cap);
    this.owed = Math.min(this.owed + add, cap);
    return Math.floor(this.owed);
  }

  /** Records the steps run at wall time `now` (ms) and updates `achieved` once a second. */
  ran(steps: number, now: number): void {
    this.owed = Math.max(0, this.owed - steps);
    this.windowStart ??= now;
    if (now - this.windowStart < 1000) return;
    this.achieved = this.windowTarget > 0 ? 1 - this.windowDropped / this.windowTarget : 1;
    this.windowStart = now;
    this.windowTarget = 0;
    this.windowDropped = 0;
  }

  /** Forget the elapsed time, e.g. when a hidden page is shown again. */
  reset(): void {
    this.owed = 0;
    this.last = null;
  }
}
