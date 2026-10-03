import { useI18n } from '../i18n/context';
import type { Comparison } from '../sim/exposure';
import type { SimStats } from '../sim/streetSim';
import { SimulatedTag } from './SimulatedTag';

interface Props {
  stats: SimStats | null;
  comparison: Comparison | null;
  hasBaseline: boolean;
}

/** Fumes at breathing height on the two pavements, and the change against the bare street. */
export function ExposurePanel({ stats, comparison, hasBaseline }: Props) {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const num = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 0 });
  const pct = (v: number) =>
    v.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'always' });
  const range = ([lo, hi]: [number, number]) =>
    Math.abs(hi - lo) < 0.005 ? pct(lo) : t('exposure.range', { lo: pct(lo), hi: pct(hi) });

  const settling = stats !== null && stats.meanSteps < stats.settleSteps;
  const progress = stats ? Math.min(1, stats.meanSteps / Math.max(1, stats.settleSteps)) : 0;

  const row = (side: 'A' | 'B') => (
    <div key={side} className="border-t border-line py-2">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-muted">{t(side === 'A' ? 'exposure.left' : 'exposure.right')}</dt>
        <dd className="text-right font-mono">
          {stats?.exposure ? `c⁺ ${num(stats.exposure[side])}` : '…'}
        </dd>
      </div>
      {comparison && stats && stats.greenCount > 0 && (
        <p className="mt-1 text-right text-sm">
          {t('exposure.vsBaseline', { range: range(comparison[side]) })}
        </p>
      )}
    </div>
  );

  return (
    <section
      aria-labelledby="exposure"
      className="mt-6 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <h2 id="exposure" className="font-bold">
          {t('exposure.title')}
        </h2>
        <SimulatedTag />
      </div>
      <dl className="mt-2 text-sm">
        {row('A')}
        {row('B')}
      </dl>
      <p className="mt-2 text-sm" role="status">
        {settling
          ? t('exposure.settling', {
              p: progress.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 }),
            })
          : stats && stats.greenCount > 0 && !hasBaseline
            ? t('exposure.needBaseline')
            : stats && stats.greenCount === 0
              ? t('exposure.baselineReady')
              : null}
      </p>
      <p className="mt-2 text-sm text-ink-muted">{t('exposure.help')}</p>
    </section>
  );
}
