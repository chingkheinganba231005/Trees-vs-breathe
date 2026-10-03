import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { RunRow, StreetRun } from '../content/streetRuns';
import { useI18n } from '../i18n/context';
import { cropFor, drawRecorded, recordedCmax } from '../sim/recorded';
import { readSimColors } from '../sim/view';
import { FumesLegend } from './FumesLegend';
import { SimulatedTag } from './SimulatedTag';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const themeSnapshot = () => document.documentElement.getAttribute('data-theme') ?? 'light';

function Picture({
  run,
  row,
  cmax,
  label,
}: {
  run: StreetRun;
  row: RunRow;
  cmax: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useSyncExternalStore(subscribe, themeSnapshot, () => 'light');
  const crop = cropFor(run, row);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const crop = cropFor(run, row);
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      drawRecorded(ctx, run, row, crop, readSimColors(), cmax);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
    // The theme changes the colours read inside draw.
  }, [run, row, cmax, theme]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="w-full rounded-md border border-line"
      style={{ aspectRatio: `${crop.x1 - crop.x0} / ${crop.top}` }}
    />
  );
}

/**
 * A preset street run on Colab at its measured shape (python -m treesvb.streetruns): the mean
 * fumes and flow for each design, and the pavement readings. Shown beside the live view when the
 * live model cannot take the street's true shape (D-030).
 */
export function RecordedRun({ run, name }: { run: StreetRun; name: string }) {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const sig = (v: number) => v.toLocaleString(locale, { maximumSignificantDigits: 2 });
  const pct = (v: number) =>
    v.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'always' });
  const cmax = recordedCmax(run);
  const date = new Date(run.generated_at).toLocaleDateString(locale, { dateStyle: 'long' });
  const rows = run.rows.filter((r) => r.healthy);
  const hedge = run.rows.find((r) => r.design === 'hedge')?.crowns?.[0];
  // A change smaller than how far the averages still moved is not established (settlingHelp).
  const established = rows.some(
    (r) =>
      r.ratio &&
      (['A', 'B'] as const).some((k) => Math.abs(r.ratio![k] - 1) > (r.settling ?? Infinity)),
  );
  const moved = Math.max(...rows.map((r) => r.settling ?? 0));
  return (
    <section
      aria-labelledby="recorded"
      className="mt-8 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="recorded" className="font-bold">
          {t('recorded.title', { name, ratio: sig(run.aspect_h_over_w) })}
        </h2>
        <SimulatedTag />
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {t('recorded.intro', { h: run.height_cells, w: run.width_cells })}
      </p>
      {!established && (
        <p className="mt-3 rounded-md border border-line px-3 py-2 text-sm" role="note">
          {t('recorded.notSettled', {
            p: moved.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 }),
          })}
        </p>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4">
        {rows.map((r) => (
          <figure key={r.design}>
            <Picture run={run} row={r} cmax={cmax} label={t(`recorded.${r.design}`)} />
            <figcaption className="mt-1 text-center text-sm">
              {t(`recorded.${r.design}`)}
            </figcaption>
          </figure>
        ))}
      </div>
      <FumesLegend cmax={cmax} caption={t('recorded.legend')} />
      <p className="mt-1 text-xs text-ink-muted">{t('recorded.key')}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1 pr-2 font-normal">{t('recorded.design')}</th>
              <th className="py-1 pr-2 text-right font-normal">{t('exposure.left')}</th>
              <th className="py-1 pr-2 text-right font-normal">{t('exposure.right')}</th>
              <th className="py-1 text-right font-normal">{t('recorded.settling')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => (
              <tr key={r.design} className="border-t border-line">
                <td className="py-1 pr-2 font-sans">{t(`recorded.${r.design}`)}</td>
                {(['A', 'B'] as const).map((side) => (
                  <td key={side} className="py-1 pr-2 text-right">
                    c⁺ {sig(r.pavement![side])}
                    {r.ratio && (
                      <span className="block text-xs text-ink-muted">{pct(r.ratio[side] - 1)}</span>
                    )}
                  </td>
                ))}
                <td className="py-1 text-right">
                  {r.settling!.toLocaleString(locale, {
                    style: 'percent',
                    maximumFractionDigits: 0,
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        {t('recorded.method', {
          tree: sig(run.local_tree.height_m),
          spread: sig(run.local_tree.spread_m),
          hh: sig(hedge ? hedge.z1 * run.height_m : 0),
          hw: sig(hedge ? (hedge.x1 - hedge.x0) * run.height_m : 0),
          zw: sig(run.zone_m.width),
          z0: sig(run.zone_m.z0),
          z1: sig(run.zone_m.z1),
        })}
      </p>
      <p className="mt-2 text-sm text-ink-muted">{t('recorded.settlingHelp')}</p>
      <p className="mt-2 text-xs text-ink-muted">
        {t('recorded.source', { date, commit: run.commit.slice(0, 7) })}
      </p>
    </section>
  );
}
