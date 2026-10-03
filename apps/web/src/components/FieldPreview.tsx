import { useEffect, useRef, useSyncExternalStore } from 'react';
import { FIELD_COLS, FIELD_ROWS } from '../ai/fieldInput';
import type { GreenElement } from '../sim/greenery';
import { fumesAlpha, fumesColor, fumesStops, fumesT, isDark } from '../sim/fumesColor';
import { readSimColors } from '../sim/view';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const themeSnapshot = () => document.documentElement.getAttribute('data-theme') ?? 'light';

const rgb = (c: ArrayLike<number>) =>
  `rgb(${Math.round(c[0]! * 255)} ${Math.round(c[1]! * 255)} ${Math.round(c[2]! * 255)})`;

/**
 * The field model's c+ over the street, wall to wall and ground to roofs, drawn with the fumes
 * ramp at the street's true proportions, with the design's blocks outlined.
 */
export function FieldPreview({
  cplus,
  widthH,
  elements,
  cmax,
  label,
}: {
  /** c+ per grid cell, FIELD_ROWS x FIELD_COLS, row 0 at the ground. */
  cplus: Float32Array;
  /** Street width in units of H. */
  widthH: number;
  elements: readonly GreenElement[];
  cmax: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useSyncExternalStore(subscribe, themeSnapshot, () => 'light');
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      const { width, height } = canvas;
      const colors = readSimColors();
      const bg = colors.background;
      ctx.fillStyle = rgb(bg);
      ctx.fillRect(0, 0, width, height);
      const stops = fumesStops(isDark(bg));
      const cw = width / FIELD_COLS;
      const ch = height / FIELD_ROWS;
      for (let r = 0; r < FIELD_ROWS; r++) {
        for (let c = 0; c < FIELD_COLS; c++) {
          const t = fumesT(cplus[r * FIELD_COLS + c]!, cmax);
          if (t <= 0) continue;
          const a = fumesAlpha(t);
          const f = fumesColor(t, stops);
          ctx.fillStyle = rgb([0, 1, 2].map((j) => bg[j]! + a * (f[j]! - bg[j]!)));
          ctx.fillRect(c * cw, height - (r + 1) * ch, cw + 1, ch + 1);
        }
      }
      ctx.strokeStyle = rgb(colors.ink);
      ctx.lineWidth = Math.max(1, dpr);
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      for (const e of elements) {
        const x0 = (e.x0 / widthH) * width;
        const x1 = (e.x1 / widthH) * width;
        ctx.strokeRect(x0, height - e.z1 * height, x1 - x0, (e.z1 - e.z0) * height);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
    // The theme changes the colours read inside draw.
  }, [cplus, widthH, elements, cmax, theme]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="w-full rounded-md border border-line"
      style={{ aspectRatio: `${Math.min(4, Math.max(0.4, widthH))} / 1` }}
    />
  );
}
