import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExposurePanel } from '../components/ExposurePanel';
import { FumesLegend } from '../components/FumesLegend';
import { GreeneryControls } from '../components/GreeneryControls';
import { HeatControls } from '../components/HeatControls';
import { HeatPanel } from '../components/HeatPanel';
import { RecordedRun } from '../components/RecordedRun';
import { Screen } from '../components/Screen';
import { SimulatedTag } from '../components/SimulatedTag';
import { StreetSimulation } from '../components/StreetSimulation';
import { expectedRegime, regimeText } from '../content/regimes';
import { useI18n } from '../i18n/context';
import type { EngineChoice } from '../sim/engine';
import { addReading, compare, EMPTY_EXPOSURE } from '../sim/exposure';
import type { ExposureState } from '../sim/exposure';
import type { GreeneryDesign } from '../sim/greenery';
import {
  buildGreenery,
  crownTop,
  DEFAULT_DESIGN,
  FULL_SCALE_HEIGHT_M,
  PAVEMENT_WIDTH,
  shiftRange,
} from '../sim/greenery';
import type { StreetScale } from '../sim/greenery';
import type { SimStats } from '../sim/streetSim';
import { PLAYBACK_RATE } from '../sim/clock';
import { checkedAspectMax } from '../sim/streetSim';
import { localTree, parseCustomStreet, presetByKey } from '../content/presets';
import { streetRun } from '../content/streetRuns';
import type { StreetPreset } from '../content/presets';
import { useHashParam } from '../lib/router';
import { decodeLayout, encodeLayout } from '../ai/layout';
import { PERSON_HEIGHT_M } from '../sun/canyon';
import { hourWeather, pavementHeat, shadeCrowns } from '../sun/heat';
import { weatherPresets } from '../sun/weather';

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

/** Building height in metres and typical local tree for a preset, or for a custom street. */
function streetScale(preset: StreetPreset | null, customStreet?: ReturnType<typeof parseCustomStreet>): StreetScale {
  const tree = localTree(preset?.key ?? null);
  return {
    heightM: customStreet ? customStreet.heightM : preset ? preset.height_m.median : FULL_SCALE_HEIGHT_M,
    localTree:
      tree?.height_m && tree.crown_spread_m
        ? { heightM: tree.height_m.median, spreadM: tree.crown_spread_m.median }
        : null,
  };
}

/** The Design screen; a street preset (#/design?street=...) or a custom street sets the starting shape. */
export function Design({ engine }: { engine: EngineChoice }) {
  const streetKey = useHashParam('street');
  const preset = presetByKey(streetKey);
  const custom = parseCustomStreet(window.location.hash);
  // A different preset or custom street starts the screen afresh from its shape.
  return <DesignScreen key={`${preset?.key ?? 'custom'}:${custom ? `${custom.heightM}-${custom.widthM}` : ''}`} engine={engine} preset={preset} customStreet={custom} />;
}

function DesignScreen({ engine, preset, customStreet }: { engine: EngineChoice; preset: StreetPreset | null; customStreet?: ReturnType<typeof parseCustomStreet> }) {
  const { t, lang } = useI18n();
  // A design sent from the Trade-off screen (#/design?layout=...) comes with its street shape.
  const layoutParam = useHashParam('layout');
  const sentAspect = Number(useHashParam('aspect'));
  const start = customStreet
    ? customStreet.aspectHOverW
    : preset
      ? Math.round(preset.aspect_h_over_w.median * 10) / 10
      : sentAspect > 0
        ? sentAspect
        : 1;
  // The slider moves freely; the solver rebuilds when the value settles.
  const [draft, setDraft] = useState(start);
  const [aspect, setAspect] = useState(start);
  const [wind, setWind] = useState(true);
  const [speed, setSpeed] = useState(false);
  const [fumes, setFumes] = useState(true);
  // The street's height in metres and its typical roadside tree size the greenery (A-014, A-015).
  const scale = useMemo(() => streetScale(preset, customStreet), [customStreet, preset]);
  const [design, setDesign] = useState<GreeneryDesign>(() =>
    // On a real street, trees start at the size of the local roadside trees.
    preset && scale.localTree
      ? {
          ...DEFAULT_DESIGN,
          treeSize: 'local',
          rows: 'kerbs',
          crownBase: crownTop({ ...DEFAULT_DESIGN, treeSize: 'local' }, scale) / 3,
        }
      : DEFAULT_DESIGN,
  );
  const [stats, setStats] = useState<SimStats | null>(null);
  const [exposure, setExposure] = useState<ExposureState>(EMPTY_EXPOSURE);
  const layers = useMemo(() => ({ wind, speed, fumes }), [wind, speed, fumes]);
  // Only street shapes the regime study has checked on the live grid.
  const aspectMax = checkedAspectMax();
  const street = Math.min(aspect, aspectMax);
  const shown = Math.min(draft, aspectMax);

  // Street width in building heights, and the greenery placed in it.
  const width = 1 / street;
  const sent = useMemo(() => decodeLayout(layoutParam), [layoutParam]);
  // The sent layout holds until the user changes the greenery themselves.
  const [useSent, setUseSent] = useState(sent !== null);
  const own = useMemo(() => buildGreenery(design, width, scale), [design, width, scale]);
  const greenery = useSent && sent ? sent : own;
  const changeDesign = useCallback((d: GreeneryDesign) => {
    setUseSent(false);
    setDesign(d);
  }, []);
  const range = useMemo(
    () => shiftRange(buildGreenery({ ...design, shift: 0 }, width, scale), width),
    [design, width, scale],
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
    (dx: number) => {
      setUseSent(false);
      setDesign((d) => ({
        ...d,
        shift: Math.min(Math.max(d.shift + dx, range[0]), range[1]),
      }));
    },
    [range],
  );
  const comparison = compare(exposure, shapeKey);

  // Sun and heat (BRIEF.md 6): the street in metres at the shape the live view shows.
  const days = weatherPresets();
  const [dayKey, setDayKey] = useState('very_hot');
  const [hour, setHour] = useState(13);
  const [axis, setAxis] = useState(customStreet ? customStreet.bearingDeg : preset ? preset.bearing_deg : 0);
  const day = days.find((d) => d.key === dayKey) ?? days[0] ?? null;
  const weather = useMemo(() => (day ? hourWeather(day, hour) : null), [day, hour]);
  const street2d = useMemo(
    () => ({
      heightM: scale.heightM,
      widthM: scale.heightM * width,
      axisDeg: axis,
      crowns: shadeCrowns(greenery, scale.heightM),
    }),
    [scale.heightM, width, axis, greenery],
  );
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const num = useCallback(
    (v: number, digits = 0) => v.toLocaleString(locale, { maximumFractionDigits: digits }),
    [locale],
  );
  const busHeadroomM = 4.4;
  const pavementMinM = customStreet
    ? Math.min(customStreet.pavementLeftM, customStreet.pavementRightM)
    : PAVEMENT_WIDTH * scale.heightM;
  const constraintBadges = useMemo(() => {
    const badges: Array<{ label: string; tone: 'ok' | 'warn'; detail: string }> = [];
    const inRoad = greenery.some((e) => e.x0 < PAVEMENT_WIDTH || e.x1 > width - PAVEMENT_WIDTH);
    badges.push({
      label: t('design.badgePavement'),
      tone: inRoad ? 'warn' : 'ok',
      detail: inRoad
        ? t('design.badgePavementWarn')
        : t('design.badgePavementOk', { m: num(pavementMinM, 1) }),
    });

    if (design.kind === 'trees') {
      const crownBaseM = design.crownBase * scale.heightM;
      const belowBus = crownBaseM < busHeadroomM;
      badges.push({
        label: t('design.badgeBus'),
        tone: belowBus ? 'warn' : 'ok',
        detail: belowBus
          ? t('design.badgeBusWarn', { m: num(busHeadroomM, 1) })
          : t('design.badgeBusOk', { m: num(busHeadroomM, 1) }),
      });
    } else if (design.kind === 'hedge') {
      badges.push({
        label: t('design.badgeBus'),
        tone: 'ok',
        detail: t('design.badgeBusHedge', { m: num(busHeadroomM, 1) }),
      });
    }

    if (design.kind !== 'none') {
      badges.push({
        label: t('design.badgeStreet'),
        tone: 'ok',
        detail: t('design.badgeStreetOk', {
          widthM: num(scale.heightM * width, 1),
          pavementM: num(pavementMinM, 1),
        }),
      });
    }

    return badges;
  }, [design.crownBase, design.kind, greenery, num, pavementMinM, scale.heightM, t, width]);
  const zoneM = PAVEMENT_WIDTH * scale.heightM;
  const heat = weather
    ? pavementHeat(street2d, weather, zoneM, stats?.wind ?? null, PERSON_HEIGHT_M)
    : null;
  // The crowns' shade alone: the same street, hour and wind with no greenery.
  const bare =
    weather && greenery.length > 0
      ? pavementHeat(
          { ...street2d, crowns: [] },
          weather,
          zoneM,
          stats?.wind ?? null,
          PERSON_HEIGHT_M,
        )
      : null;
  const recorded = streetRun(preset?.key ?? null);
  const presetName = preset ? (lang === 'en' ? preset.label_en : preset.label_tc) : '';
  const regime = regimeText[expectedRegime(shown)];

  return (
    <Screen title={t('design.title')} intro={t('design.intro')}>
      <div className="mt-8">
        {(preset || customStreet) && (
          <div className="mb-3 rounded-md border border-line px-3 py-2 text-sm" role="note">
            <p>
              {customStreet
                ? t('design.customNote', {
                    aspect: num(customStreet.aspectHOverW, 1),
                    height: num(customStreet.heightM, 1),
                    width: num(customStreet.widthM, 1),
                  })
                : preset
                  ? preset.aspect_h_over_w.median > aspectMax
                    ? t('design.presetClamped', {
                        name: presetName,
                        ratio: num(preset.aspect_h_over_w.median, 1),
                        max: num(aspectMax, 1),
                      })
                    : t('design.presetNote', {
                        name: presetName,
                        ratio: num(preset.aspect_h_over_w.median, 1),
                      })
                  : null}
              {recorded && ` ${t('design.presetRecorded')}`}
            </p>
            <p className="mt-1 text-ink-muted">{t('design.presetScale')}</p>
          </div>
        )}
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
        {recorded && <RecordedRun run={recorded} name={presetName} />}
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {constraintBadges.map((badge) => (
              <div
                key={badge.label}
                className={[
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-1 text-sm',
                  badge.tone === 'ok'
                    ? 'border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-300'
                    : 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
                ].join(' ')}
                title={badge.detail}
              >
                <span className="font-bold">{badge.label}</span>
                <span className="text-xs opacity-80">{badge.detail}</span>
              </div>
            ))}
          </div>
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

          {useSent && sent && (
            <p className="mt-6 rounded-md border border-accent px-3 py-2 text-sm" role="note">
              {t('design.sentLayout')}
            </p>
          )}
          <GreeneryControls
            design={design}
            onChange={changeDesign}
            shiftRange={range}
            scale={scale}
          />

          {days.length > 0 && (
            <HeatControls
              days={days}
              dayKey={day?.key ?? dayKey}
              onDay={setDayKey}
              hour={hour}
              onHour={setHour}
              axis={axis}
              onAxis={preset ? null : setAxis}
            />
          )}

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
          {weather && heat && (
            <HeatPanel
              street={street2d}
              weather={weather}
              heat={heat}
              bare={bare}
              zoneM={zoneM}
              hour={hour}
            />
          )}
          <p className="mt-4">
            <a
              className="inline-flex min-h-11 items-center underline underline-offset-4"
              href={`#/trade-off?${new URLSearchParams({
                ...(preset ? { street: preset.key } : {}),
                aspect: String(street),
                ...(greenery.length > 0 ? { mine: encodeLayout(greenery) } : {}),
              }).toString()}`}
            >
              {t('design.toTradeOff')}
            </a>
          </p>
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
