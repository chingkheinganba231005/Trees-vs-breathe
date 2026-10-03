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
  onDrag?: (dx: number) => void;
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
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragFrom.current === null || !onDrag) return;
          const dx = toH(e.clientX - dragFrom.current, e.currentTarget);
          if (Math.abs(dx) < 0.01) return;
          dragFrom.current = e.clientX;
          onDrag(dx);
        }}
        onPointerUp={() => {
          dragFrom.current = null;
        }}
        onPointerCancel={() => {
          dragFrom.current = null;
        }}
      />
      <div className="pointer-events-none absolute inset-0">
        {greenery.length > 0 && (
          <div
            className="absolute rounded-md border border-accent/60 bg-accent/10"
            style={{
              left: '20%',
              right: '20%',
              top: '18%',
              height: '28%',
            }}
          />
        )}
        <div
          className="absolute rounded-sm border border-[var(--ink)]/50"
          style={{
            left: '10%',
            top: '62%',
            width: '18%',
            height: '14%',
            background: 'linear-gradient(90deg,rgba(255,179,0,0.65),rgba(255,100,80,0.7),rgba(255,64,64,0.85))',
          }}
        />
        <div
          className="absolute rounded-sm border border-[var(--ink)]/50"
          style={{
            right: '10%',
            top: '62%',
            width: '18%',
            height: '14%',
            background: 'linear-gradient(90deg,rgba(255,179,0,0.65),rgba(255,100,80,0.7),rgba(255,64,64,0.85))',
          }}
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
