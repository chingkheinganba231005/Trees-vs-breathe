import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/context';

export function Report() {
  const { t } = useI18n();
  return (
    <Screen title={t('report.title')} intro={t('report.intro')}>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">Decision</h2>
          <p className="mt-3 text-sm text-ink-muted">
            Choose the planting that meets the street's practical constraint and the user's goal: cooling
            the pavement without trapping pollution at the kerb.
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">Evidence</h2>
          <p className="mt-3 text-sm text-ink-muted">
            The model is checked against textbook flow cases, wind-tunnel comparisons and the street-canyon
            flow regime that the app uses at the chosen aspect ratio.
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">Why this planting</h2>
          <p className="mt-3 text-sm text-ink-muted">
            The app should state the reason in one sentence: which design is chosen, where it sits in the
            street, and why the trade-off is acceptable for this case.
          </p>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-bold">What the model leaves out</h2>
          <p className="mt-3 text-sm text-ink-muted">
            A final report should also list the physical effects that are not included, so the decision stays
            honest and transparent.
          </p>
        </article>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-6 text-base font-bold text-accent-ink"
        >
          Print summary
        </button>
      </div>
    </Screen>
  );
}
