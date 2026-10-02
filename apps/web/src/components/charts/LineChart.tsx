import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/context';

export interface Series {
  id: string;
  label: string;
  points: ReadonlyArray<readonly [number, number]>;
  /** A 2px line for the model, open markers for reference data. */
  kind: 'line' | 'markers';
}

interface Props {
  title: string;
  /** Axis titles carry their units. */
  xLabel: string;
  yLabel: string;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  series: Series[];
  /** Columns and rows for the table view, which shows every plotted value. */
  table: { columns: string[]; rows: (string | number)[][] };
  /** Tooltip body for a marker, by series id and point index. */
  describe?: (seriesId: string, index: number) => ReactNode;
  format?: (v: number) => string;
}

const W = 340;
const H = 260;
const M = { top: 12, right: 12, bottom: 40, left: 46 };

/**
 * One-axis line chart in plain SVG. Series differ by mark (line or open markers) as well as by
 * a legend, so identity never rests on colour; every value is also in the table view.
 */
export function LineChart(props: Props) {
  const { t } = useI18n();
  const { xDomain, yDomain, series } = props;
  const fmt = props.format ?? ((v: number) => v.toFixed(2));
  const id = useId();
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<{ s: string; i: number; x: number; y: number } | null>(null);

  const sx = useMemo(
    () => (v: number) =>
      M.left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * (W - M.left - M.right),
    [xDomain],
  );
  const sy = useMemo(
    () => (v: number) =>
      H - M.bottom - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * (H - M.top - M.bottom),
    [yDomain],
  );

  return (
    <figure className="mt-4 max-w-[34rem]">
      <figcaption className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-bold">{props.title}</span>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="min-h-11 rounded-md px-2 text-ink-muted underline underline-offset-4 hover:text-ink"
          aria-expanded={showTable}
          aria-controls={`${id}-table`}
        >
          {showTable ? t('chart.showChart') : t('chart.showTable')}
        </button>
      </figcaption>

      <ul
        className="mt-1 flex flex-wrap gap-4 text-sm text-ink-muted"
        aria-label={t('chart.legend')}
      >
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <svg width="22" height="10" aria-hidden="true">
              {s.kind === 'line' ? (
                <line
                  x1="1"
                  x2="21"
                  y1="5"
                  y2="5"
                  stroke="var(--ink)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <circle
                  cx="11"
                  cy="5"
                  r="4"
                  fill="var(--surface)"
                  stroke="var(--ink-muted)"
                  strokeWidth="2"
                />
              )}
            </svg>
            {s.label}
          </li>
        ))}
      </ul>

      {showTable ? (
        <div
          id={`${id}-table`}
          className="mt-2 max-h-80 overflow-auto rounded-md border border-line"
        >
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr>
                {props.table.columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-bold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {props.table.rows.map((row, r) => (
                <tr key={r} className="border-t border-line">
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-1.5">
                      {typeof cell === 'number' ? fmt(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full"
            role="img"
            aria-label={props.title}
          >
            {props.yTicks.map((v) => (
              <g key={`y${v}`}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={sy(v)}
                  y2={sy(v)}
                  stroke="var(--line)"
                  strokeWidth="1"
                />
                <text
                  x={M.left - 6}
                  y={sy(v) + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="var(--ink-muted)"
                >
                  {fmt(v)}
                </text>
              </g>
            ))}
            {props.xTicks.map((v) => (
              <g key={`x${v}`}>
                <line
                  x1={sx(v)}
                  x2={sx(v)}
                  y1={M.top}
                  y2={H - M.bottom}
                  stroke="var(--line)"
                  strokeWidth="1"
                />
                <text
                  x={sx(v)}
                  y={H - M.bottom + 16}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--ink-muted)"
                >
                  {fmt(v)}
                </text>
              </g>
            ))}
            <text
              x={(M.left + W - M.right) / 2}
              y={H - 6}
              textAnchor="middle"
              fontSize="12"
              fill="var(--ink-muted)"
            >
              {props.xLabel}
            </text>
            <text
              transform={`translate(12 ${(M.top + H - M.bottom) / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize="13"
              fill="var(--ink-muted)"
            >
              {props.yLabel}
            </text>

            {series
              .filter((s) => s.kind === 'line')
              .map((s) => (
                <polyline
                  key={s.id}
                  points={s.points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            {series
              .filter((s) => s.kind === 'markers')
              .map((s) =>
                s.points.map(([x, y], i) => (
                  <g key={`${s.id}${i}`}>
                    <circle
                      cx={sx(x)}
                      cy={sy(y)}
                      r={hover?.s === s.id && hover.i === i ? 5.5 : 4}
                      fill="var(--surface)"
                      stroke="var(--ink-muted)"
                      strokeWidth="2"
                    />
                    {props.describe && (
                      // A 24px target around each 8px marker, so it can be hit by finger or focus.
                      <circle
                        cx={sx(x)}
                        cy={sy(y)}
                        r={12}
                        fill="transparent"
                        tabIndex={0}
                        aria-label={`${s.label}: ${fmt(x)}, ${fmt(y)}`}
                        onPointerEnter={() => setHover({ s: s.id, i, x: sx(x), y: sy(y) })}
                        onPointerLeave={() => setHover(null)}
                        onFocus={() => setHover({ s: s.id, i, x: sx(x), y: sy(y) })}
                        onBlur={() => setHover(null)}
                      />
                    )}
                  </g>
                )),
              )}
          </svg>
          {hover && props.describe && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-sm"
              style={{
                left: `${(hover.x / W) * 100}%`,
                top: `${(hover.y / H) * 100}%`,
                transform: hover.x > W / 2 ? 'translate(-105%, -50%)' : 'translate(8%, -50%)',
              }}
            >
              {props.describe(hover.s, hover.i)}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
