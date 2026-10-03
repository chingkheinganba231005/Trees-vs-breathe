import { useI18n } from '../i18n/context';
import type { StringKey } from '../i18n/strings';
import { compassPoint } from '../content/presets';
import type { Street2D } from '../sun/canyon';
import { beamShare, PERSON_HEIGHT_M } from '../sun/canyon';
import type { HeatState, HourWeather, PavementHeat } from '../sun/heat';
import { SimulatedTag } from './SimulatedTag';

interface Props {
  street: Street2D;
  weather: HourWeather;
  heat: HeatState;
  /** The same street and wind without greenery, for the shade the greenery gives. */
  bare: HeatState | null;
  /** Width of each pavement's breathing zone, metres. */
  zoneM: number;
  hour: number;
}

const W = 240;
const H = 190;

/** The street to scale with its shade on the ground, the crowns and the sun's direction. */
function Section({
  street,
  weather,
  zoneM,
  label,
}: Omit<Props, 'heat' | 'hour' | 'bare'> & { label: string }) {
  const pad = 8;
  // Room above the roofs for the sun's direction.
  const sky = 46;
  const scale = Math.min(
    (W - 2 * pad) / (street.widthM * 1.6),
    (H - 2 * pad - sky) / street.heightM,
  );
  const side = (W - street.widthM * scale) / 2;
  const x = (m: number) => side + m * scale;
  const y = (m: number) => H - pad - m * scale;
  const n = 60;
  const lit: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const m = ((i + 0.5) / n) * street.widthM;
    if (beamShare(street, weather.sky, m, 0) > 0.5)
      lit.push([(i / n) * street.widthM, ((i + 1) / n) * street.widthM]);
  }
  const up = weather.sky.elevation > 0;
  const toRight = Math.cos(((weather.sky.azimuth - (street.axisDeg + 90)) * Math.PI) / 180);
  const dz = Math.sin((weather.sky.elevation * Math.PI) / 180);
  const dx = Math.cos((weather.sky.elevation * Math.PI) / 180) * toRight;
  const len = Math.hypot(dx, dz) || 1;
  // The arrow ends just above the middle of the street at roof height.
  const cx = x(street.widthM / 2);
  const cy = y(street.heightM) - 4;
  const reach = Math.min(sky - 8, (cy - pad) / Math.max(0.2, dz / len));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="mt-3 w-full max-w-sm">
      <rect
        x={0}
        y={y(street.heightM)}
        width={x(0)}
        height={street.heightM * scale}
        className="fill-[var(--line)]"
      />
      <rect
        x={x(street.widthM)}
        y={y(street.heightM)}
        width={W - x(street.widthM)}
        height={street.heightM * scale}
        className="fill-[var(--line)]"
      />
      <line
        x1={x(0)}
        x2={x(street.widthM)}
        y1={y(0)}
        y2={y(0)}
        className="stroke-[var(--ink-muted)]"
        strokeWidth={1}
      />
      {lit.map(([a, b]) => (
        <line
          key={a}
          x1={x(a)}
          x2={x(b)}
          y1={y(0)}
          y2={y(0)}
          className="stroke-[var(--ink)]"
          strokeWidth={4}
        />
      ))}
      {street.crowns.map((c, i) => (
        <rect
          key={i}
          x={x(c.x0)}
          y={y(c.z1)}
          width={(c.x1 - c.x0) * scale}
          height={(c.z1 - c.z0) * scale}
          className="fill-[var(--accent-soft)] stroke-[var(--accent)]"
        />
      ))}
      {[zoneM / 2, street.widthM - zoneM / 2].map((m) => (
        <line
          key={m}
          x1={x(m)}
          x2={x(m)}
          y1={y(0)}
          y2={y(PERSON_HEIGHT_M * 1.6)}
          className="stroke-[var(--ink)]"
          strokeWidth={2}
        />
      ))}
      {up && (
        <g className="stroke-[var(--ink)]" strokeWidth={1.5}>
          <line
            x1={cx + (dx / len) * reach}
            y1={cy - (dz / len) * reach}
            x2={cx}
            y2={cy}
            markerEnd="url(#sun-arrow)"
          />
          <circle
            cx={cx + (dx / len) * reach}
            cy={cy - (dz / len) * reach}
            r={4}
            className="fill-[var(--surface)] stroke-[var(--ink)]"
          />
        </g>
      )}
      <defs>
        <marker
          id="sun-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-[var(--ink)]" />
        </marker>
      </defs>
    </svg>
  );
}

/** Heat on the two pavements: UTCI with its category, sun or shade, Tmrt and wind. */
export function HeatPanel({ street, weather, heat, bare, zoneM, hour }: Props) {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const num = (v: number, d = 0) => v.toLocaleString(locale, { maximumFractionDigits: d });
  const signed = (v: number) =>
    v.toLocaleString(locale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const time = `${Math.floor(hour)}:${hour % 1 ? '30' : '00'}`;
  const sides = {
    A: t(`compass.${compassPoint(street.axisDeg + 270)}`),
    B: t(`compass.${compassPoint(street.axisDeg + 90)}`),
  };
  const shade = (p: PavementHeat) =>
    p.sun >= 0.99
      ? t('heat.sun')
      : p.sun <= 0
        ? t('heat.shade')
        : t('heat.crown', { p: num(100 * p.sun) });
  const row = (side: 'A' | 'B') => {
    const p = heat[side];
    return (
      <div key={side} className="border-t border-line py-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">
            {t(side === 'A' ? 'exposure.left' : 'exposure.right')} ·{' '}
            {t('heat.side', { side: sides[side] })}
          </dt>
          <dd className="text-right font-mono whitespace-nowrap">
            {p ? `${num(p.utci)} °C` : '…'}
          </dd>
        </div>
        {p && (
          <>
            <p className="text-right font-bold">{t(`heat.cat.${p.category}` as StringKey)}</p>
            {bare?.[side] && street.crowns.length > 0 && (
              <p className="text-right text-xs">
                {t('heat.vsBare', {
                  d: signed(p.utci - bare[side]!.utci),
                  r: signed(p.tmrt - bare[side]!.tmrt),
                })}
              </p>
            )}
            <p className="text-right text-xs text-ink-muted">
              {weather.sky.elevation > 0 ? `${shade(p)} · ` : ''}
              {t('heat.tmrt', { v: num(p.tmrt) })} · {t('heat.wind10', { v: num(p.wind10, 1) })}
              {p.windClamped ? ` ${t('heat.windClamped')}` : ''}
            </p>
          </>
        )}
      </div>
    );
  };
  return (
    <section aria-labelledby="heat" className="mt-6 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 id="heat" className="font-bold">
          {t('heat.title', { time })}
        </h2>
        <SimulatedTag />
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {t('heat.air', {
          t: num(weather.ta, 1),
          rh: num(weather.rh),
          g: num(weather.ghi),
          w: num(weather.roofWind, 1),
        })}
      </p>
      <dl className="mt-2 text-sm">
        {row('A')}
        {row('B')}
      </dl>
      {!heat.A && (
        <p className="mt-2 text-sm" role="status">
          {t('heat.waiting')}
        </p>
      )}
      <Section
        street={street}
        weather={weather}
        zoneM={zoneM}
        label={t('heat.diagram', { time })}
      />
      <p className="mt-1 text-xs text-ink-muted">
        {weather.sky.elevation > 0 ? t('heat.diagramKey') : t('heat.night')}
      </p>
      <p className="mt-3 text-sm text-ink-muted">{t('heat.help')}</p>
    </section>
  );
}
