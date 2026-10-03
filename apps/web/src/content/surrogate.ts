import type { Provenance } from './results';
import { result } from './results';

/** The bare street of one shape in the dataset (results/dataset/summary.json). */
export interface BareStreet {
  aspect: number;
  aspect_grid: number;
  width_cells: number;
  runs: number;
  /** Mean c+ on pavements A and B. */
  exposure: [number, number];
  exposure_sd: [number, number];
  /** Mean wind on the pavements as a share of the inflow speed. */
  wind: [number, number];
}

export interface DatasetSummary extends Provenance {
  plan: { height: number; run: { spin_up: number; average: number; every: number } };
  train_runs: number;
  bare: BareStreet[];
}

export interface Scores {
  n: number;
  r2: number;
  median_relative_error: number;
  fac2: number;
}

export interface SurrogateMetrics extends Provenance {
  targets: { r2: number; median_relative_error: number; fac2: number };
  meets_targets: boolean;
  scalar: {
    test: SetScores;
    ood: SetScores;
  };
  field: {
    test: { runs: number; r2_log1p_cplus: number; r2_speed: number; pavement_cplus: Scores };
    ood: { runs: number; r2_log1p_cplus: number; r2_speed: number; pavement_cplus: Scores };
  };
  models: Record<string, { bytes: number; sha256: string }>;
  dataset_run?: string;
}

export interface SetScores {
  runs: number;
  exposure: Scores;
  exposure_A: Scores;
  exposure_B: Scores;
  ratio_A: Scores;
  ratio_B: Scores;
  wind_A: Scores;
  wind_B: Scores;
  within_two_spreads_A: number;
  within_two_spreads_B: number;
  noise_floor: { exposure: number; wind: number };
  guard_accepts: number;
  parity: { true: [number, number][]; pred: [number, number][]; aspect: number[] };
}

export function datasetSummary(): DatasetSummary | null {
  return result<DatasetSummary>('dataset/summary.json');
}

/** The dataset's bare street at a slider position of H/W, or null if it has none. */
export function datasetBare(aspect: number): BareStreet | null {
  return datasetSummary()?.bare.find((b) => Math.abs(b.aspect - aspect) < 1e-6) ?? null;
}

export function surrogateMetrics(): SurrogateMetrics | null {
  return result<SurrogateMetrics>('surrogate/metrics.json');
}
