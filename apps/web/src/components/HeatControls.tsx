import { useI18n } from '../i18n/context';
import type { StringKey } from '../i18n/strings';
import type { WeatherDay } from '../sun/weather';

/** Street directions offered for a street without a measured preset, degrees from north. */
const DIRECTIONS: readonly [number, StringKey][] = [
  [0, 'heat.dir0'],
  [45, 'heat.dir45'],
  [90, 'heat.dir90'],
  [135, 'heat.dir135'],
];

interface Props {
  days: WeatherDay[];
  dayKey: string;
  onDay: (key: string) => void;
  hour: number;
  onHour: (hour: number) => void;
  /** Street axis, degrees; fixed for a measured street. */
  axis: number;
  onAxis: ((axis: number) => void) | null;
}

/** Weather day, hour and, for a street without a preset, its direction. */
export function HeatControls({ days, dayKey, onDay, hour, onHour, axis, onAxis }: Props) {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const date = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' });
  const card =
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft';
  return (
    <section aria-labelledby="sun-heat" className="mt-6">
      <h2 id="sun-heat" className="font-bold">
        {t('heat.controls')}
      </h2>
      <fieldset className="mt-2">
        <legend className="text-sm font-bold">{t('heat.weather')}</legend>
        <div className="mt-1 grid gap-2">
          {days.map((d) => (
            <label key={d.key} className={card}>
              <input
                type="radio"
                name="weather"
                checked={dayKey === d.key}
                onChange={() => onDay(d.key)}
                className="size-4 accent-[var(--accent)]"
              />
              <span>
                {t(d.key === 'very_hot' ? 'heat.dayHot' : 'heat.dayTypical', {
                  date: date(d.date),
                  max: d.tmax_c.toLocaleString(locale),
                  min: d.tmin_c.toLocaleString(locale),
                })}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="hour" className="mt-4 block text-sm font-bold">
        {t('heat.hour')}
      </label>
      <div className="mt-1 flex items-center gap-4">
        <input
          id="hour"
          type="range"
          min={6}
          max={19}
          step={0.5}
          value={hour}
          onChange={(e) => onHour(Number(e.target.value))}
          className="h-11 flex-1 accent-[var(--accent)]"
        />
        <output htmlFor="hour" className="w-16 text-right font-mono text-lg">
          {`${Math.floor(hour)}:${hour % 1 ? '30' : '00'}`}
        </output>
      </div>
      {onAxis ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-bold">{t('heat.direction')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {DIRECTIONS.map(([a, key]) => (
              <label key={a} className={card}>
                <input
                  type="radio"
                  name="direction"
                  checked={axis === a}
                  onChange={() => onAxis(a)}
                  className="size-4 accent-[var(--accent)]"
                />
                {t(key)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">{t('heat.directionMeasured')}</p>
      )}
      <p className="mt-2 text-sm text-ink-muted">{t('heat.weatherSource')}</p>
    </section>
  );
}
