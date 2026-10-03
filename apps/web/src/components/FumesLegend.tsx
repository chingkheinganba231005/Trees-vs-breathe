import { useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/context';
import { fumesAlpha, fumesColor, fumesStops, FUMES_CMAX, isDark } from '../sim/fumesColor';
import { readSimColors } from '../sim/view';

// Ticks at their true positions on the layer's log scale.
const TICKS = [0, 3, 10, 30, FUMES_CMAX];
const SAMPLES = 12;

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const themeSnapshot = () => document.documentElement.getAttribute('data-theme') ?? 'light';

/**
 * Key for the fumes layer, drawn with the same colour, opacity and theme as the canvas, so a
 * colour in the street reads off the key directly.
 */
export function FumesLegend() {
  const { t } = useI18n();
  const theme = useSyncExternalStore(subscribe, themeSnapshot, () => 'light');
  const bg = readSimColors().background;
  const stops = fumesStops(isDark(bg));
  const rgb = (c: [number, number, number]) =>
    `rgb(${c.map((v) => Math.round(255 * v)).join(' ')})`;
  const gradient = Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const s = i / SAMPLES;
    const a = fumesAlpha(s);
    const f = fumesColor(s, stops);
    const mixed: [number, number, number] = [0, 1, 2].map((j) => bg[j]! + a * (f[j]! - bg[j]!)) as [
      number,
      number,
      number,
    ];
    return `${rgb(mixed)} ${(100 * s).toFixed(1)}%`;
  }).join(', ');
  const pos = (c: number) => (100 * Math.log1p(c)) / Math.log1p(FUMES_CMAX);

  return (
    <figure
      className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-muted"
      data-theme-key={theme}
    >
      <figcaption>{t('legend.fumes')}</figcaption>
      <div className="min-w-48 flex-1">
        <div
          aria-hidden="true"
          className="h-3 rounded-sm border border-line"
          style={{ background: `linear-gradient(to right, ${gradient})` }}
        />
        <div className="relative mt-0.5 h-4 font-mono text-xs" aria-hidden="true">
          {TICKS.map((v) => (
            <span
              key={v}
              className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
              style={{ left: `${pos(v)}%` }}
            >
              {v}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
