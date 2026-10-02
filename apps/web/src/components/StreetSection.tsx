import { useId } from 'react';
import { useI18n } from '../i18n/context';

export interface SectionGeometry {
  /** Building height H, metres. */
  buildingHeight: number;
  /** Wall-to-wall street width W, metres. */
  streetWidth: number;
  pavementLeft: number;
  pavementRight: number;
}

export interface SectionTree {
  /** Horizontal centre of the crown, metres from the left wall. */
  x: number;
  crownWidth: number;
  crownHeight: number;
  crownBase: number;
}

interface Props {
  geometry: SectionGeometry;
  trees?: SectionTree[];
  className?: string;
}

// Shown building depth either side of the street; only frames the drawing.
const SIDE = 5;
const SKY = 7;
const KERB = 0.15;

/** Static drawing of the street cross-section. The live solver canvas replaces the interior in P1. */
export function StreetSection({ geometry, trees = [], className }: Props) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const { buildingHeight: H, streetWidth: W, pavementLeft, pavementRight } = geometry;
  const width = W + 2 * SIDE;
  const height = H + SKY + 3;
  const ground = SKY + H;
  const left = SIDE;
  const right = SIDE + W;
  const label = Math.max(1.1, W * 0.1);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={titleId}
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>{t('section.title')}</title>

      {/* Buildings */}
      <rect
        x={0}
        y={SKY}
        width={SIDE}
        height={H}
        fill="var(--surface-2)"
        stroke="var(--line)"
        strokeWidth={0.12}
      />
      <rect
        x={right}
        y={SKY}
        width={SIDE}
        height={H}
        fill="var(--surface-2)"
        stroke="var(--line)"
        strokeWidth={0.12}
      />
      {[0, right].map((x0) => (
        <VerticalLabel
          key={x0}
          x={x0 + SIDE / 2}
          y={SKY + H / 2}
          size={label}
          text={t('section.building')}
          stacked={lang !== 'en'}
        />
      ))}

      {/* Pavements sit one kerb height above the carriageway. */}
      <rect x={left} y={ground - KERB} width={pavementLeft} height={KERB + 1} fill="var(--line)" />
      <rect
        x={right - pavementRight}
        y={ground - KERB}
        width={pavementRight}
        height={KERB + 1}
        fill="var(--line)"
      />
      <rect
        x={left + pavementLeft}
        y={ground}
        width={W - pavementLeft - pavementRight}
        height={1}
        fill="var(--ink-muted)"
        opacity={0.55}
      />
      <line
        x1={0}
        x2={width}
        y1={ground + 1}
        y2={ground + 1}
        stroke="var(--line)"
        strokeWidth={0.12}
      />
      <text
        x={left + W / 2}
        y={ground + 2.4}
        fontSize={label}
        fill="var(--ink-muted)"
        textAnchor="middle"
      >
        {t('section.carriageway')}
      </text>

      {/* Trees */}
      {trees.map((tree, i) => {
        const cx = left + tree.x;
        const cy = ground - tree.crownBase - tree.crownHeight / 2;
        return (
          <g key={i}>
            <rect
              x={cx - 0.2}
              y={ground - tree.crownBase - 0.5}
              width={0.4}
              height={tree.crownBase + 0.5 - KERB}
              fill="var(--accent)"
            />
            <ellipse
              cx={cx}
              cy={cy}
              rx={tree.crownWidth / 2}
              ry={tree.crownHeight / 2}
              fill="var(--accent)"
              opacity={0.85}
            />
            <text
              x={cx + tree.crownWidth / 2 + 0.4}
              y={cy + label / 3}
              fontSize={label}
              fill="var(--accent)"
            >
              {t('section.tree')}
            </text>
          </g>
        );
      })}

      {/* Approach wind above the roofs, blowing across the street. */}
      <g stroke="var(--ink-muted)" strokeWidth={0.18} fill="none" strokeLinecap="round">
        <line x1={1} x2={width - 2} y1={SKY - 2.5} y2={SKY - 2.5} />
        <polyline
          points={`${width - 3.2},${SKY - 3.4} ${width - 2},${SKY - 2.5} ${width - 3.2},${SKY - 1.6}`}
        />
      </g>
      <text x={1} y={SKY - 3.6} fontSize={label} fill="var(--ink-muted)">
        {t('section.wind')}
      </text>
    </svg>
  );
}

interface LabelProps {
  x: number;
  y: number;
  size: number;
  text: string;
  /** Stack characters top to bottom (Chinese) instead of rotating the line (Latin). */
  stacked: boolean;
}

// Each Chinese character gets its own position: Chrome mis-spaces SVG writing-mode text at
// sub-pixel font sizes, which the metre-based viewBox produces.
function VerticalLabel({ x, y, size, text, stacked }: LabelProps) {
  if (!stacked) {
    return (
      <text
        x={x}
        y={y}
        fontSize={size}
        fill="var(--ink-muted)"
        textAnchor="middle"
        transform={`rotate(-90 ${x} ${y})`}
      >
        {text}
      </text>
    );
  }
  const chars = [...text];
  const step = size * 1.15;
  const top = y - ((chars.length - 1) * step) / 2;
  return (
    <text fontSize={size} fill="var(--ink-muted)" textAnchor="middle" dominantBaseline="central">
      {chars.map((c, i) => (
        <tspan key={i} x={x} y={top + i * step}>
          {c}
        </tspan>
      ))}
    </text>
  );
}
