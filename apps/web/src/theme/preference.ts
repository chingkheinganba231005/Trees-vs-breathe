import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tvb-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Blocked storage: follow the system setting.
  }
  return 'system';
}

function apply(pref: ThemePreference): void {
  const dark = window.matchMedia(DARK_QUERY).matches;
  document.documentElement.setAttribute('data-theme', resolveTheme(pref, dark));
}

export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const update = useCallback((next: ThemePreference) => {
    setPref(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is fine for one visit.
    }
  }, []);

  return [pref, update];
}
