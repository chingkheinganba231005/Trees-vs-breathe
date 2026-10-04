import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';

const slideRoutes = [
  '/design',
  '/street',
  '/design',
  '/trade-off',
  '/how-we-know',
  '/report',
] as const;

export function Present() {
  const { t } = useI18n();
  const [slide, setSlide] = useState(0);
  const total = 6;
  const slides = useMemo(
    () =>
      Array.from({ length: total }, (_, index) => ({
        title: t(`present.slide${index + 1}.title` as Parameters<typeof t>[0]),
        body: t(`present.slide${index + 1}.body` as Parameters<typeof t>[0]),
      })),
    [t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.location.hash = href('/');
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        setSlide((current) => Math.min(total - 1, current + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setSlide((current) => Math.max(0, current - 1));
      } else if (e.key === 'Home') {
        setSlide(0);
      } else if (e.key === 'End') {
        setSlide(total - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = slides[slide]!;
  return (
    <main className="min-h-dvh bg-bg px-5 py-6 text-ink sm:px-10 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent">
            {t('app.name')}
          </p>
          <a
            className="min-h-11 rounded-md px-3 py-2 text-sm text-ink-muted underline underline-offset-4"
            href={href('/')}
          >
            {t('present.exit')}
          </a>
        </header>

        <section
          aria-live="polite"
          aria-label={t('present.title')}
          className="flex flex-1 flex-col justify-center py-12 sm:py-16"
        >
          <p className="text-sm font-medium text-ink-muted">
            {t('present.step', { current: slide + 1, total })}
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-bold tracking-tight sm:text-7xl">
            {current.title}
          </h1>
          <p className="mt-8 max-w-3xl text-xl leading-relaxed text-ink-muted sm:text-2xl">
            {current.body}
          </p>
          <p className="mt-8">
            <a
              className="inline-flex min-h-11 items-center rounded-md border border-accent px-4 py-2 font-medium text-accent"
              href={href(slideRoutes[slide]!)}
            >
              {t('present.open')}
            </a>
          </p>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
          <div
            className="flex items-center gap-2"
            aria-label={t('present.step', { current: slide + 1, total })}
          >
            {slides.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={t('present.step', { current: index + 1, total })}
                aria-current={index === slide ? 'step' : undefined}
                className={`size-3 rounded-full border border-accent ${
                  index === slide ? 'bg-accent' : 'bg-transparent'
                }`}
                onClick={() => setSlide(index)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md border border-line px-4 py-2 disabled:opacity-40"
              disabled={slide === 0}
              onClick={() => setSlide((current) => Math.max(0, current - 1))}
            >
              {t('present.previous')}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-40"
              disabled={slide === total - 1}
              onClick={() => setSlide((current) => Math.min(total - 1, current + 1))}
            >
              {t('present.next')}
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
