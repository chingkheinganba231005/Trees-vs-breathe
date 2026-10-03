import { Screen } from '../components/Screen';
import { StreetSection } from '../components/StreetSection';
import { SimulatedTag } from '../components/SimulatedTag';
import type { StreetPreset } from '../content/presets';
import { streetEnds, streetPresets } from '../content/presets';
import { result } from '../content/results';
import type { Provenance } from '../content/results';
import { useI18n } from '../i18n/context';
import type { StringKey } from '../i18n/strings';
import { checkedAspectMax } from '../sim/streetSim';

const STATION_KEYS: Record<string, StringKey> = {
  'Mong Kok Air Quality Monitoring Station': 'station.mongKok',
  'Sham Shui Po Air Quality Monitoring Station': 'station.shamShuiPo',
};

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-t border-line py-2">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-muted">{label}</dt>
        <dd className="text-right font-mono">{value}</dd>
      </div>
      {note && <p className="text-right text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

function PresetCard({ preset }: { preset: StreetPreset }) {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const num = (v: number, d = 1) => v.toLocaleString(locale, { maximumFractionDigits: d });
  const name = lang === 'en' ? preset.label_en : preset.label_tc;
  const [a, b] = streetEnds(preset.bearing_deg);
  const ratio = preset.aspect_h_over_w;
  const max = checkedAspectMax();
  const station = preset.centred_on ? STATION_KEYS[preset.centred_on] : undefined;
  return (
    <article
      className="flex flex-col rounded-lg border border-line bg-surface p-4"
      aria-labelledby={`preset-${preset.key}`}
    >
      <h2 id={`preset-${preset.key}`} className="text-lg font-bold">
        {name}
      </h2>
      <StreetSection
        // A fixed box keeps the cards level; the drawing keeps its proportions inside it.
        className="mt-3 h-64 w-full"
        geometry={{
          buildingHeight: preset.height_m.median,
          streetWidth: preset.width_m.median,
          pavementLeft: 0,
          pavementRight: 0,
        }}
      />
      <p className="mt-1 text-xs text-ink-muted">{t('street.drawing')}</p>
      <dl className="mt-3 text-sm">
        <Row label={t('street.width')} value={`${num(preset.width_m.median)} m`} />
        <Row label={t('street.height')} value={`${num(preset.height_m.median)} m`} />
        <Row
          label={t('street.ratio')}
          value={num(ratio.median)}
          note={t('street.ratioRange', { lo: num(ratio.p25), hi: num(ratio.p75) })}
        />
        <Row label={t('street.runs')} value={`${t(`compass.${a}`)}–${t(`compass.${b}`)}`} />
      </dl>
      <p className="mt-2 text-sm text-ink-muted">
        {station ? t('street.centred', { station: t(station) }) : t('street.whole')}{' '}
        {t('street.measured', {
          length: num(preset.stretch_length_m, 0),
          used: preset.used,
          points: preset.points,
        })}
      </p>
      {ratio.median > max && (
        <p className="mt-2 rounded-md border border-line px-3 py-2 text-sm">
          {t('street.tooDeep', { max: num(max) })}
        </p>
      )}
      <a
        href={`#/design?street=${preset.key}`}
        className="mt-4 inline-flex min-h-11 items-center justify-center self-start rounded-lg bg-accent px-4 font-bold text-accent-ink hover:opacity-90"
      >
        {t('street.open')}
      </a>
    </article>
  );
}

/** The measured Hong Kong street presets. Custom streets and phone mode come later in phase 3. */
export function Street() {
  const { t, lang } = useI18n();
  const presets = streetPresets();
  const source = result<Provenance>('streets/presets.json');
  const date = source
    ? new Date(source.generated_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-HK', {
        dateStyle: 'long',
      })
    : '';
  return (
    <Screen title={t('street.title')} intro={t('street.intro')}>
      <div className="mt-8 flex items-center justify-between text-sm text-ink-muted">
        <span>{t('street.measuredHeading')}</span>
        <SimulatedTag kind="measured" />
      </div>
      <div className="mt-2 grid gap-4 md:grid-cols-3">
        {presets.map((p) => (
          <PresetCard key={p.key} preset={p} />
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-muted">{t('street.source', { date })}</p>
      <p className="mt-6 rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-muted">
        {t('street.later')}
      </p>
    </Screen>
  );
}
