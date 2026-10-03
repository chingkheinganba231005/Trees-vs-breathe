import { useSyncExternalStore } from 'react';
import type { StringKey } from '../i18n/strings';

// Hash routing keeps deep links working on GitHub Pages (no server rewrites) and offline.
export const routes = [
  { path: '/', label: 'nav.start', phase: 0 },
  { path: '/street', label: 'nav.street', phase: 3 },
  { path: '/design', label: 'nav.design', phase: 1 },
  { path: '/trade-off', label: 'nav.tradeOff', phase: 4 },
  { path: '/compare', label: 'nav.compare', phase: 5 },
  { path: '/how-we-know', label: 'nav.howWeKnow', phase: 5 },
  { path: '/hong-kong', label: 'nav.hongKong', phase: 5 },
  { path: '/report', label: 'nav.report', phase: 5 },
  { path: '/present', label: 'nav.present', phase: 6 },
] as const satisfies ReadonlyArray<{ path: string; label: StringKey; phase: number }>;

export type RoutePath = (typeof routes)[number]['path'];

export function parseHash(hash: string): string {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  if (path === '' || path === '/') return '/';
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.replace(/\/+$/, '');
}

export function isRoute(path: string): path is RoutePath {
  return routes.some((r) => r.path === path);
}

export function href(path: RoutePath): string {
  return `#${path}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): string {
  return useSyncExternalStore(
    subscribe,
    () => parseHash(window.location.hash),
    () => '/',
  );
}

/** A query parameter of the hash route, e.g. street in #/design?street=wing_lok. */
export function hashParam(hash: string, name: string): string | null {
  const query = hash.split('?')[1];
  return query ? new URLSearchParams(query).get(name) : null;
}

export function useHashParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => hashParam(window.location.hash, name),
    () => null,
  );
}
