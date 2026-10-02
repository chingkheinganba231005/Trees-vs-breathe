import { useI18n } from '../i18n/context';

export function PhaseNote({ phase }: { phase: number }) {
  const { t } = useI18n();
  return (
    <p className="mt-6 inline-flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-muted">
      <span aria-hidden="true" className="inline-block size-2 rounded-full bg-ink-muted" />
      {t('phase.planned', { phase })}
    </p>
  );
}
