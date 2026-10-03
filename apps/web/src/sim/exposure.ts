/**
 * Pavement exposure against the same street without greenery. The live solver reports the
 * running-mean c+ on each pavement; once it has settled, readings are kept: without greenery
 * they form the baseline for that street shape, with greenery they are compared with it. The
 * range shown is the lowest to highest of the last few readings (docs/assumptions.md A-013).
 */
export interface Reading {
  A: number;
  B: number;
}

export interface ExposureState {
  /** Settled readings without greenery, per street shape. */
  baselines: Record<string, Reading[]>;
  /** Settled readings with the current greenery design. */
  green: Reading[];
  /** The design the green readings belong to. */
  designKey: string;
}

export const KEEP = 5;

export const EMPTY_EXPOSURE: ExposureState = { baselines: {}, green: [], designKey: '' };

export interface ExposureInput {
  exposure: Reading | null;
  meanSteps: number;
  settleSteps: number;
  greenCount: number;
}

/** Fold one report from the solver into the state. */
export function addReading(
  s: ExposureState,
  input: ExposureInput,
  shapeKey: string,
  designKey: string,
): ExposureState {
  const green = s.designKey === designKey ? s.green : [];
  const settled = input.exposure !== null && input.meanSteps >= input.settleSteps;
  if (!settled || !input.exposure) {
    return green === s.green && s.designKey === designKey ? s : { ...s, green, designKey };
  }
  const r = input.exposure;
  if (input.greenCount === 0) {
    const old = s.baselines[shapeKey] ?? [];
    return {
      baselines: { ...s.baselines, [shapeKey]: [...old, r].slice(-KEEP) },
      green,
      designKey,
    };
  }
  return { baselines: s.baselines, green: [...green, r].slice(-KEEP), designKey };
}

export interface Comparison {
  /** Relative change against the baseline, lowest and highest, per pavement. */
  A: [number, number];
  B: [number, number];
  readings: number;
}

/** Change of exposure against the baseline, or null until both sides have readings. */
export function compare(s: ExposureState, shapeKey: string): Comparison | null {
  const base = s.baselines[shapeKey];
  if (!base?.length || !s.green.length) return null;
  const mean = (k: keyof Reading) => base.reduce((acc, r) => acc + r[k], 0) / base.length;
  const range = (k: keyof Reading): [number, number] => {
    const b = mean(k);
    const changes = s.green.map((r) => r[k] / b - 1);
    return [Math.min(...changes), Math.max(...changes)];
  };
  return { A: range('A'), B: range('B'), readings: s.green.length };
}
