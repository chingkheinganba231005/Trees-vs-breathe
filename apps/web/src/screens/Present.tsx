import { useEffect } from 'react';
import { PhaseNote } from '../components/PhaseNote';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';

export function Present() {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.location.hash = href('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{t('present.title')}</h1>
        <p className="mt-6 text-xl leading-relaxed text-ink-muted">{t('present.intro')}</p>
        <PhaseNote phase={6} />
        <p className="mt-10">
          <a
            href={href('/')}
            className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
          >
            {t('notFound.back')}
          </a>
        </p>
      </div>
    </main>
  );
}
