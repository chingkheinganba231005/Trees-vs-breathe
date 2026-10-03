import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/context';

function Card({
  name,
  badge,
  summary,
  heat,
  fumes,
  reason,
}: {
  name: string;
  badge: string;
  summary: string;
  heat: string;
  fumes: string;
  reason: string;
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
          <dt className="text-ink-muted">Heat</dt>
          <dd className="font-medium">{heat}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Fumes</dt>
          <dd className="font-medium">{fumes}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm">
        <span className="font-bold">Why:</span> {reason}
      </p>
    </article>
  );
}

export function Compare() {
  const { t } = useI18n();
  return (
    <Screen title={t('compare.title')} intro={t('compare.intro')}>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card
          name="No trees"
          badge="baseline"
          summary="Open street with no planting. This is the reference the model compares against."
          heat="Higher heat"
          fumes="Lower fumes"
          reason="The street is open to the wind, so air clears quickly, but the pavement stays hotter."
        />
        <Card
          name="Local tree row"
          badge="balanced"
          summary="A typical roadside tree row along the kerb. It adds shade while preserving some ventilation."
          heat="Lower heat"
          fumes="Moderate fumes"
          reason="The crown cools the pavement, but the drag slows the flushing flow enough to matter."
        />
        <Card
          name="Dense tree row"
          badge="trade-off"
          summary="Dense crowns near the walls shorten the opening for the street vortex."
          heat="Much lower heat"
          fumes="Higher fumes"
          reason="The shade spread is strong, but the airflow is choked and the street keeps more pollution near the pavement."
        />
        <Card
          name="Trees + hedge"
          badge="mixed"
          summary="A hedge can block the most exposed part of the pavement while trees still cool the sunniest zones."
          heat="Lower heat"
          fumes="Mixed"
          reason="The hedge modifies the near-wall flow and can improve both outcomes on the right street, which is a real finding rather than a contradiction."
        />
      </div>
      <div className="mt-8 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-lg font-bold">How to choose</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>Prefer the design that sits closest to the frontier for the street you actually have.</li>
          <li>Only choose a point beyond the baseline if the forecasted heat and fumes both improve.</li>
          <li>Keep the reason short: which design to plant, where it sits in the street, and why it beats the alternatives.</li>
        </ul>
      </div>
    </Screen>
  );
}
