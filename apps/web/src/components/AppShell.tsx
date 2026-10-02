import { useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { href, routes } from '../lib/router';
import type { Engine } from '../sim/engine';
import { useThemePreference } from '../theme/preference';
import type { ThemePreference } from '../theme/preference';

interface Props {
  route: string;
  engine: Engine;
  children: ReactNode;
}

const themeOptions: ThemePreference[] = ['light', 'dark', 'system'];

export function AppShell({ route, engine, children }: Props) {
  const { t, lang, setLang } = useI18n();
  // The menu belongs to the route it was opened on, so navigating closes it.
  const [menuRoute, setMenuRoute] = useState<string | null>(null);
  const menuOpen = menuRoute === route;
  const [theme, setTheme] = useThemePreference();

  const navLinks = routes.filter((r) => r.path !== '/present');

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('nav.skip')}
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <a href={href('/')} className="flex min-h-11 items-center gap-2 font-bold tracking-tight">
            <span aria-hidden="true" className="inline-block size-3 rounded-full bg-accent" />
            {t('app.name')}
          </a>
          <nav aria-label={t('nav.menu')} className="ml-6 hidden flex-1 lg:block">
            <ul className="flex gap-1">
              {navLinks.slice(1).map((r) => (
                <li key={r.path}>
                  <a
                    href={href(r.path)}
                    aria-current={route === r.path ? 'page' : undefined}
                    className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-ink-muted hover:text-ink aria-[current=page]:font-bold aria-[current=page]:text-accent"
                  >
                    {t(r.label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'zh-Hant' : 'en')}
              aria-label={t('lang.switchLabel')}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm hover:bg-surface-2"
            >
              {t('lang.switchTo')}
            </button>
            <button
              type="button"
              onClick={() => setMenuRoute(menuOpen ? null : route)}
              aria-expanded={menuOpen}
              aria-controls="phone-menu"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm font-bold hover:bg-surface-2 lg:hidden"
            >
              {menuOpen ? t('nav.close') : t('nav.menu')}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="phone-menu"
            aria-label={t('nav.menu')}
            className="border-t border-line lg:hidden"
          >
            <ul className="mx-auto max-w-6xl px-2 py-2">
              {routes.map((r) => (
                <li key={r.path}>
                  <a
                    href={href(r.path)}
                    aria-current={route === r.path ? 'page' : undefined}
                    className="flex min-h-12 items-center rounded-md px-3 text-lg hover:bg-surface-2 aria-[current=page]:font-bold aria-[current=page]:text-accent"
                  >
                    {t(r.label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>

      <footer className="border-t border-line text-sm text-ink-muted">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-1">
            <p>{t('footer.simulated')}</p>
            <p className="font-mono text-xs">
              {t('footer.engine', { engine: t(engine === 'gpu' ? 'engine.gpu' : 'engine.cpu') })} ·{' '}
              {t('footer.build', { commit: __APP_COMMIT__ })}
            </p>
          </div>
          <fieldset className="flex items-center gap-1">
            <legend className="sr-only">{t('theme.label')}</legend>
            {themeOptions.map((opt) => (
              <label
                key={opt}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-3 has-[:checked]:bg-surface-2 has-[:checked]:font-bold has-[:checked]:text-ink has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="radio"
                  name="theme"
                  value={opt}
                  checked={theme === opt}
                  onChange={() => setTheme(opt)}
                  className="sr-only"
                />
                {t(`theme.${opt}`)}
              </label>
            ))}
          </fieldset>
        </div>
      </footer>
    </div>
  );
}
