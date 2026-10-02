import { useEffect, useRef, useState } from 'react';
import type { Layers } from '../sim/cpu/canvasRenderer';
import type { EngineChoice } from '../sim/engine';
import { canyonGeometry } from '../sim/street';
import type { EngineNote, SimStats, StreetSim } from '../sim/streetSim';
import { createStreetSim, HEIGHT } from '../sim/streetSim';
import { readSimColors, streetView } from '../sim/view';

interface Props {
  aspect: number;
  layers: Layers;
  engine: EngineChoice;
  onStats: (stats: SimStats) => void;
  label: string;
}

/** The live street cross-section. Owns the solver for as long as it is on screen. */
export function StreetSimulation({ aspect, layers, engine, onStats, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<StreetSim | null>(null);
  const statsRef = useRef(onStats);
  const layersRef = useRef(layers);
  const aspectRef = useRef(aspect);
  const [failed, setFailed] = useState<string | null>(null);
  // Set when the GPU fails mid-run; the simulation then restarts on the CPU worker.
  const [fallback, setFallback] = useState<EngineNote | null>(null);

  useEffect(() => {
    statsRef.current = onStats;
    layersRef.current = layers;
    aspectRef.current = aspect;
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

  // The canvas keeps the proportions of the framed street at the GPU resolution.
  const view = streetView(canyonGeometry(HEIGHT.gpu, aspect));

  if (failed) {
    return (
      <div className="grid aspect-[2/1] place-items-center rounded-lg border border-line p-4 text-ink-muted">
        {failed}
      </div>
    );
  }
  return (
    <canvas
      // A canvas that once had a WebGPU context cannot give a 2D one; a new key means a new canvas.
      key={fallback ?? engine}
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="block w-full rounded-lg border border-line bg-surface"
      style={{ aspectRatio: `${view.width} / ${view.height}` }}
    />
  );
}
