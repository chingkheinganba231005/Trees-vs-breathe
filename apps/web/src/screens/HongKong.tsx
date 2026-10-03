import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/context';

export function HongKong() {
  const { t } = useI18n();
  return (
    <Screen title={t('hongKong.title')} intro={t('hongKong.intro')}>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">Roadside air quality</h2>
          <p className="mt-3 text-sm text-ink-muted">
            Street-level air pollution is often worse than the general-station background because vehicles
            release emissions close to people walking at the kerb.
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">Summer heat stress</h2>
          <p className="mt-3 text-sm text-ink-muted">
            The hottest afternoons are when the sun is low, the street traps the heat, and the pavement
            stays warm after the air has started to cool.
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">Ventilation assessment</h2>
          <p className="mt-3 text-sm text-ink-muted">
            Hong Kong already checks air ventilation for major developments. This app adds a street-tree
            check at the scale a community can actually test before planting.
          </p>
        </article>
      </div>
      <div className="mt-8 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-lg font-bold">Street atlas</h2>
        <p className="mt-3 text-sm text-ink-muted">
          The street atlas is a stretch goal: a map of many Hong Kong streets, each one coloured by its
          recommended planting and the reason the model would choose it.
        </p>
      </div>
    </Screen>
  );
}
