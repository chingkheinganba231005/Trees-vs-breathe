import { LineChart } from '../components/charts/LineChart';
import { StreamPlot } from '../components/charts/StreamPlot';
import { EvidenceCard, StatTile } from '../components/Evidence';
import { Screen } from '../components/Screen';
import { leftOutKeys } from '../content/leftOut';
import { result } from '../content/results';
import type {
  AgreementResult,
  BrowserAgreementResult,
  CavityResult,
  ConservationResult,
  ForceResult,
  PoiseuilleResult,
  RegimesResult,
  ShearResult,
  SpongeResult,
  UpwindResult,
  StabilityResult,
} from '../content/results';
import { useI18n } from '../i18n/context';
import { LIVE_FLOW } from '../sim/streetSim';

const pct = (v: number, digits = 2) => `${(100 * v).toFixed(digits)}%`;
/** A threshold read from a result file; an ellipsis until the file exists. */
const tolerance = (v: number | undefined) =>
  v === undefined ? '…' : `${+(100 * v).toPrecision(3)}%`;
const sci = (v: number) => v.toExponential(1).replace('e', ' × 10^').replace('^-', '^−');

function CavityCard({ re }: { re: 100 | 1000 }) {
  const { t } = useI18n();
  const r = result<CavityResult>(`benchmarks/cavity_re${re}.json`);
  const ghia = r?.u_vertical_centreline;
  return (
    <EvidenceCard
      title={t('hwk.cavityTitle', { re })}
      question={t('hwk.cavityQuestion', { tol: tolerance(r?.threshold?.max_abs_error_below) })}
      result={r}
    >
      {r && ghia && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile
              label={t('hwk.largestGap')}
              value={pct(r.max_abs_error, 1)}
              note={t('hwk.ofLidSpeed')}
            />
            <StatTile label={t('hwk.grid')} value={`${r.grid} × ${r.grid}`} />
          </div>
          <LineChart
            title={t('hwk.cavityChart')}
            xLabel={t('hwk.cavityX')}
            yLabel={t('hwk.cavityY')}
            xDomain={re === 100 ? [-0.4, 1] : [-0.6, 1]}
            yDomain={[0, 1]}
            xTicks={re === 100 ? [-0.4, 0, 0.4, 0.8] : [-0.4, 0, 0.4, 0.8]}
            yTicks={[0, 0.25, 0.5, 0.75, 1]}
            series={[
              {
                id: 'model',
                label: t('hwk.thisModel'),
                kind: 'line',
                points: r.profile_u.y.map((y, i) => [r.profile_u.u[i]!, y] as const),
              },
              {
                id: 'ghia',
                label: t('hwk.ghia'),
                kind: 'markers',
                points: ghia.positions.map((y, i) => [ghia.reference[i]!, y] as const),
              },
            ]}
            describe={(_, i) => (
              <>
                <div className="font-bold">
                  {t('hwk.thisModel')} {ghia.simulated[i]!.toFixed(3)}
                </div>
                <div className="text-ink-muted">
                  {t('hwk.ghia')} {ghia.reference[i]!.toFixed(3)} · y{' '}
                  {ghia.positions[i]!.toFixed(4)}
                </div>
              </>
            )}
            table={{
              columns: ['y', t('hwk.ghia'), t('hwk.thisModel')],
              rows: ghia.positions.map((y, i) => [y, ghia.reference[i]!, ghia.simulated[i]!]),
            }}
            format={(v) =>
              Math.abs(v) < 10 ? v.toFixed(Math.abs(v) >= 0.1 || v === 0 ? 2 : 3) : String(v)
            }
          />
        </>
      )}
    </EvidenceCard>
  );
}

function SolverCards() {
  const { t } = useI18n();
  const pois = result<PoiseuilleResult>('benchmarks/poiseuille.json');
  const mass = result<ConservationResult>('benchmarks/conservation.json');
  const shear = result<ShearResult>('benchmarks/smagorinsky_shear.json');
  const force = result<ForceResult>('benchmarks/force_stress.json');
  const jax = result<AgreementResult>('benchmarks/numpy_jax_agreement.json');
  const browser = result<BrowserAgreementResult>('benchmarks/browser_agreement.json');
  return (
    <div className="mt-4 grid gap-4">
      <EvidenceCard
        title={t('hwk.poisTitle')}
        question={t('hwk.poisQuestion', {
          tol: tolerance(pois?.threshold?.rel_l2_below),
          h: pois?.threshold?.for_height_at_least ?? '…',
        })}
        result={pois}
      >
        {pois && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {pois.rows.map((row) => (
              <StatTile
                key={row.height}
                label={t('hwk.poisRow', { h: row.height })}
                value={pct(row.rel_l2)}
              />
            ))}
          </div>
        )}
      </EvidenceCard>
      <CavityCard re={100} />
      <CavityCard re={1000} />
      <EvidenceCard
        title={t('hwk.massTitle')}
        question={t('hwk.massQuestion', { tol: tolerance(mass?.threshold?.rel_change_below) })}
        result={mass}
      >
        {mass && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile label={t('hwk.massChange')} value={sci(mass.rel_change)} />
          </div>
        )}
      </EvidenceCard>
      <EvidenceCard title={t('hwk.lesTitle')} question={t('hwk.lesQuestion')} result={shear}>
        {shear && force && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile label={t('hwk.lesShear')} value={sci(shear.rel_error)} />
            <StatTile label={t('hwk.lesForce')} value={sci(force.ratio)} />
          </div>
        )}
      </EvidenceCard>
      <EvidenceCard
        title={t('hwk.agreeTitle')}
        question={t('hwk.agreeQuestion', {
          tol: tolerance(browser?.threshold?.max_abs_diff_over_uref_below),
        })}
        result={browser ?? jax}
      >
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="text-ink-muted">
              <th className="py-1 pr-2 font-normal">{t('hwk.agreeCase')}</th>
              <th className="py-1 pr-2 font-normal">{t('hwk.agreeCpu')}</th>
              <th className="py-1 font-normal">{t('hwk.agreeGpu')}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {browser?.rows.map((row) => (
              <tr key={row.name} className="border-t border-line">
                <td className="py-1.5 pr-2 font-sans">{row.name}</td>
                <td className="pr-2">{pct(row.cpuError, 3)}</td>
                <td>{row.gpuError === null ? '—' : pct(row.gpuError, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {jax && (
          <p className="mt-2 text-sm text-ink-muted">
            {t('hwk.agreeJax', {
              worst: pct(Math.max(...jax.rows.map((r) => r.max_abs_diff_over_uref)), 3),
            })}
          </p>
        )}
      </EvidenceCard>
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>['t'];

/** A regime check in the reader's language, with its numbers taken from the result rows. */
function checkText(
  c: RegimesResult['checks'][number],
  rows: RegimesResult['rows'],
  t: Translate,
  lang: string,
): string {
  const row = rows.find((r) => r.aspect === c.aspect);
  if (!c.id || !row) return `${c.expectation}. ${t('hwk.observed')}: ${c.observed}.`;
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  return t(`hwk.check.${c.id}`, {
    n: row.stacked_primary_vortices,
    floor: row.floor_fraction_with_wind.toLocaleString(locale, { style: 'percent' }),
    rotation: t(row.strongest_vortex_rotation === 'clockwise' ? 'regimes.cw' : 'regimes.acw'),
    top: (row.top_flow_over_uref ?? Number.NaN).toLocaleString(locale, {
      maximumFractionDigits: 2,
      signDisplay: 'always',
    }),
  });
}

function UpwindCard() {
  const { t } = useI18n();
  const upwind = result<UpwindResult>('street/upwind.json');
  const label = (n: number) => t(n === 1 ? 'hwk.upwindAlone' : 'hwk.upwindBehind');
  return (
    <EvidenceCard title={t('hwk.upwindTitle')} question={t('hwk.upwindQuestion')} result={upwind}>
      {upwind && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {upwind.rows.map((r) => (
              <StatTile
                key={r.streets_in_row}
                label={`${label(r.streets_in_row)}: ${t('hwk.upwindTop')}`}
                value={r.top_flow_over_uref.toLocaleString('en-GB', {
                  maximumFractionDigits: 2,
                  signDisplay: 'always',
                })}
              />
            ))}
          </div>
          <LineChart
            title={t('hwk.upwindChart')}
            xLabel={t('hwk.upwindX')}
            yLabel={t('hwk.upwindY')}
            xDomain={[-1.5, 2.5]}
            yDomain={[0, 2]}
            xTicks={[-1, 0, 1, 2]}
            yTicks={[0, 0.5, 1, 1.5, 2]}
            series={upwind.rows.map((r) => {
              const n = r.centre_profile_over_uref.length / 2;
              return {
                id: String(r.streets_in_row),
                label: label(r.streets_in_row),
                kind: r.streets_in_row === 1 ? ('markers' as const) : ('line' as const),
                points: r.centre_profile_over_uref
                  .map((u, j) => [u, (j + 0.5) / n] as const)
                  .filter((_, j) => r.streets_in_row !== 1 || j % 3 === 0),
              };
            })}
            table={{
              columns: [t('hwk.upwindY'), ...upwind.rows.map((r) => label(r.streets_in_row))],
              rows: upwind.rows[0]!.centre_profile_over_uref.map((_, j) => [
                (j + 0.5) / (upwind.rows[0]!.centre_profile_over_uref.length / 2),
                ...upwind.rows.map((r) => r.centre_profile_over_uref[j] ?? Number.NaN),
              ]),
            }}
          />
          <p className="mt-2 text-sm text-ink-muted">{t('hwk.upwindNote')}</p>
        </>
      )}
    </EvidenceCard>
  );
}

function StreetCards() {
  const { t, lang } = useI18n();
  const regimes = result<RegimesResult>('street/regimes.json');
  const sponge = result<SpongeResult>('street/sponge.json');
  const stability = result<StabilityResult>('street/stability.json');
  return (
    <div className="mt-4 grid gap-4">
      <EvidenceCard
        title={t('hwk.regimeTitle')}
        question={t('hwk.regimeQuestion')}
        result={regimes}
      >
        {regimes && (
          <>
            <div className="mt-4 flex flex-wrap items-end gap-6">
              {regimes.rows.map((row) => (
                <StreamPlot key={row.aspect} row={row} />
              ))}
            </div>
            <p className="mt-2 text-sm text-ink-muted">{t('hwk.regimeKey')}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {regimes.checks.map((c, k) => (
                <li key={k} className="border-t border-line pt-2">
                  <span className="font-bold">
                    H/W {c.aspect}: {t(c.passed ? 'evidence.passed' : 'evidence.failed')}.
                  </span>{' '}
                  {checkText(c, regimes.rows, t, lang)}
                </li>
              ))}
            </ul>
          </>
        )}
      </EvidenceCard>
      <UpwindCard />
      <EvidenceCard title={t('hwk.spongeTitle')} question={t('hwk.spongeQuestion')} result={sponge}>
        {sponge && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <StatTile
                label={t('hwk.spongeFactor')}
                value={`${sponge.noise_reduction_factor.toFixed(1)}×`}
              />
            </div>
            <LineChart
              title={t('hwk.spongeChart')}
              xLabel={t('hwk.spongeX')}
              yLabel={t('hwk.spongeY')}
              xDomain={[0, Math.max(...sponge.rows[0]!.series.map((p) => p.step))]}
              yDomain={[
                0,
                Math.max(...sponge.rows.flatMap((r) => r.series.map((p) => p.rho_std))) * 1.1,
              ]}
              xTicks={[0, 10000, 20000, 30000, 40000].filter(
                (v) => v <= Math.max(...sponge.rows[0]!.series.map((p) => p.step)),
              )}
              yTicks={[0, 0.02, 0.04, 0.06].filter(
                (v) =>
                  v <=
                  Math.max(...sponge.rows.flatMap((r) => r.series.map((p) => p.rho_std))) * 1.1,
              )}
              series={sponge.rows.map((r, k) => ({
                id: r.configuration,
                label: t(k === 0 ? 'hwk.spongeWithout' : 'hwk.spongeWith'),
                kind: k === 0 ? ('markers' as const) : ('line' as const),
                points: r.series.map((p) => [p.step, p.rho_std] as const),
              }))}
              table={{
                columns: [t('hwk.spongeX'), t('hwk.spongeWithout'), t('hwk.spongeWith')],
                rows: sponge.rows[0]!.series.map((p, i) => [
                  String(p.step),
                  p.rho_std,
                  sponge.rows[1]!.series[i]?.rho_std ?? Number.NaN,
                ]),
              }}
              format={(v) => (v >= 1000 ? v.toLocaleString('en-GB') : v.toFixed(3))}
            />
          </>
        )}
      </EvidenceCard>
      <EvidenceCard
        title={t('hwk.stabTitle')}
        question={t('hwk.stabQuestion', {
          re: LIVE_FLOW.reynolds.toLocaleString('en-GB'),
          cs: LIVE_FLOW.smagorinsky,
        })}
        result={stability}
      >
        {stability && (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-ink-muted">
                <th className="py-1 pr-2 font-normal">{t('readout.reynolds')}</th>
                <th className="py-1 pr-2 font-normal">Cs 0.1</th>
                <th className="py-1 font-normal">Cs 0.17</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...new Set(stability.rows.map((r) => r.reynolds))].map((re) => (
                <tr key={re} className="border-t border-line">
                  <td className="py-1.5 pr-2 font-mono">{re.toLocaleString('en-GB')}</td>
                  {[0.1, 0.17].map((cs) => {
                    const row = stability.rows.find(
                      (r) => r.reynolds === re && r.smagorinsky === cs,
                    );
                    return (
                      <td key={cs} className="pr-2">
                        {row
                          ? t(row.stable ? 'hwk.stable' : 'hwk.unstable', {
                              steps: row.steps_run.toLocaleString('en-GB'),
                            })
                          : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </EvidenceCard>
    </div>
  );
}

export function HowWeKnow() {
  const { t } = useI18n();
  return (
    <Screen title={t('howWeKnow.title')} intro={t('howWeKnow.intro')}>
      <section className="mt-10">
        <h2 className="text-xl font-bold">{t('hwk.solverHeading')}</h2>
        <p className="mt-1 text-ink-muted">{t('hwk.solverIntro')}</p>
        <SolverCards />
      </section>
      <section className="mt-12">
        <h2 className="text-xl font-bold">{t('hwk.streetHeading')}</h2>
        <p className="mt-1 text-ink-muted">{t('hwk.streetIntro')}</p>
        <StreetCards />
      </section>
      <section className="mt-12">
        <h2 className="text-xl font-bold">{t('howWeKnow.leftOutTitle')}</h2>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {leftOutKeys.map((key) => (
            <li key={key} className="px-4 py-3 leading-snug">
              {t(key)}
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-10 text-sm text-ink-muted">{t('hwk.later')}</p>
    </Screen>
  );
}
