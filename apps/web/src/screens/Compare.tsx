import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/context';

function Card({
  name,
  badge,
  summary,
  heat,
  fumes,
  reason,
  heatLabel,
  fumesLabel,
  whyLabel,
}: {
  name: string;
  badge: string;
  summary: string;
  heat: string;
  fumes: string;
  reason: string;
  heatLabel: string;
  fumesLabel: string;
  whyLabel: string;
}) {
  return (
    <article className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{name}</h2>
        <span className="rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          {badge}
        </span>
      </div>
      <div className="mt-4 h-20 rounded-lg border border-line bg-[linear-gradient(180deg,rgba(22,163,74,0.10),rgba(148,163,184,0.05),rgba(88,28,135,0.10))]" />
      <p className="mt-4 text-sm text-ink-muted">{summary}</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">{heatLabel}</dt>
          <dd className="font-medium">{heat}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">{fumesLabel}</dt>
          <dd className="font-medium">{fumes}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm">
        <span className="font-bold">{whyLabel}</span> {reason}
      </p>
    </article>
  );
}

export function Compare() {
  const { t } = useI18n();
  const heatLabel = t('compare.heat');
  const fumesLabel = t('compare.fumes');
  const whyLabel = t('compare.why');
  return (
    <Screen title={t('compare.title')} intro={t('compare.intro')}>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card
          name={t('compare.none.name')}
          badge={t('compare.none.badge')}
          summary={t('compare.none.summary')}
          heat={t('compare.none.heat')}
          fumes={t('compare.none.fumes')}
          reason={t('compare.none.reason')}
          heatLabel={heatLabel}
          fumesLabel={fumesLabel}
          whyLabel={whyLabel}
        />
        <Card
          name={t('compare.local.name')}
          badge={t('compare.local.badge')}
          summary={t('compare.local.summary')}
          heat={t('compare.local.heat')}
          fumes={t('compare.local.fumes')}
          reason={t('compare.local.reason')}
          heatLabel={heatLabel}
          fumesLabel={fumesLabel}
          whyLabel={whyLabel}
        />
        <Card
          name={t('compare.dense.name')}
          badge={t('compare.dense.badge')}
          summary={t('compare.dense.summary')}
          heat={t('compare.dense.heat')}
          fumes={t('compare.dense.fumes')}
          reason={t('compare.dense.reason')}
          heatLabel={heatLabel}
          fumesLabel={fumesLabel}
          whyLabel={whyLabel}
        />
        <Card
          name={t('compare.mixed.name')}
          badge={t('compare.mixed.badge')}
          summary={t('compare.mixed.summary')}
          heat={t('compare.mixed.heat')}
          fumes={t('compare.mixed.fumes')}
          reason={t('compare.mixed.reason')}
          heatLabel={heatLabel}
          fumesLabel={fumesLabel}
          whyLabel={whyLabel}
        />
      </div>
      <div className="mt-8 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-lg font-bold">{t('compare.howTitle')}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>{t('compare.howFrontier')}</li>
          <li>{t('compare.howBaseline')}</li>
          <li>{t('compare.howReason')}</li>
        </ul>
      </div>
    </Screen>
  );
}
