import { useEffect, useMemo, useRef, useState } from 'react';
import { gridStreet } from '../ai/designs';
import { decodeLayout, encodeLayout } from '../ai/layout';
import { fieldInput } from '../ai/fieldInput';
import { CHECK_RUN, FILLING, meanOfHalves, runCheck } from '../ai/physicsCheck';
import type { CheckResult } from '../ai/physicsCheck';
import { loadSurrogate, modelsPresent } from '../ai/runtime';
import type { Surrogate } from '../ai/runtime';
import { heatOf, picks, scoreElements, search } from '../ai/tradeoff';
import type { Scored } from '../ai/tradeoff';
import { FumesLegend } from '../components/FumesLegend';
import { FieldPreview } from '../components/FieldPreview';
import { HeatControls } from '../components/HeatControls';
import { Screen } from '../components/Screen';
import { SimulatedTag } from '../components/SimulatedTag';
import { ParetoChart } from '../components/charts/ParetoChart';
import type { ParetoPoint } from '../components/charts/ParetoChart';
import { presetByKey } from '../content/presets';
import type { StreetPreset } from '../content/presets';
import { datasetBare } from '../content/surrogate';
import { useI18n } from '../i18n/context';
import { useHashParam } from '../lib/router';
import { FULL_SCALE_HEIGHT_M } from '../sim/greenery';
import { checkedAspectMax } from '../sim/streetSim';
import { FUMES_CMAX } from '../sim/fumesColor';
import { hourWeather } from '../sun/heat';
import { weatherPresets } from '../sun/weather';

/** NSGA-II settings: about 2600 designs scored per search. */
const SEARCH = { population: 64, generations: 40, seed: 2026 } as const;
const ASPECT_MIN = 0.3;

/** A c+ scale for a picture: 100 or the next 1-2-5 step above its largest value. */
function niceMax(values: Float32Array): number {
  let top = 0;
  for (const v of values) if (v > top) top = v;
  if (top <= FUMES_CMAX) return FUMES_CMAX;
  const p = 10 ** Math.floor(Math.log10(top));
  return ([1, 2, 5, 10].map((m) => m * p).find((s) => s >= top) ?? 10 * p) as number;
}

type ModelState =
  | { state: 'checking' }
  | { state: 'missing' }
  | { state: 'ready'; surrogate: Surrogate }
  | { state: 'failed'; message: string };

interface SearchState {
  front: (Scored & { x: number[] })[];
  others: Scored[];
  mine: Omit<Scored, 'design'> | null;
  bare: { heat: number } | null;
  scored: number;
}

type CheckState =
  | { state: 'idle' }
  | { state: 'running'; id: string; done: number; total: number }
  | { state: 'done'; id: string; result: CheckResult }
  | { state: 'failed'; id: string; message: string };

/** The Trade-off screen; a street preset (#/trade-off?street=...) sets the starting shape. */
export function TradeOff() {
  const preset = presetByKey(useHashParam('street'));
  return <TradeOffScreen key={preset?.key ?? ''} preset={preset} />;
}

function TradeOffScreen({ preset }: { preset: StreetPreset | null }) {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const num = (v: number, digits = 0) =>
    v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const pct = (v: number) =>
    v.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 });

  const aspectMax = checkedAspectMax();
  const hashAspect = Number(useHashParam('aspect'));
  const wanted = preset ? preset.aspect_h_over_w.median : hashAspect > 0 ? hashAspect : 1;
  const start = Math.min(aspectMax, Math.max(ASPECT_MIN, Math.round(wanted * 10) / 10));
  const [draft, setDraft] = useState(start);
  const [aspect, setAspect] = useState(start);
  const heightM = preset ? preset.height_m.median : FULL_SCALE_HEIGHT_M;
  const days = weatherPresets();
  const [dayKey, setDayKey] = useState('very_hot');
  const [hour, setHour] = useState(13);
  const [axis, setAxis] = useState(preset ? preset.bearing_deg : 0);
  const day = days.find((d) => d.key === dayKey) ?? days[0] ?? null;
  const weather = useMemo(() => (day ? hourWeather(day, hour) : null), [day, hour]);
  const layoutParam = useHashParam('mine');
  const mine = useMemo(() => decodeLayout(layoutParam), [layoutParam]);
  const grid = gridStreet(aspect);

  const preferWasm = useMemo(
    () => new URLSearchParams(window.location.search).get('ai') === 'wasm',
    [],
  );
  const [model, setModel] = useState<ModelState>({ state: 'checking' });
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!(await modelsPresent())) {
        if (live) setModel({ state: 'missing' });
        return;
      }
      try {
        const surrogate = await loadSurrogate(preferWasm);
        if (live) setModel({ state: 'ready', surrogate });
      } catch (e) {
        if (live)
          setModel({ state: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [preferWasm]);

  const [generation, setGeneration] = useState<number | null>(null);
  const [found, setFound] = useState<SearchState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (model.state !== 'ready' || !weather) return;
    let live = true;
    const street = { aspect, heightM, axisDeg: axis };
    void (async () => {
      setGeneration(0);
      const out = await search(street, weather, model.surrogate, SEARCH, (g) => {
        if (live) setGeneration(g);
      });
      const [mineScored] = mine?.length
        ? await scoreElements([mine], street, weather, model.surrogate)
        : [null];
      const bare = datasetBare(aspect);
      const bareHeat = bare
        ? heatOf([], street, weather, { A: bare.wind[0], B: bare.wind[1] })
        : null;
      if (!live) return;
      const frontIds = new Set(out.front.map((p) => p.x.join(',')));
      setFound({
        front: out.front,
        others: out.all.filter((p) => !frontIds.has(p.x.join(',')) && p.guard.ok),
        mine: mineScored ?? null,
        bare: bareHeat ? { heat: 0.5 * (bareHeat.A + bareHeat.B) } : null,
        scored: SEARCH.population * (SEARCH.generations + 1),
      });
      setGeneration(null);
      setSelected(null);
    })();
    return () => {
      live = false;
    };
  }, [model, weather, aspect, heightM, axis, mine]);

  const chosen = useMemo(() => {
    if (!found || !selected) return null;
    if (selected === 'mine') return found.mine;
    const k = Number(selected.slice(1));
    return selected.startsWith('f') ? (found.front[k] ?? null) : (found.others[k] ?? null);
  }, [found, selected]);
  const best = useMemo(() => (found ? picks(found.front) : null), [found]);
  const pickIds = useMemo(() => {
    const ids: Record<string, string> = {};
    if (!found || !best) return ids;
    const add = (p: unknown, label: string) => {
      const k = found.front.indexOf(p as SearchState['front'][number]);
      if (k >= 0) ids[`f${k}`] = ids[`f${k}`] ? `${ids[`f${k}`]} · ${label}` : label;
    };
    if (best.coolest) add(best.coolest, t('tradeOff.pickCoolest'));
    if (best.cleanest) add(best.cleanest, t('tradeOff.pickCleanest'));
    if (best.balanced) add(best.balanced, t('tradeOff.pickBalanced'));
    return ids;
  }, [found, best, t]);

  const [field, setField] = useState<{ id: string; cplus: Float32Array } | null>(null);
  useEffect(() => {
    if (model.state !== 'ready' || !chosen || !selected || !chosen.guard.ok) return;
    let live = true;
    void model.surrogate.field(fieldInput(grid.aspect, chosen.elements)).then((f) => {
      const cplus = f.cplus.map((v) => Math.max(0, Math.expm1(v)));
      if (live) setField({ id: selected, cplus });
    });
    return () => {
      live = false;
    };
  }, [model, chosen, selected, grid.aspect]);

  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const startCheck = () => {
    if (!chosen || !selected) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const id = selected;
    setCheck({ state: 'running', id, done: 0, total: CHECK_RUN.spinUp + CHECK_RUN.average });
    runCheck(
      { aspect, elements: chosen.elements, ...CHECK_RUN },
      (done, total) => setCheck({ state: 'running', id, done, total }),
      ctl.signal,
    ).then(
      (result) => setCheck({ state: 'done', id, result }),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') setCheck({ state: 'idle' });
        else setCheck({ state: 'failed', id, message: String(e) });
      },
    );
  };

  const describe = (s: Omit<Scored, 'design'>) => {
    const first = s.elements[0];
    if (!first) return { kind: t('tradeOff.legendBare'), size: '' };
    const m = (v: number) => num(v * heightM, 1);
    const lam = num(first.lamH / heightM, 2);
    if (first.kind === 'hedge') {
      return {
        kind: t('tradeOff.kindHedge'),
        size: t('tradeOff.hedgeSize', { h: m(first.z1), w: m(first.x1 - first.x0), lam }),
      };
    }
    const rows = 'design' in s ? (s as Scored).design.rows : s.elements.length;
    const kind =
      rows === 2 && s.elements.length === 1
        ? t('tradeOff.kindCanopy')
        : s.elements.length === 2
          ? t('tradeOff.kindRows')
          : t('tradeOff.kindRow');
    return {
      kind,
      size: t('tradeOff.treeSize', {
        z0: m(first.z0),
        z1: m(first.z1),
        w: m(first.x1 - first.x0),
        lam,
      }),
    };
  };

  const points: ParetoPoint[] = [];
  if (found) {
    found.others.forEach((p, k) =>
      points.push({ id: `o${k}`, x: p.heat, y: 100 * p.fumes, kind: 'other' }),
    );
    found.front.forEach((p, k) =>
      points.push({
        id: `f${k}`,
        x: p.heat,
        y: 100 * p.fumes,
        kind: 'front',
        label: pickIds[`f${k}`],
      }),
    );
    if (found.bare) points.push({ id: 'bare', x: found.bare.heat, y: 100, kind: 'bare' });
    if (found.mine?.guard.ok) {
      points.push({ id: 'mine', x: found.mine.heat, y: 100 * found.mine.fumes, kind: 'mine' });
    }
  }
  const pointById = (id: string): Omit<Scored, 'design'> | null => {
    if (!found) return null;
    if (id === 'mine') return found.mine;
    const k = Number(id.slice(1));
    return id.startsWith('f') ? (found.front[k] ?? null) : (found.others[k] ?? null);
  };

  const backendName =
    model.state === 'ready' && model.surrogate.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly';
  const bareNow = datasetBare(aspect);

  return (
    <Screen title={t('tradeOff.title')} intro={t('tradeOff.intro')}>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {model.state === 'missing' && (
            <p className="rounded-md border border-line px-3 py-2" role="note">
              {t('tradeOff.missing')}
            </p>
          )}
          {model.state === 'checking' && <p className="text-ink-muted">{t('tradeOff.loading')}</p>}
          {model.state === 'failed' && (
            <p className="rounded-md border border-line px-3 py-2" role="alert">
              {t('tradeOff.failed', { message: model.message })}
            </p>
          )}
          {model.state === 'ready' && (
            <>
              <p className="text-sm text-ink-muted">
                {t('tradeOff.backend', { backend: backendName })}
              </p>
              <p className="mt-1 text-sm" role="status">
                {generation !== null
                  ? t('tradeOff.searching', { g: generation, n: SEARCH.generations })
                  : found
                    ? t('tradeOff.searched', { n: found.scored, front: found.front.length })
                    : ''}
              </p>
              {found?.mine && !found.mine.guard.ok && (
                <p className="mt-2 rounded-md border border-line px-3 py-2" role="note">
                  {t('tradeOff.mineOutside')}
                </p>
              )}
              {found && (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <SimulatedTag />
                  </div>
                  <ParetoChart
                    title={t('tradeOff.chartTitle')}
                    xLabel={t('tradeOff.xLabel')}
                    yLabel={t('tradeOff.yLabel')}
                    points={points}
                    legend={{
                      front: t('tradeOff.legendFront'),
                      other: t('tradeOff.legendOther'),
                      bare: t('tradeOff.legendBare'),
                      mine: t('tradeOff.legendMine'),
                    }}
                    selected={selected}
                    onSelect={(id) => {
                      setSelected(id);
                      setCheck({ state: 'idle' });
                    }}
                    describe={(id) => {
                      const p = pointById(id);
                      if (id === 'bare' || !p) return t('tradeOff.legendBare');
                      return (
                        <>
                          <span className="font-bold">{describe(p).kind}</span>
                          <br />
                          {num(p.heat, 1)} °C · {pct(p.fumes)}
                        </>
                      );
                    }}
                    table={{
                      columns: [
                        t('tradeOff.tableDesign'),
                        t('tradeOff.tableHeat'),
                        t('tradeOff.tableFumes'),
                      ],
                      rows: found.front.map((p, k) => [
                        `${pickIds[`f${k}`] ? `${pickIds[`f${k}`]}: ` : ''}${describe(p).kind}; ${describe(p).size}`,
                        num(p.heat, 1),
                        num(100 * p.fumes),
                      ]),
                    }}
                    formatX={(v) => num(v, 1)}
                    formatY={(v) => num(v)}
                  />
                  <section aria-labelledby="picks" className="mt-6">
                    <h2 id="picks" className="font-bold">
                      {t('tradeOff.picks')}
                    </h2>
                    <p className="mt-1 text-sm text-ink-muted">{t('tradeOff.picksHelp')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ['coolest', 'tradeOff.pickCoolest'],
                          ['cleanest', 'tradeOff.pickCleanest'],
                          ['balanced', 'tradeOff.pickBalanced'],
                        ] as const
                      ).map(([key, label]) => {
                        const p = best?.[key] ?? null;
                        const k = p ? found.front.indexOf(p) : -1;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={k < 0}
                            onClick={() => {
                              setSelected(`f${k}`);
                              setCheck({ state: 'idle' });
                            }}
                            className="min-h-11 rounded-md border border-line px-3 py-2 text-left disabled:opacity-50 aria-pressed:border-accent aria-pressed:bg-accent-soft"
                            aria-pressed={selected === `f${k}`}
                          >
                            {t(label)}
                          </button>
                        );
                      })}
                    </div>
                    {best && !best.coolest && (
                      <p className="mt-2 text-sm">{t('tradeOff.noCoolest')}</p>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </div>

        <div>
          <section aria-labelledby="tradeoff-street">
            <h2 id="tradeoff-street" className="font-bold">
              {t('tradeOff.street')}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {preset
                ? lang === 'en'
                  ? preset.label_en
                  : preset.label_tc
                : t('tradeOff.streetTunnel')}
            </p>
            <label htmlFor="tradeoff-aspect" className="mt-3 block text-sm font-bold">
              {t('tradeOff.aspect')}: <span className="font-mono">{num(draft, 1)}</span>
            </label>
            <input
              id="tradeoff-aspect"
              type="range"
              min={ASPECT_MIN}
              max={aspectMax}
              step={0.1}
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={() => setAspect(draft)}
              onKeyUp={() => setAspect(draft)}
              onBlur={() => setAspect(draft)}
              className="mt-1 w-full accent-[var(--accent)]"
            />
          </section>
          <HeatControls
            days={days}
            dayKey={dayKey}
            onDay={setDayKey}
            hour={hour}
            onHour={setHour}
            axis={axis}
            onAxis={preset ? null : setAxis}
          />
        </div>
      </div>

      {chosen && selected && (
        <section aria-labelledby="chosen" className="mt-8 max-w-[42rem]">
          <h2 id="chosen" className="flex items-center gap-2 font-bold">
            {selected === 'mine' ? t('tradeOff.legendMine') : t('tradeOff.selected')}{' '}
            <SimulatedTag />
          </h2>
          <p className="mt-1">{describe(chosen).kind}</p>
          <p className="text-sm text-ink-muted">{describe(chosen).size}</p>
          {!chosen.guard.ok ? (
            <p className="mt-2 rounded-md border border-line px-3 py-2" role="note">
              {t('tradeOff.outside')}
            </p>
          ) : (
            <>
              <dl className="mt-3 text-sm">
                {chosen.utci && (
                  <div className="flex justify-between gap-4 border-t border-line py-2">
                    <dt className="text-ink-muted">{t('tradeOff.heat')}</dt>
                    <dd className="text-right font-mono">
                      {t('tradeOff.heatValue', {
                        a: num(chosen.utci.A, 1),
                        b: num(chosen.utci.B, 1),
                      })}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 border-t border-line py-2">
                  <dt className="text-ink-muted">{t('tradeOff.fumes')}</dt>
                  <dd className="text-right font-mono">
                    {t('tradeOff.fumesValue', {
                      a: `${pct(chosen.ratioRange.A[0])}–${pct(chosen.ratioRange.A[1])}`,
                      b: `${pct(chosen.ratioRange.B[0])}–${pct(chosen.ratioRange.B[1])}`,
                    })}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-line py-2">
                  <dt className="text-ink-muted">{t('tradeOff.wind')}</dt>
                  <dd className="text-right font-mono">
                    {t('tradeOff.windValue', { a: pct(chosen.wind.A), b: pct(chosen.wind.B) })}
                  </dd>
                </div>
              </dl>
              <p className="mt-1 text-sm text-ink-muted">{t('tradeOff.uncertainty')}</p>
              {field && field.id === selected && (
                <figure className="mt-4">
                  <figcaption className="text-sm font-bold">{t('tradeOff.field')}</figcaption>
                  <div className="mt-2">
                    <FieldPreview
                      cplus={field.cplus}
                      widthH={grid.width}
                      elements={chosen.elements}
                      cmax={niceMax(field.cplus)}
                      label={t('tradeOff.field')}
                    />
                  </div>
                  <FumesLegend cmax={niceMax(field.cplus)} />
                </figure>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  className="inline-flex min-h-11 items-center rounded-md border border-line px-3 py-2 underline-offset-4 hover:underline"
                  href={`#/design?${new URLSearchParams({
                    ...(preset ? { street: preset.key } : {}),
                    aspect: String(aspect),
                    layout: encodeLayout(chosen.elements),
                  }).toString()}`}
                >
                  {t('tradeOff.openDesign')}
                </a>
                {check.state === 'running' && check.id === selected ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-md border border-line px-3 py-2"
                    onClick={() => abort.current?.abort()}
                  >
                    {t('tradeOff.checkStop')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="min-h-11 rounded-md border border-accent bg-accent-soft px-3 py-2"
                    onClick={startCheck}
                  >
                    {t('tradeOff.check')}
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm text-ink-muted">
                {t('tradeOff.checkHelp', {
                  steps: (CHECK_RUN.spinUp + CHECK_RUN.average).toLocaleString(locale),
                })}
              </p>
              {check.state === 'running' && check.id === selected && (
                <p className="mt-2 text-sm" role="status">
                  {t('tradeOff.checkRunning', { p: Math.floor((100 * check.done) / check.total) })}
                </p>
              )}
              {check.state === 'failed' && check.id === selected && (
                <p className="mt-2 text-sm" role="alert">
                  {t('tradeOff.checkFailed', { message: check.message })}
                </p>
              )}
              {check.state === 'done' && check.id === selected && (
                <CheckTable
                  result={check.result}
                  predicted={chosen}
                  bare={bareNow ? { A: bareNow.exposure[0], B: bareNow.exposure[1] } : null}
                  pct={pct}
                />
              )}
            </>
          )}
        </section>
      )}
    </Screen>
  );
}

function CheckTable({
  result,
  predicted,
  bare,
  pct,
}: {
  result: CheckResult;
  predicted: Omit<Scored, 'design'>;
  bare: { A: number; B: number } | null;
  pct: (v: number) => string;
}) {
  const { t } = useI18n();
  const solver = meanOfHalves(result.exposure);
  const wind = meanOfHalves(result.wind);
  const filling = result.retained[1] > FILLING;
  return (
    <figure className="mt-4">
      <figcaption className="flex items-center gap-2 text-sm font-bold">
        {t('tradeOff.checkTitle')} <SimulatedTag />
      </figcaption>
      {bare ? (
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-1 pr-2 font-normal" />
              <th className="py-1 pr-2 font-bold">{t('tradeOff.ai')}</th>
              <th className="py-1 font-bold">{t('tradeOff.solver')}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {(['A', 'B'] as const).map((side) => (
              <tr key={side} className="border-t border-line">
                <th className="py-1 pr-2 font-sans font-normal text-ink-muted">
                  {t(side === 'A' ? 'exposure.left' : 'exposure.right')}
                </th>
                <td className="py-1 pr-2">
                  {pct(predicted.ratioRange[side][0])}–{pct(predicted.ratioRange[side][1])}
                </td>
                <td className="py-1">{pct(solver[side] / bare[side])}</td>
              </tr>
            ))}
            {(['A', 'B'] as const).map((side) => (
              <tr key={`w${side}`} className="border-t border-line">
                <th className="py-1 pr-2 font-sans font-normal text-ink-muted">
                  {t('tradeOff.wind')} ({t(side === 'A' ? 'exposure.left' : 'exposure.right')})
                </th>
                <td className="py-1 pr-2">{pct(predicted.wind[side])}</td>
                <td className="py-1">{pct(wind[side])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-sm">{t('tradeOff.checkNoBare')}</p>
      )}
      {filling && <p className="mt-2 text-sm">{t('tradeOff.checkFilling')}</p>}
    </figure>
  );
}
