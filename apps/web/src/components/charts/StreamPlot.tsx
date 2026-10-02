import { useI18n } from '../../i18n/context';
import type { RegimeRow } from '../../content/results';
import { contourSegments } from './contour';

const LEVELS = [-0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9];
const PLOT_H = 120;

/** Time-averaged streamlines inside the street, with the buildings on either side. */
export function StreamPlot({ row }: { row: RegimeRow }) {
  const { t, lang } = useI18n();
  const { rows, cols, values } = row.psi;
  const scale = PLOT_H / rows;
  const wall = Math.max(8, 0.35 * rows) * scale;
  const width = cols * scale + 2 * wall;
  const toX = (c: number) => wall + (c + 0.5) * scale;
  const toY = (r: number) => PLOT_H - (r + 0.5) * scale;
  const paths = LEVELS.map((lvl) =>
    contourSegments(values, rows, cols, lvl)
      .map(
        ([x0, y0, x1, y1]) =>
          `M${toX(x0).toFixed(1)} ${toY(y0).toFixed(1)}L${toX(x1).toFixed(1)} ${toY(y1).toFixed(1)}`,
      )
      .join(''),
  );
  const strong = row.vortices.filter((v) => Math.abs(v.psi) >= 0.1);
  const n = row.stacked_primary_vortices;
  return (
    <figure className="flex flex-col items-start">
      <svg
        viewBox={`0 0 ${width} ${PLOT_H + 2}`}
        height={PLOT_H}
        className="block max-w-full"
        role="img"
        aria-label={t('regimes.plotLabel', { aspect: row.aspect, n })}
      >
        <rect x="0" y="0" width={wall} height={PLOT_H} fill="var(--line)" />
        <rect x={width - wall} y="0" width={wall} height={PLOT_H} fill="var(--line)" />
        <line
          x1={wall}
          x2={width - wall}
          y1={PLOT_H + 1}
          y2={PLOT_H + 1}
          stroke="var(--line)"
          strokeWidth="2"
        />
        {paths.map((d, k) => (
          <path key={k} d={d} fill="none" stroke="var(--ink-muted)" strokeWidth="1" />
        ))}
        {strong.map((v, k) => (
          <g key={k}>
            <circle
              cx={wall + v.x * cols * scale}
              cy={PLOT_H - v.z * rows * scale}
              r="4"
              fill="var(--ink)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-sm">
        <span className="font-bold">
          H/W {row.aspect.toLocaleString(lang === 'en' ? 'en-GB' : 'zh-HK')}
        </span>
        <span className="block text-ink-muted">
          {strong
            .slice()
            .sort((a, b) => b.z - a.z)
            .map((v) => t(v.rotation === 'clockwise' ? 'regimes.cw' : 'regimes.acw'))
            .join(' / ') || t('regimes.none')}
        </span>
      </figcaption>
    </figure>
  );
}
