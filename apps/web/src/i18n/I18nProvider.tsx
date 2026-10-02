import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nContext } from './context';
import type { I18n } from './context';
import { detectLang, format, strings } from './strings';
import type { Lang } from './strings';

const STORAGE_KEY = 'tvb-lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-Hant') return saved;
  } catch {
    // Storage can be blocked in private mode; fall through to the browser language.
  }
  return detectLang(navigator.languages.length > 0 ? navigator.languages : [navigator.language]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant-HK';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is fine; the choice still applies for this visit.
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, vars) => format(strings[lang][key], vars) }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
