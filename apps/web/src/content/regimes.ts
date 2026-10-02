import type { StringKey } from '../i18n/strings';

export type Regime = 'isolated' | 'wake' | 'skimming' | 'deep';

/**
 * Flow regime expected from the literature for wind across a long street.
 * Thresholds 0.3 and 0.7: Oke (1988), as restated by Buccolieri et al. (2020), arXiv 2005.10198.
 * Two stacked vortices at H/W = 2: Liu, Barth and Leung (2004), J. Appl. Meteorol. 43, 1410-1424.
 * See docs/sources.md.
 */
export function expectedRegime(aspect: number): Regime {
  if (aspect < 0.3) return 'isolated';
  if (aspect < 0.7) return 'wake';
  if (aspect < 2) return 'skimming';
  return 'deep';
}

export const regimeText: Record<Regime, { name: StringKey; body: StringKey; source: StringKey }> = {
  isolated: { name: 'regime.isolated', body: 'regime.isolatedBody', source: 'regime.sourceOke' },
  wake: { name: 'regime.wake', body: 'regime.wakeBody', source: 'regime.sourceOke' },
  skimming: { name: 'regime.skimming', body: 'regime.skimmingBody', source: 'regime.sourceOke' },
  deep: { name: 'regime.deep', body: 'regime.deepBody', source: 'regime.sourceLiu' },
};
