import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Provenance } from '../content/results';
import { useI18n } from '../i18n/context';
import { SimulatedTag } from './SimulatedTag';

function Verdict({ passed }: { passed: boolean | null }) {
  const { t } = useI18n();
  if (passed === null) {
    return <span className="text-sm text-ink-muted">{t('evidence.pending')}</span>;
  }
  // Words and an icon carry the verdict; no colour is needed to read it.
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-bold">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        {passed ? (
          <path
            d="M3 8.5l3 3 7-7"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
      </svg>
      {t(passed ? 'evidence.passed' : 'evidence.failed')}
    </span>
  );
}

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-0.5 text-2xl font-bold">{value}</div>
      {note && <div className="text-xs text-ink-muted">{note}</div>}
    </div>
  );
}

interface CardProps {
  title: string;
  question: string;
  result: Provenance | null;
  children?: ReactNode;
}

/** One check: what it asks, the verdict read from results/, the evidence, and its provenance. */
export function EvidenceCard({ title, question, result, children }: CardProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const date = result
    ? new Date(result.generated_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-HK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';
  return (
    <article className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg leading-snug font-bold">{title}</h3>
        <div className="flex items-center gap-2">
          <Verdict passed={result ? result.passed : null} />
          {result && <SimulatedTag />}
        </div>
      </header>
      <p className="mt-1 text-ink-muted">{question}</p>
      {result ? (
        children
      ) : (
        <p className="mt-3 text-sm text-ink-muted">{t('evidence.pendingBody')}</p>
      )}
      {result && (
        <div className="mt-3 text-sm">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="min-h-11 text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            {t(open ? 'evidence.hideMethod' : 'evidence.showMethod')}
          </button>
          {open && (
            <dl className="mt-1 space-y-1 text-ink-muted">
              {result.method && (
                <div>
                  <dt className="inline font-bold text-ink">{t('evidence.method')}: </dt>
                  <dd className="inline">{result.method}</dd>
                </div>
              )}
              {result.metric && (
                <div>
                  <dt className="inline font-bold text-ink">{t('evidence.metric')}: </dt>
                  <dd className="inline">{result.metric}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-bold text-ink">{t('evidence.provenance')}: </dt>
                <dd className="inline font-mono text-xs">
                  {result.generated_by} · {date} · {result.commit.slice(0, 7)}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </article>
  );
}
