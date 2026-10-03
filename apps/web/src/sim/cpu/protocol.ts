import type { Domain } from '../domain';
import type { SolverParams } from './solver';

export type ToWorker =
  | {
      type: 'init';
      domain: Domain;
      params: SolverParams;
      initial: { ux: Float32Array; uy: Float32Array };
    }
  | { type: 'params'; params: SolverParams }
  /** New greenery: drag lambda per node; restarts the running mean of the fumes. */
  | { type: 'greenery'; drag: Float32Array }
  /** Time constant of the running mean, in steps. */
  | { type: 'averaging'; steps: number }
  /**
   * Playback speed: `rate` flow-through times per second, `stepsPerFlowThrough` lattice steps in
   * one. The worker steps on its own clock and keeps going between frames.
   */
  | { type: 'clock'; rate: number; stepsPerFlowThrough: number }
  /** Reply with the current state; requests also keep the worker stepping (see PAUSE_MS). */
  | { type: 'frame' };

export type FromWorker =
  | {
      type: 'frame';
      ux: Float32Array;
      uy: Float32Array;
      /** Steps run since the previous frame. */
      steps: number;
      time: number;
      maxSpeed: number;
      /** Running mean of the tracer concentration per node (exponential, see averaging). */
      conc: Float32Array;
      /** Steps since the running mean was restarted, for its start-up correction. */
      meanSteps: number;
      /** True when this frame followed a restore from the last good state. */
      recovered: boolean;
      /** Share of the target playback speed reached over the last second. */
      achieved: number;
    }
  | { type: 'error'; message: string };
