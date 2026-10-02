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
  /** Step for about budgetMs, then reply with a frame. */
  | { type: 'run'; budgetMs: number; maxSteps: number };

export type FromWorker =
  | {
      type: 'frame';
      ux: Float32Array;
      uy: Float32Array;
      steps: number;
      time: number;
      maxSpeed: number;
      /** True when this frame followed a restore from the last good state. */
      recovered: boolean;
    }
  | { type: 'error'; message: string };
