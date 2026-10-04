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
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
          Street atlas <SimulatedTag />
        </h2>
        <p className="mt-3 text-sm text-ink-muted">
          Three measured streets screened through four fixed planting configurations. Results are simulated;
          Wing Lok Street is outside the trained aspect-ratio range and must be checked with physics.
        </p>
        {rows.length > 0 && (
          <div className="mt-4 grid gap-3">
            {rows.map((row) => (
              <article key={row.key} className="rounded-lg border border-line bg-canvas p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{lang === 'en' ? row.label_en : row.label_tc}</h3>
                    <p className="mt-1 text-xs text-ink-muted">
                      H/W {row.measured_aspect_h_over_w.toFixed(2)}
                      {row.out_of_distribution
                        ? ` · live model screened at H/W ${row.model_aspect_h_over_w.toFixed(2)}`
                        : ''}
                    </p>
                  </div>
                  <span className="rounded-full border border-line px-2 py-1 text-xs font-bold">
                    {row.status === 'physics_required' ? 'Physics required' : 'Surrogate screened'}
                  </span>
                </div>
                <p className="mt-3 text-sm">
                  Screened recommendation: <strong>{label(row.recommendation)}</strong>
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {row.candidates.map((candidate) => (
                    <div key={candidate.design} className="rounded border border-line p-2 text-xs">
                      <div className="font-bold">{label(candidate.design)}</div>
                      <div className="mt-1 text-ink-muted">
                        {candidate.guard.ok ? 'Inside guard' : 'Outside guard'}
                      </div>
                      <div className="mt-1 text-ink-muted">
                        Shade proxy {candidate.shade_proxy.toLocaleString(undefined, {
                          style: 'percent',
                          maximumFractionDigits: 1,
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
