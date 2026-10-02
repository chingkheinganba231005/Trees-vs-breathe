import type { FlowSettings } from './street';

/** Speeds above this many lattice units mean the solution no longer means anything. */
export const SPEED_LIMIT = 0.4;
/** Below this, BGK has no viscosity left to damp what the sub-grid model misses. */
export const MIN_TAU_MARGIN = 2e-5;

export function isHealthy(maxSpeed: number): boolean {
  return Number.isFinite(maxSpeed) && maxSpeed < SPEED_LIMIT;
}

export interface Recovery {
  flow: FlowSettings;
  /** True when keeping the Reynolds number would have needed tau0 below the safe margin. */
  reynoldsLowered: boolean;
}

/**
 * After a blow-up: lower the time step, which in lattice units means a smaller inflow speed at
 * the same Reynolds number. If that would push tau0 too close to 1/2, keep tau0 at the margin and
 * accept a lower Reynolds number instead, and say so.
 */
export function lowerTimeStep(flow: FlowSettings, height: number, factor = 0.8): Recovery {
  const uRef = flow.uRef * factor;
  const nu = (uRef * height) / flow.reynolds;
  const tauMargin = 3 * nu;
  if (tauMargin >= MIN_TAU_MARGIN) return { flow: { ...flow, uRef }, reynoldsLowered: false };
  const nuMin = MIN_TAU_MARGIN / 3;
  return { flow: { ...flow, uRef, reynolds: (uRef * height) / nuMin }, reynoldsLowered: true };
}

export function reynoldsNumber(flow: FlowSettings): number {
  return flow.reynolds;
}
