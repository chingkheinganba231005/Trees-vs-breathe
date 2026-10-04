import { Screen } from '../components/Screen';
import { SimulatedTag } from '../components/SimulatedTag';
import { atlas, atlasDesignLabel, atlasDesignLabelTc } from '../content/atlas';
import type { StreetAtlasRow } from '../content/results';
import { surrogateMetrics } from '../content/surrogate';
import { useI18n } from '../i18n/context';
import { useHashParam } from '../lib/router';

export function Report() {
  const { t, lang } = useI18n();
  const streetKey = useHashParam('street');
  const row: StreetAtlasRow | null = atlas().find((item) => item.key === streetKey) ?? atlas()[0] ?? null;
  const metrics = surrogateMetrics();
  const designLabel = row
    ? lang === 'en'
      ? atlasDesignLabel[row.recommendation]
      : atlasDesignLabelTc[row.recommendation]
    : '—';
  return (
    <Screen title={t('report.title')} intro={t('report.intro')}>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="flex items-center gap-2 text-lg font-bold">{t('report.decision')} <SimulatedTag /></h2>
          <p className="mt-3 text-sm text-ink-muted">
            {row
              ? t('report.recommendation', {
                  street: lang === 'en' ? row.label_en : row.label_tc,
                  design: designLabel,
                  status: row.status === 'physics_required' ? t('report.physicsRequired') : t('report.screened'),
                })
              : t('report.noStreet')}
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">{t('report.evidence')}</h2>
          <p className="mt-3 text-sm text-ink-muted">
            {t('report.evidenceText')}
          </p>
          {metrics?.scalar.test.exposure && (
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-ink-muted">R²</dt><dd className="font-mono">{metrics.scalar.test.exposure.r2.toFixed(2)}</dd></div>
              <div><dt className="text-ink-muted">{t('report.medianError')}</dt><dd className="font-mono">{(metrics.scalar.test.exposure.median_relative_error * 100).toFixed(1)}%</dd></div>
              <div><dt className="text-ink-muted">FAC2</dt><dd className="font-mono">{metrics.scalar.test.exposure.fac2.toFixed(2)}</dd></div>
            </dl>
          )}
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">{t('report.why')}</h2>
          <p className="mt-3 text-sm text-ink-muted">
            {row ? t('report.whyText', { design: designLabel }) : t('report.noChoice')}
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">{t('report.leftOut')}</h2>
          <p className="mt-3 text-sm text-ink-muted">
            {t('report.leftOutText')}
          </p>
        </article>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-6 text-base font-bold text-accent-ink"
        >
          {t('report.print')}
        </button>
      </div>
    </Screen>
  );
}
