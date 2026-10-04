import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/context';
import type { Layers } from '../sim/cpu/canvasRenderer';
import type { EngineChoice } from '../sim/engine';
import type { GreenElement } from '../sim/greenery';
import { canyonGeometry } from '../sim/street';
import type { EngineNote, SimStats, StreetSim } from '../sim/streetSim';
import { createStreetSim, HEIGHT } from '../sim/streetSim';
import { readSimColors, streetView } from '../sim/view';

interface Props {
  aspect: number;
  greenery: GreenElement[];
  layers: Layers;
  engine: EngineChoice;
  onStats: (stats: SimStats) => void;
  /** Sideways drag on the street, in building heights; the sliders do the same by keyboard. */
  onDrag?: (dx: number, targetId?: string) => void;
  label: string;
}

/** The live street cross-section. Owns the solver for as long as it is on screen. */
export function StreetSimulation({
  aspect,
  greenery,
  layers,
  engine,
  onStats,
  onDrag,
  label,
}: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<StreetSim | null>(null);
  const statsRef = useRef(onStats);
  const layersRef = useRef(layers);
  const aspectRef = useRef(aspect);
  const greeneryRef = useRef(greenery);
  const dragFrom = useRef<number | null>(null);
  const dragTarget = useRef<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  // Set when the GPU fails mid-run; the simulation then restarts on the CPU worker.
  const [fallback, setFallback] = useState<EngineNote | null>(null);

  useEffect(() => {
    statsRef.current = onStats;
    layersRef.current = layers;
    aspectRef.current = aspect;
    greeneryRef.current = greenery;
  });

  // Create the simulation once per engine choice.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let sim: StreetSim | null = null;
    let observer: ResizeObserver | null = null;
    createStreetSim(
      canvas,
      {
        aspect: aspectRef.current,
        greenery: greeneryRef.current,
        layers: layersRef.current,
        colors: readSimColors(),
        engine,
        onStats: (s) => statsRef.current(s),
        onFallback: (reason) => setFallback(reason),
      },
      fallback ?? undefined,
    )
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        sim = created;
        simRef.current = created;
        const fit = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const rect = canvas.getBoundingClientRect();
          const w = Math.max(1, Math.round(rect.width * dpr));
          const h = Math.max(1, Math.round(rect.height * dpr));
          canvas.width = w;
          canvas.height = h;
          created.resize(w, h);
        };
        fit();
        observer = new ResizeObserver(fit);
        observer.observe(canvas);
      })
      .catch((err: unknown) => setFailed(String(err)));
    // Follow the light/dark theme.
    const themeObserver = new MutationObserver(() => sim?.setColors(readSimColors()));
    themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => {
      disposed = true;
      observer?.disconnect();
      themeObserver.disconnect();
      sim?.destroy();
      simRef.current = null;
    };
  }, [engine, fallback]);

  useEffect(() => {
    simRef.current?.setLayers(layers);
  }, [layers]);

  useEffect(() => {
    simRef.current?.setAspect(aspect);
  }, [aspect]);

  useEffect(() => {
    simRef.current?.setGreenery(greenery);
  }, [greenery]);

  // The canvas keeps the proportions of the framed street.
  const view = streetView(canyonGeometry(HEIGHT, aspect));
  const viewWidthH = view.width / HEIGHT;
  const viewHeightH = view.height / HEIGHT;
  const viewX0H = view.x0 / HEIGHT;
  const greeneryOverlay = greenery.map((e) => ({
    ...e,
    left: ((e.x0 - viewX0H) / viewWidthH) * 100,
    width: ((e.x1 - e.x0) / viewWidthH) * 100,
    bottom: (e.z0 / viewHeightH) * 100,
    height: ((e.z1 - e.z0) / viewHeightH) * 100,
  }));
  const toH = (dxPx: number, el: HTMLElement) =>
    (dxPx / el.getBoundingClientRect().width) * (view.width / HEIGHT);

  if (failed) {
    return (
      <div className="grid aspect-[2/1] place-items-center rounded-lg border border-line p-4 text-ink-muted">
        {failed}
      </div>
    );
  }
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-line bg-surface">
      <canvas
        // A canvas that once had a WebGPU context cannot give a 2D one; a new key means a new canvas.
        key={fallback ?? engine}
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={`block w-full bg-surface ${
          onDrag && greenery.length > 0 ? 'cursor-ew-resize touch-pan-y' : ''
        }`}
        style={{ aspectRatio: `${view.width} / ${view.height}` }}
        onPointerDown={(e) => {
          if (!onDrag || greenery.length === 0) return;
          dragFrom.current = e.clientX;
          const rect = e.currentTarget.getBoundingClientRect();
          const xH = (((e.clientX - rect.left) / rect.width) * view.width) / HEIGHT + viewX0H;
          const target = greenery.find((element) => xH >= element.x0 && xH <= element.x1);
          dragTarget.current =
            target?.id ??
            greenery.reduce((closest, element) => {
              const distance =
                xH < element.x0 ? element.x0 - xH : xH > element.x1 ? xH - element.x1 : 0;
              const closestDistance =
                xH < closest.x0 ? closest.x0 - xH : xH > closest.x1 ? xH - closest.x1 : 0;
              return distance < closestDistance ? element : closest;
            }).id;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragFrom.current === null || !onDrag) return;
          const dx = toH(e.clientX - dragFrom.current, e.currentTarget);
          if (Math.abs(dx) < 0.01) return;
          dragFrom.current = e.clientX;
          onDrag(dx, dragTarget.current);
        }}
        onPointerUp={() => {
          dragFrom.current = null;
          dragTarget.current = undefined;
        }}
        onPointerCancel={() => {
          dragFrom.current = null;
          dragTarget.current = undefined;
        }}
      />
      <div className="pointer-events-none absolute inset-0">
        {greeneryOverlay.map((e) => (
          <div
            key={e.id}
            className="absolute"
            style={{
              left: `${e.left}%`,
              width: `${e.width}%`,
              bottom: `${e.bottom}%`,
              height: `${e.height}%`,
            }}
          >
            {e.kind === 'trees' ? (
              <>
                <div
                  className="absolute bottom-0 left-1/2 h-[35%] w-[3%] min-w-[2px] -translate-x-1/2 rounded-t bg-[#62b887]/80"
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-0 rounded-[38%] border border-[#9ae0b4]/80 bg-[radial-gradient(circle_at_25%_35%,rgba(190,241,207,0.8)_0_5%,transparent_6%),radial-gradient(circle_at_58%_22%,rgba(190,241,207,0.65)_0_6%,transparent_7%),radial-gradient(circle_at_78%_52%,rgba(190,241,207,0.7)_0_5%,transparent_6%),rgba(93,184,133,0.3)]"
                  aria-label="Tree crown"
                />
              </>
            ) : (
              <div
                className="absolute inset-0 rounded-sm border border-[#ebbe63]/90 bg-[#d6a44b]/30"
                aria-label="Hedge"
              />
            )}
          </div>
        ))}
        <div
          className="absolute rounded-sm border border-[var(--ink)]/50"
          style={{
            left: '10%',
            top: '62%',
            width: '18%',
            height: '14%',
            background:
              'linear-gradient(90deg,rgba(255,179,0,0.65),rgba(255,100,80,0.7),rgba(255,64,64,0.85))',
          }}
          aria-label={t('design.canvasUtciZone')}
        />
        <div
          className="absolute rounded-sm border border-[var(--ink)]/50"
          style={{
            right: '10%',
            top: '62%',
            width: '18%',
            height: '14%',
            background:
              'linear-gradient(90deg,rgba(255,179,0,0.65),rgba(255,100,80,0.7),rgba(255,64,64,0.85))',
          }}
          aria-label={t('design.canvasUtciZone')}
        />
        {greenery.length > 0 && (
          <div className="absolute left-2 top-2 rounded-full border border-accent bg-surface/90 px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-ink-muted">
            {t('design.canvasShadeBand')}
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-full border border-line bg-surface/90 px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-ink-muted">
          {t('design.canvasUtciStrip')}
        </div>
      </div>
    </div>
  );
}
