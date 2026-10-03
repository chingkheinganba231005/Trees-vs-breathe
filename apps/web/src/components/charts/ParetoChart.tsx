import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/context';

export type PointKind = 'front' | 'other' | 'bare' | 'mine';

export interface ParetoPoint {
  id: string;
  x: number;
  y: number;
  kind: PointKind;
  /** Direct label beside the mark (the picks), at most a few. */
  label?: string;
}

interface Props {
  title: string;
  /** Axis titles carry their units. */
  xLabel: string;
  yLabel: string;
  points: ParetoPoint[];
  legend: Record<PointKind, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Tooltip body for a point. */
  describe: (id: string) => ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  /** Formats a value with the given number of decimals (chosen from the tick step). */
  format?: (v: number, digits: number) => string;
}

const W = 340;
const H = 280;
const M = { top: 14, right: 14, bottom: 42, left: 48 };

/** Round step for about five ticks over [lo, hi], the ticks, and the decimals they need. */
function ticks(lo: number, hi: number): { values: number[]; digits: number } {
  const span = hi - lo || 1;
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const values: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) values.push(+v.toFixed(10));
  return { values, digits: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

function Mark({ kind, x, y, big }: { kind: PointKind; x: number; y: number; big: boolean }) {
  const r = big ? 6 : 4;
  if (kind === 'mine') {
    const d = r + 2;
    return (
      <path
        d={`M${x} ${y - d}L${x + d} ${y}L${x} ${y + d}L${x - d} ${y}Z`}
        fill="var(--accent)"
        stroke="var(--surface)"
        strokeWidth="2"
      />
    );
  }
  if (kind === 'bare') {
    return (
      <rect
        x={x - r}
        y={y - r}
        width={2 * r}
        height={2 * r}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth="2"
      />
    );
  }
  if (kind === 'other') {
    return <circle cx={x} cy={y} r={r - 1} fill="var(--ink-muted)" opacity="0.35" />;
  }
  return <circle cx={x} cy={y} r={r} fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />;
}

/**
 * Heat against fumes in plain SVG: one axis each, the frontier joined by a line, every kind of
 * point with its own mark shape as well as a legend, picks labelled directly, a table view.
 */
export function ParetoChart(props: Props) {
  const { t } = useI18n();
  const id = useId();
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const format = props.format ?? ((v: number, d: number) => v.toFixed(d));
  const { points } = props;

  const dom = useMemo(() => {
    const xs = points.map((p) => p.x).filter(Number.isFinite);
    const ys = points.map((p) => p.y).filter(Number.isFinite);
    const pad = (lo: number, hi: number) => {
      const m = 0.08 * (hi - lo || 1);
      return [lo - m, hi + m] as [number, number];
    };
    return {
      x: xs.length ? pad(Math.min(...xs), Math.max(...xs)) : ([0, 1] as [number, number]),
      y: ys.length ? pad(Math.min(...ys), Math.max(...ys)) : ([0, 1] as [number, number]),
    };
  }, [points]);
  const xt = ticks(dom.x[0], dom.x[1]);
  const yt = ticks(dom.y[0], dom.y[1]);
  const fx = (v: number) => format(v, xt.digits);
  const fy = (v: number) => format(v, yt.digits);
  const sx = (v: number) =>
    M.left + ((v - dom.x[0]) / (dom.x[1] - dom.x[0])) * (W - M.left - M.right);
  const sy = (v: number) =>
    H - M.bottom - ((v - dom.y[0]) / (dom.y[1] - dom.y[0])) * (H - M.top - M.bottom);
  const front = points.filter((p) => p.kind === 'front').sort((a, b) => a.x - b.x);
  const order: PointKind[] = ['other', 'front', 'bare', 'mine'];
  const kinds = order.filter((k) => points.some((p) => p.kind === k));
  const hovered = points.find((p) => p.id === hover) ?? null;

  return (
    <figure className="mt-4 max-w-[36rem]">
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
        {kinds.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <svg width="18" height="18" aria-hidden="true">
              <Mark kind={k} x={9} y={9} big={false} />
            </svg>
            {props.legend[k]}
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
            <tbody className="tabular-nums">
              {props.table.rows.map((row, r) => (
                <tr key={r} className="border-t border-line">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={`px-3 py-1.5 ${typeof cell === 'number' ? 'font-mono' : ''}`}
                    >
                      {cell}
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
            {yt.values.map((v) => (
              <g key={`y${v}`}>
                <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--line)" />
                <text
                  x={M.left - 6}
                  y={sy(v) + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="var(--ink-muted)"
                >
                  {fy(v)}
                </text>
              </g>
            ))}
            {xt.values.map((v) => (
              <g key={`x${v}`}>
                <line x1={sx(v)} x2={sx(v)} y1={M.top} y2={H - M.bottom} stroke="var(--line)" />
                <text
                  x={sx(v)}
                  y={H - M.bottom + 16}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--ink-muted)"
                >
                  {fx(v)}
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
              fontSize="12"
              fill="var(--ink-muted)"
            >
              {props.yLabel}
            </text>
            {front.length > 1 && (
              <polyline
                points={front.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {order.flatMap((k) =>
              points
                .filter((p) => p.kind === k && Number.isFinite(p.x) && Number.isFinite(p.y))
                .map((p) => (
                  <g key={p.id}>
                    {props.selected === p.id && (
                      <circle
                        cx={sx(p.x)}
                        cy={sy(p.y)}
                        r={11}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2"
                      />
                    )}
                    <Mark kind={p.kind} x={sx(p.x)} y={sy(p.y)} big={hover === p.id} />
                    {p.label && (
                      <text
                        x={sx(p.x) + (sx(p.x) > W / 2 ? -10 : 10)}
                        y={sy(p.y) - 9}
                        textAnchor={sx(p.x) > W / 2 ? 'end' : 'start'}
                        fontSize="12"
                        fontWeight="bold"
                        fill="var(--ink)"
                        stroke="var(--surface)"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {p.label}
                      </text>
                    )}
                    {p.kind !== 'bare' && (
                      // A 24px target around each mark, for a finger, a pointer or the keyboard.
                      <circle
                        cx={sx(p.x)}
                        cy={sy(p.y)}
                        r={12}
                        fill="transparent"
                        tabIndex={0}
                        role="button"
                        aria-label={`${props.legend[p.kind]}${p.label ? `, ${p.label}` : ''}: ${fx(p.x)}, ${fy(p.y)}`}
                        aria-pressed={props.selected === p.id}
                        className="cursor-pointer outline-none"
                        onClick={() => props.onSelect(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            props.onSelect(p.id);
                          }
                        }}
                        onPointerEnter={() => setHover(p.id)}
                        onPointerLeave={() => setHover(null)}
                        onFocus={() => setHover(p.id)}
                        onBlur={() => setHover(null)}
                      />
                    )}
                  </g>
                )),
            )}
          </svg>
          {hovered && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-sm"
              style={{
                left: `${(sx(hovered.x) / W) * 100}%`,
                top: `${(sy(hovered.y) / H) * 100}%`,
                transform: sx(hovered.x) > W / 2 ? 'translate(-105%, -50%)' : 'translate(8%, -50%)',
              }}
            >
              {props.describe(hovered.id)}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
