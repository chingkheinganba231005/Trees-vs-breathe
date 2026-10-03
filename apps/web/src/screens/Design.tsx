import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExposurePanel } from '../components/ExposurePanel';
import { FumesLegend } from '../components/FumesLegend';
import { GreeneryControls } from '../components/GreeneryControls';
import { Screen } from '../components/Screen';
import { SimulatedTag } from '../components/SimulatedTag';
import { StreetSimulation } from '../components/StreetSimulation';
import { expectedRegime, regimeText } from '../content/regimes';
import { useI18n } from '../i18n/context';
import type { EngineChoice } from '../sim/engine';
import { addReading, compare, EMPTY_EXPOSURE } from '../sim/exposure';
import type { ExposureState } from '../sim/exposure';
import type { GreeneryDesign } from '../sim/greenery';
import { buildGreenery, DEFAULT_DESIGN, shiftRange } from '../sim/greenery';
import type { SimStats } from '../sim/streetSim';
import { PLAYBACK_RATE } from '../sim/clock';
import { checkedAspectMax } from '../sim/streetSim';

// The shallowest street the regime study checked (results/street/regimes.json); the deepest
// depends on the engine's grid (checkedAspectMax).
const ASPECT_MIN = 0.3;

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
  const [fumes, setFumes] = useState(true);
  const [design, setDesign] = useState<GreeneryDesign>(DEFAULT_DESIGN);
  const [stats, setStats] = useState<SimStats | null>(null);
  const [exposure, setExposure] = useState<ExposureState>(EMPTY_EXPOSURE);
  const layers = useMemo(() => ({ wind, speed, fumes }), [wind, speed, fumes]);
  // Only street shapes the regime study has checked on the live grid.
  const aspectMax = checkedAspectMax();
  const street = Math.min(aspect, aspectMax);
  const shown = Math.min(draft, aspectMax);

  // Street width in building heights, and the greenery placed in it.
  const width = 1 / street;
  const greenery = useMemo(() => buildGreenery(design, width), [design, width]);
  const range = useMemo(
    () => shiftRange(buildGreenery({ ...design, shift: 0 }, width), width),
    [design, width],
  );
  const shapeKey = street.toFixed(1);
  const designKey = `${shapeKey}|${JSON.stringify(greenery)}`;
  const keys = useRef({ shapeKey, designKey });
  useEffect(() => {
    keys.current = { shapeKey, designKey };
  });

  const onStats = useCallback((s: SimStats) => {
    setStats(s);
    setExposure((e) => addReading(e, s, keys.current.shapeKey, keys.current.designKey));
  }, []);
  const onDrag = useCallback(
    (dx: number) =>
      setDesign((d) => ({
        ...d,
        shift: Math.min(Math.max(d.shift + dx, range[0]), range[1]),
      })),
    [range],
  );
  const comparison = compare(exposure, shapeKey);
  const regime = regimeText[expectedRegime(shown)];
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const num = (v: number, digits = 0) =>
    v.toLocaleString(locale, { maximumFractionDigits: digits });

  return (
    <Screen title={t('design.title')} intro={t('design.intro')}>
      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between text-sm text-ink-muted">
          <span aria-hidden="true">{t('design.windArrow')} →</span>
          <SimulatedTag />
        </div>
        <StreetSimulation
          aspect={street}
          greenery={greenery}
          layers={layers}
          engine={engine}
          onStats={onStats}
          onDrag={onDrag}
          label={t('design.simLabel')}
        />
        {fumes && <FumesLegend />}
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
              max={aspectMax}
              step={0.1}
              value={shown}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={() => setAspect(draft)}
              onKeyUp={() => setAspect(draft)}
              onBlur={() => setAspect(draft)}
              className="h-11 flex-1 accent-[var(--accent)]"
            />
            <output htmlFor="aspect" className="w-16 text-right font-mono text-lg">
              {shown.toFixed(1)}
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
                  ['fumes', fumes, setFumes],
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
                  {t(`layer.${key}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <GreeneryControls design={design} onChange={setDesign} shiftRange={range} />

          <section className="mt-6 rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-bold text-ink-muted">{t('design.expected')}</h2>
            <p className="mt-1 text-lg font-bold">{t(regime.name)}</p>
            <p className="mt-1">{t(regime.body)}</p>
            <p className="mt-2 text-sm text-ink-muted">{t(regime.source)}</p>
          </section>
        </div>

        <div>
          <ExposurePanel
            stats={stats}
            comparison={comparison}
            hasBaseline={(exposure.baselines[shapeKey]?.length ?? 0) > 0}
          />
          <section aria-labelledby="readouts" className="mt-6">
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
                label={t('readout.playback')}
                value={
                  stats
                    ? t('readout.playbackValue', {
                        p: stats.playbackAchieved.toLocaleString(locale, {
                          style: 'percent',
                          maximumFractionDigits: 0,
                        }),
                      }) +
                      (stats.playbackRate === PLAYBACK_RATE
                        ? ''
                        : ` · ${t('readout.playbackFast', { x: num(stats.playbackRate / PLAYBACK_RATE, 2) })}`)
                    : '…'
                }
                mono={false}
              />
              <Readout label={t('readout.rate')} value={stats ? num(stats.stepsPerSecond) : '…'} />
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
            {stats && stats.playbackAchieved < 0.9 && (
              <p className="mt-3 text-sm" role="status">
                {t('readout.playbackSlow')}
              </p>
            )}
            <p className="mt-3 text-sm text-ink-muted">{t('readout.playbackHelp')}</p>
            <p className="mt-3 text-sm text-ink-muted">{t('readout.reynoldsHelp')}</p>
            <p className="mt-6 rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-muted">
              {t('design.next')}
            </p>
          </section>
        </div>
      </div>
    </Screen>
  );
}
