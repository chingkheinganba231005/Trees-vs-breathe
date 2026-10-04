import { useEffect, useMemo, useState } from 'react';
import { Screen } from '../components/Screen';
import { StreetSection } from '../components/StreetSection';
import { SimulatedTag } from '../components/SimulatedTag';
import type { StreetPreset } from '../content/presets';
import { customStreetHref, localTree, streetEnds, streetPresets } from '../content/presets';
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
  const tree = localTree(preset.key);
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
      {tree?.height_m && tree.crown_spread_m && (
        <p className="mt-2 text-sm text-ink-muted">
          {tree.trees_on_stretch
            ? t('street.treesSome', { n: tree.trees_on_stretch })
            : t('street.treesNone')}{' '}
          {t('street.treeTypical', {
            h: num(tree.height_m.median),
            s: num(tree.crown_spread_m.median),
          })}
        </p>
      )}
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

function CustomStreetForm() {
  const { t } = useI18n();
  const [heightM, setHeightM] = useState(30);
  const [widthM, setWidthM] = useState(20);
  const [pavementLeftM, setPavementLeftM] = useState(2);
  const [pavementRightM, setPavementRightM] = useState(2);
  const [bearingDeg, setBearingDeg] = useState(0);

  const href = useMemo(
    () =>
      customStreetHref({
        heightM,
        widthM,
        pavementLeftM,
        pavementRightM,
        bearingDeg,
      }),
    [bearingDeg, heightM, pavementLeftM, pavementRightM, widthM],
  );

  return (
    <section className="mt-8 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">{t('street.customTitle')}</h2>
          <p className="text-sm text-ink-muted">{t('street.customText')}</p>
        </div>
        <SimulatedTag kind="assumption" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.customHeight')}</span>
          <input
            type="number"
            min={6}
            step={1}
            value={heightM}
            onChange={(e) => setHeightM(Number(e.target.value) || 0)}
            className="w-full rounded-md border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.customWidth')}</span>
          <input
            type="number"
            min={6}
            step={1}
            value={widthM}
            onChange={(e) => setWidthM(Number(e.target.value) || 0)}
            className="w-full rounded-md border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.customPavementLeft')}</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={pavementLeftM}
            onChange={(e) => setPavementLeftM(Number(e.target.value) || 0)}
            className="w-full rounded-md border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.customPavementRight')}</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={pavementRightM}
            onChange={(e) => setPavementRightM(Number(e.target.value) || 0)}
            className="w-full rounded-md border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.customBearing')}</span>
          <input
            type="number"
            min={0}
            max={360}
            step={1}
            value={bearingDeg}
            onChange={(e) => setBearingDeg(Number(e.target.value) || 0)}
            className="w-full rounded-md border border-line bg-transparent px-3 py-2"
          />
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">
          {t('street.customAspect', {
            value: (heightM / widthM).toFixed(1),
          })}
        </p>
        <a
          href={href}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 font-bold text-accent-ink hover:opacity-90"
        >
          {t('street.open')}
        </a>
      </div>
    </section>
  );
}

function PhoneMeasurement() {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'zh-HK';
  const [permission, setPermission] = useState<'idle' | 'active' | 'denied'>('idle');
  const [bearing, setBearing] = useState<number | null>(null);
  const [tilt, setTilt] = useState(35);
  const [distance, setDistance] = useState(20);
  const [eyeHeight, setEyeHeight] = useState(1.6);
  const [uncertainty, setUncertainty] = useState(1);
  const [temperature, setTemperature] = useState('');

  useEffect(() => {
    if (permission !== 'active') return;
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null) setBearing((event.alpha + 360) % 360);
      if (event.beta !== null && Math.abs(event.beta) < 89) setTilt(Math.abs(event.beta));
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [permission]);

  const height = eyeHeight + distance * Math.tan((tilt * Math.PI) / 180);
  const heightLow = eyeHeight + distance * Math.tan(((tilt - uncertainty) * Math.PI) / 180);
  const heightHigh = eyeHeight + distance * Math.tan(((tilt + uncertainty) * Math.PI) / 180);
  const start = async () => {
    const request = (
      DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      }
    ).requestPermission;
    if (request) {
      try {
        if ((await request()) !== 'granted') {
          setPermission('denied');
          return;
        }
      } catch {
        setPermission('denied');
        return;
      }
    }
    setPermission('active');
  };
  const num = (v: number, digits = 1) =>
    v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });

  return (
    <section className="mt-8 rounded-lg border border-line bg-surface p-4" aria-labelledby="phone-mode">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="phone-mode" className="text-lg font-bold">{t('street.phoneTitle')}</h2>
          <p className="text-sm text-ink-muted">{t('street.phoneText')}</p>
        </div>
        <SimulatedTag kind="assumption" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.phoneDistance')}</span>
          <input type="number" min={1} step={1} value={distance} onChange={(e) => setDistance(Number(e.target.value) || 1)} className="w-full rounded-md border border-line bg-transparent px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.phoneEyeHeight')}</span>
          <input type="number" min={1} max={2.5} step={0.1} value={eyeHeight} onChange={(e) => setEyeHeight(Number(e.target.value) || 1)} className="w-full rounded-md border border-line bg-transparent px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.phoneTilt')}</span>
          <input type="number" min={1} max={88} step={1} value={tilt} onChange={(e) => setTilt(Number(e.target.value) || 1)} className="w-full rounded-md border border-line bg-transparent px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{t('street.phoneTemperature')}</span>
          <input type="number" step={0.1} value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder={t('street.phoneTemperaturePlaceholder')} className="w-full rounded-md border border-line bg-transparent px-3 py-2" />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void start()} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-bold text-accent-ink">
          {permission === 'active' ? t('street.phoneActive') : t('street.phoneStart')}
        </button>
        <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm">
          <span>{t('street.phoneUncertainty')}</span>
          <input type="number" min={0.1} max={5} step={0.1} value={uncertainty} onChange={(e) => setUncertainty(Number(e.target.value) || 1)} className="w-16 rounded border border-line bg-transparent px-2 py-1" />
          °
        </label>
      </div>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Row label={t('street.phoneBearing')} value={bearing === null ? '—' : `${num(bearing, 0)}°`} />
        <Row label={t('street.phoneHeight')} value={`${num(height)} m`} note={`${num(heightLow)}–${num(heightHigh)} m`} />
        <Row label={t('street.phoneTemperature')} value={temperature ? `${temperature} °C` : '—'} />
      </dl>
      <p className="mt-3 text-xs text-ink-muted">{t(permission === 'denied' ? 'street.phoneDenied' : 'street.phoneCaveat')}</p>
    </section>
  );
}

/** The measured Hong Kong street presets and phone-assisted custom measurement. */
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
      <CustomStreetForm />
      <PhoneMeasurement />
      <p className="mt-6 rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-muted">
        {t('street.later')}
      </p>
    </Screen>
  );
}
