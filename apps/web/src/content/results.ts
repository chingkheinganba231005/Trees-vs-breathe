// Every number on the evidence screens comes from these files, written by the test and study
// pipelines (results/README.md). Missing files show as "not yet computed", never as zero.

export interface Provenance {
  schema: number;
  generated_by: string;
  generated_at: string;
  commit: string;
  dirty?: boolean;
  passed: boolean;
  name: string;
  method?: string;
  metric?: string;
  threshold?: Record<string, number>;
}

const files = import.meta.glob<Record<string, unknown>>('../../../../results/**/*.json', {
  eager: true,
  import: 'default',
});

export function result<T extends Provenance>(path: string): T | null {
  const key = Object.keys(files).find((k) => k.endsWith(`/results/${path}`));
  return key ? (files[key] as T) : null;
}

export interface CavityResult extends Provenance {
  reynolds: number;
  grid: number;
  steps: number;
  max_abs_error: number;
  u_vertical_centreline: {
    positions: number[];
    reference: number[];
    simulated: number[];
    max_abs_error: number;
  };
  v_horizontal_centreline: {
    positions: number[];
    reference: number[];
    simulated: number[];
    max_abs_error: number;
  };
  profile_u: { y: number[]; u: number[] };
  profile_v: { x: number[]; v: number[] };
}

export interface PoiseuilleResult extends Provenance {
  rows: { height: number; rel_l2: number; steps: number }[];
  observed_order: number;
}

export interface ConservationResult extends Provenance {
  rel_change: number;
}

export interface ShearResult extends Provenance {
  rel_error: number;
  smagorinsky: number;
}

export interface ForceResult extends Provenance {
  ratio: number;
}

export interface AgreementResult extends Provenance {
  rows: { case: string; steps: number; max_abs_diff_over_uref: number }[];
}

export interface BrowserAgreementResult extends Provenance {
  adapter: string;
  rows: { name: string; cells: number; steps: number; cpuError: number; gpuError: number | null }[];
  worst: number;
}

export interface RegimeRow {
  aspect: number;
  width_cells: number;
  stacked_primary_vortices: number;
  floor_fraction_with_wind: number;
  strongest_vortex_rotation?: 'clockwise' | 'anticlockwise' | null;
  top_flow_over_uref?: number;
  vortices: { x: number; z: number; psi: number; rotation: 'clockwise' | 'anticlockwise' }[];
  psi: { rows: number; cols: number; values: number[] };
}

export interface RegimesResult extends Provenance {
  rows: RegimeRow[];
  checks: {
    id?: 'skimming' | 'rotation' | 'stacked' | 'wake' | 'deep';
    aspect: number;
    expectation: string;
    observed: string;
    passed: boolean;
  }[];
}

export interface UpwindResult extends Provenance {
  rows: {
    streets_in_row: number;
    top_flow_over_uref: number;
    strongest_vortex_rotation: 'clockwise' | 'anticlockwise' | null;
    centre_profile_over_uref: number[];
  }[];
}

export interface SpongeResult extends Provenance {
  rows: {
    configuration: string;
    series: { step: number; rho_std: number; max_speed_over_uref: number }[];
    mean_rho_std_second_half: number;
  }[];
  noise_reduction_factor: number;
}

export interface StabilityResult extends Provenance {
  rows: {
    reynolds: number;
    smagorinsky: number;
    tau0: number;
    steps_run: number;
    stable: boolean;
    peak_speed_over_uref: number | null;
  }[];
}
