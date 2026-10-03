import type { ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import type { GreeneryDesign, StreetScale } from '../sim/greenery';
import { crownTop, HEDGE_HEIGHTS_M, HEDGE_LAMBDAS } from '../sim/greenery';

interface Props {
  design: GreeneryDesign;
  onChange: (d: GreeneryDesign) => void;
  /** Allowed sideways shift for the current street, units of H. */
  shiftRange: [number, number];
  /** The street's height in metres and its typical local tree. */
  scale: StreetScale;
}

function Choice<T extends string | number>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={String(o.value)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
        >
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="size-4 accent-[var(--accent)]"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  shown,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  shown: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-4">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-11 flex-1 accent-[var(--accent)]"
        />
        <output htmlFor={id} className="w-20 text-right font-mono">
          {shown}
        </output>
      </div>
    </div>
  );
}

/** Trees and hedges for the street on the Design screen. */
export function GreeneryControls({ design, onChange, shiftRange, scale }: Props) {
  const { t, lang } = useI18n();
  const set = (patch: Partial<GreeneryDesign>) => onChange({ ...design, ...patch });
  const fmt = (v: number) =>
    v.toLocaleString(lang === 'en' ? 'en-GB' : 'zh-HK', { maximumFractionDigits: 1 });
  const metres = (h: number) => `${fmt(h * scale.heightM)} m`;
  const top = crownTop(design, scale);
  // Switching the tree size moves the crown base to one third of the new tree, as in CODASC.
  const setSize = (treeSize: GreeneryDesign['treeSize']) =>
    set({ treeSize, crownBase: crownTop({ ...design, treeSize }, scale) / 3 });

  return (
    <fieldset className="mt-6">
      <legend className="font-bold">{t('green.title')}</legend>
      <Choice
        name="green-kind"
        value={design.kind}
        onChange={(kind) => set({ kind, shift: 0 })}
        options={[
          { value: 'none', label: t('green.none') },
          { value: 'trees', label: t('green.trees') },
          { value: 'hedge', label: t('green.hedge') },
        ]}
      />

      {design.kind === 'trees' && (
        <>
          {scale.localTree && (
            <>
              <p className="mt-4 text-sm font-bold">{t('green.treeSize')}</p>
              <Choice
                name="tree-size"
                value={design.treeSize}
                onChange={setSize}
                options={[
                  {
                    value: 'local',
                    label: t('green.sizeLocal', {
                      h: fmt(scale.localTree.heightM),
                      s: fmt(scale.localTree.spreadM),
                    }),
                  },
                  { value: 'tunnel', label: t('green.sizeTunnel') },
                ]}
              />
              {design.treeSize === 'local' && (
                <p className="mt-2 text-sm text-ink-muted">{t('green.sizeLocalNote')}</p>
              )}
            </>
          )}
          <p className="mt-4 text-sm font-bold">{t('green.density')}</p>
          <Choice
            name="green-density"
            value={design.density}
            onChange={(density) => set({ density })}
            options={[
              { value: 'light', label: t('green.light') },
              { value: 'dense', label: t('green.dense') },
            ]}
          />
          <Slider
            id="crown-base"
            label={t('green.crownBase')}
            value={Math.min(Math.max(design.crownBase, 0.1 * top), 0.7 * top)}
            min={0.1 * top}
            max={0.7 * top}
            step={top / 36}
            shown={metres(design.crownBase)}
            onChange={(crownBase) => set({ crownBase })}
          />
          <Slider
            id="crown-width"
            label={t('green.crownWidth')}
            value={design.crownScale}
            min={0.5}
            max={1.5}
            step={0.05}
            shown={`${Math.round(design.crownScale * 100)}%`}
            onChange={(crownScale) => set({ crownScale })}
          />
        </>
      )}

      {design.kind === 'hedge' && (
        <>
          <p className="mt-4 text-sm font-bold">{t('green.hedgeHeight')}</p>
          <Choice
            name="hedge-height"
            value={design.hedgeHeightM}
            onChange={(hedgeHeightM) => set({ hedgeHeightM })}
            options={HEDGE_HEIGHTS_M.map((h) => ({ value: h, label: `${h} m` }))}
          />
          <p className="mt-4 text-sm font-bold">{t('green.hedgeDensity')}</p>
          <Choice
            name="hedge-lambda"
            value={design.hedgeLambda}
            onChange={(hedgeLambda) => set({ hedgeLambda })}
            options={HEDGE_LAMBDAS.map((l, i) => ({
              value: l,
              label: t(i === 0 ? 'green.hedgeLoose' : 'green.hedgeTight', { lambda: l }),
            }))}
          />
        </>
      )}

      {design.kind !== 'none' && (
        <>
          <Slider
            id="green-shift"
            label={t('green.shift')}
            value={Math.min(Math.max(design.shift, shiftRange[0]), shiftRange[1])}
            min={shiftRange[0]}
            max={shiftRange[1]}
            step={0.01}
            shown={metres(design.shift)}
            onChange={(shift) => set({ shift })}
          />
          <p className="mt-2 text-sm text-ink-muted">{t('green.dragHint')}</p>
        </>
      )}
      <p className="mt-3 text-sm text-ink-muted">{t('green.source', { h: fmt(scale.heightM) })}</p>
    </fieldset>
  );
}
