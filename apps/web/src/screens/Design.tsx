import { useCallback, useMemo, useState } from 'react';
import { Screen } from '../components/Screen';
import { SimulatedTag } from '../components/SimulatedTag';
import { StreetSimulation } from '../components/StreetSimulation';
import { expectedRegime, regimeText } from '../content/regimes';
import { useI18n } from '../i18n/context';
import type { EngineChoice } from '../sim/engine';
import type { SimStats } from '../sim/streetSim';

const ASPECT_MIN = 0.3;
const ASPECT_MAX = 3;

function Readout({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`text-right ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

export function Design({ engine }: { engine: EngineChoice }) {
  const { t, lang } = useI18n();
  // The slider moves freely; the solver rebuilds when the value settles.
  const [draft, setDraft] = useState(1);
  const [aspect, setAspect] = useState(1);
  const [wind, setWind] = useState(true);
  const [speed, setSpeed] = useState(false);
  const [stats, setStats] = useState<SimStats | null>(null);
  const layers = useMemo(() => ({ wind, speed }), [wind, speed]);
  const onStats = useCallback((s: SimStats) => setStats(s), []);
  const regime = regimeText[expectedRegime(draft)];
  const num = (v: number, digits = 0) =>
    v.toLocaleString(lang === 'en' ? 'en-GB' : 'zh-HK', { maximumFractionDigits: digits });

  return (
    <Screen title={t('design.title')} intro={t('design.intro')}>
      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between text-sm text-ink-muted">
          <span aria-hidden="true">{t('design.windArrow')} →</span>
          <SimulatedTag />
        </div>
        <StreetSimulation
          aspect={aspect}
          layers={layers}
          engine={engine}
          onStats={onStats}
          label={t('design.simLabel')}
        />
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <label htmlFor="aspect" className="block font-bold">
            {t('design.aspect')}
          </label>
          <div className="mt-1 flex items-center gap-4">
            <input
              id="aspect"
              type="range"
              min={ASPECT_MIN}
              max={ASPECT_MAX}
              step={0.1}
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={() => setAspect(draft)}
              onKeyUp={() => setAspect(draft)}
              onBlur={() => setAspect(draft)}
              className="h-11 flex-1 accent-[var(--accent)]"
            />
            <output htmlFor="aspect" className="w-16 text-right font-mono text-lg">
              {draft.toFixed(1)}
            </output>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{t('design.aspectHint')}</p>

          <fieldset className="mt-6">
            <legend className="font-bold">{t('design.layers')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ['wind', wind, setWind],
                  ['speed', speed, setSpeed],
                ] as const
              ).map(([key, on, set]) => (
                <label
                  key={key}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => set(e.target.checked)}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {t(key === 'wind' ? 'layer.wind' : 'layer.speed')}
                </label>
              ))}
            </div>
          </fieldset>

          <section className="mt-6 rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-bold text-ink-muted">{t('design.expected')}</h2>
            <p className="mt-1 text-lg font-bold">{t(regime.name)}</p>
            <p className="mt-1">{t(regime.body)}</p>
            <p className="mt-2 text-sm text-ink-muted">{t(regime.source)}</p>
          </section>
        </div>

        <section aria-labelledby="readouts">
          <div className="flex items-center justify-between">
            <h2 id="readouts" className="font-bold">
              {t('design.readouts')}
            </h2>
            <SimulatedTag />
          </div>
          <dl className="mt-2 text-sm">
            <Readout label={t('readout.reynolds')} value={stats ? num(stats.reynolds) : '…'} />
            <Readout
              label={t('readout.grid')}
              value={
                stats ? t('readout.gridValue', { h: stats.height, cells: num(stats.cells) }) : '…'
              }
            />
            <Readout label={t('readout.latticeSpeed')} value={stats ? num(stats.uRef, 3) : '…'} />
            <Readout
              label={t('readout.smagorinsky')}
              value={stats ? num(stats.smagorinsky, 2) : '…'}
            />
            <Readout
              label={t('readout.rate')}
              value={stats ? t('readout.rateValue', { n: num(stats.stepsPerSecond) }) : '…'}
              mono={false}
            />
            <Readout
              label={t('readout.engine')}
              value={stats ? t(stats.engine === 'gpu' ? 'engine.gpu' : 'engine.cpu') : '…'}
              mono={false}
            />
            {stats && stats.recoveries > 0 && (
              <Readout label={t('readout.recoveries')} value={num(stats.recoveries)} />
            )}
          </dl>
          {stats?.engine === 'cpu' && <p className="mt-3 text-sm">{t(stats.note)}</p>}
          <p className="mt-3 text-sm text-ink-muted">{t('readout.reynoldsHelp')}</p>
          <p className="mt-6 rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-muted">
            {t('design.next')}
          </p>
        </section>
      </div>
    </Screen>
  );
}
