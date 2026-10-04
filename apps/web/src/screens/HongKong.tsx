import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/context';
import { atlas, atlasDesignLabel, atlasDesignLabelTc } from '../content/atlas';
import { SimulatedTag } from '../components/SimulatedTag';

export function HongKong() {
  const { t, lang } = useI18n();
  const rows = atlas();
  const label = (design: keyof typeof atlasDesignLabel) =>
    lang === 'en' ? atlasDesignLabel[design] : atlasDesignLabelTc[design];
  return (
    <Screen title={t('hongKong.title')} intro={t('hongKong.intro')}>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">{t('hongKong.airTitle')}</h2>
          <p className="mt-3 text-sm text-ink-muted">
            {t('hongKong.airText')}
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">{t('hongKong.heatTitle')}</h2>
          <p className="mt-3 text-sm text-ink-muted">
            {t('hongKong.heatText')}
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">{t('hongKong.ventTitle')}</h2>
          <p className="mt-3 text-sm text-ink-muted">
            {t('hongKong.ventText')}
          </p>
        </article>
      </div>
      <div className="mt-8 rounded-xl border border-line bg-surface p-4">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
          {t('hongKong.atlasTitle')} <SimulatedTag />
        </h2>
        <p className="mt-3 text-sm text-ink-muted">
          {t('hongKong.atlasText')}
        </p>
        {rows.length > 0 && (
          <div className="mt-4 grid gap-3">
            {rows.map((row) => (
              <article key={row.key} className="rounded-lg border border-line bg-canvas p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{lang === 'en' ? row.label_en : row.label_tc}</h3>
                    <p className="mt-1 text-xs text-ink-muted">
                      {t('hongKong.aspect', { value: row.measured_aspect_h_over_w.toFixed(2) })}
                      {row.out_of_distribution
                        ? ` · ${t('hongKong.liveAspect', { value: row.model_aspect_h_over_w.toFixed(2) })}`
                        : ''}
                    </p>
                  </div>
                  <span className="rounded-full border border-line px-2 py-1 text-xs font-bold">
                    {row.status === 'physics_required' ? t('hongKong.physicsRequired') : t('hongKong.screened')}
                  </span>
                </div>
                <p className="mt-3 text-sm">
                  {t('hongKong.recommendation')}: <strong>{label(row.recommendation)}</strong>
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {row.candidates.map((candidate) => (
                    <div key={candidate.design} className="rounded border border-line p-2 text-xs">
                      <div className="font-bold">{label(candidate.design)}</div>
                      <div className="mt-1 text-ink-muted">
                        {candidate.guard.ok ? t('hongKong.insideGuard') : t('hongKong.outsideGuard')}
                      </div>
                      <div className="mt-1 text-ink-muted">
                        {t('hongKong.shadeProxy')} {candidate.shade_proxy.toLocaleString(undefined, {
                          style: 'percent',
                          maximumFractionDigits: 1,
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`#/design?street=${row.key}`}
                    className="inline-flex min-h-11 items-center rounded-md bg-accent px-3 font-bold text-accent-ink"
                  >
                    {t('hongKong.openDesign')}
                  </a>
                  <a
                    href={`#/trade-off?street=${row.key}`}
                    className="inline-flex min-h-11 items-center rounded-md border border-line px-3 font-bold"
                  >
                    {t('hongKong.openTradeOff')}
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
