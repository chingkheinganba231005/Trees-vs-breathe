import { describe, expect, it } from 'vitest';
import { isRoute, parseHash, routes } from '../../apps/web/src/lib/router';

describe('parseHash', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/design', '/design'],
    ['#/design/', '/design'],
    ['#design', '/design'],
    ['#/trade-off?x=1', '/trade-off'],
  ])('%s -> %s', (hash, path) => {
    expect(parseHash(hash)).toBe(path);
  });
});

describe('routes', () => {
  it('covers the nine screens of BRIEF.md section 11.1', () => {
    expect(routes).toHaveLength(9);
    expect(new Set(routes.map((r) => r.path)).size).toBe(9);
  });

  it('recognises known paths only', () => {
    expect(isRoute('/compare')).toBe(true);
    expect(isRoute('/nope')).toBe(false);
  });
});
