import { useI18n } from '../i18n/context';

/**
 * Attached to every number that comes from a model rather than a measurement; with
 * kind="measured" it marks numbers measured from data instead, so the two are never confused.
 */
export function SimulatedTag({ kind = 'simulated' }: { kind?: 'simulated' | 'measured' }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 align-middle font-mono text-[0.7rem] tracking-wide text-ink-muted uppercase">
      {t(kind === 'simulated' ? 'tag.simulated' : 'tag.measured')}
    </span>
  );
}
