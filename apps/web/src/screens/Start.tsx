import { StreetSection } from '../components/StreetSection';
import type { SectionGeometry, SectionTree } from '../components/StreetSection';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';

// Illustration only (docs/assumptions.md A-001). No number here feeds a model;
// measured street presets replace it once the solver is live.
const illustrativeStreet: SectionGeometry = {
  buildingHeight: 30,
  streetWidth: 10,
  pavementLeft: 2,
  pavementRight: 2,
};
// Crown kept clear of the wall and high over the kerb, so the drawing never shows a design
// the constraints would forbid.
const illustrativeTree: SectionTree = { x: 1.8, crownWidth: 3, crownHeight: 4, crownBase: 5 };

export function Start() {
  const { t } = useI18n();
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 sm:px-6 md:grid-cols-[1.1fr_1fr] md:items-center md:py-16">
      <div>
        <h1 className="text-4xl leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl">
          {t('start.question')}
        </h1>
        <p className="mt-5 max-w-prose text-lg leading-relaxed text-ink-muted">{t('start.lede')}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={href('/street')}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-6 text-lg font-bold text-accent-ink hover:opacity-90"
          >
            {t('start.testStreet')}
          </a>
          <a
            href={href('/present')}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-accent px-6 text-lg font-bold text-accent hover:bg-accent-soft"
          >
            {t('start.present')}
          </a>
        </div>
        <p className="mt-8 font-mono text-sm text-ink-muted">{t('start.method')}</p>
      </div>
      <figure className="rounded-xl border border-line bg-surface p-4">
        <StreetSection
          geometry={illustrativeStreet}
          trees={[illustrativeTree]}
          className="mx-auto block max-h-[60vh] w-full"
        />
        <figcaption className="mt-3 text-sm text-ink-muted">{t('start.illustration')}</figcaption>
      </figure>
    </section>
  );
}
