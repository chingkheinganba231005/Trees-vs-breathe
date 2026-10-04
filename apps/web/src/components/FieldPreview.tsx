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

      // The field is a wall-to-wall cross-section. Keep the built edges and street floor visible
      // so a canopy is not mistaken for another concentration block.
      const ground = Math.max(2 * dpr, height / FIELD_ROWS);
      const wall = Math.max(3 * dpr, width / FIELD_COLS);
      ctx.fillStyle = rgb(colors.building);
      ctx.globalAlpha = 0.32;
      ctx.fillRect(0, 0, wall, height);
      ctx.fillRect(width - wall, 0, wall, height);
      ctx.fillRect(0, height - ground, width, ground);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = rgb(colors.ink);
      ctx.lineWidth = Math.max(1, dpr);
      ctx.setLineDash([]);
      for (const e of elements) {
        const x0 = (e.x0 / widthH) * width;
        const x1 = (e.x1 / widthH) * width;
        const top = height - e.z1 * height;
        const bottom = height - e.z0 * height;
        const radius = Math.min(8 * dpr, Math.max(2 * dpr, (x1 - x0) / 8));

        // A porous crown is shown as a translucent canopy, not as a solid wall. The trunk is
        // symbolic because the surrogate and solver operate on the crown's drag envelope.
        if (e.kind === 'trees') {
          const trunkWidth = Math.max(2 * dpr, (x1 - x0) * 0.035);
          const trunkX = (x0 + x1) / 2 - trunkWidth / 2;
          ctx.fillStyle = 'rgba(93, 184, 133, 0.7)';
          ctx.fillRect(trunkX, bottom, trunkWidth, height - bottom);
          ctx.fillStyle = 'rgba(93, 184, 133, 0.22)';
        } else {
          ctx.fillStyle = 'rgba(214, 164, 75, 0.26)';
        }
        ctx.beginPath();
        ctx.roundRect(x0, top, x1 - x0, bottom - top, radius);
        ctx.fill();
        ctx.strokeStyle = e.kind === 'trees' ? 'rgba(138, 220, 169, 0.95)' : 'rgba(235, 190, 99, 0.95)';
        ctx.stroke();

        if (e.kind === 'trees') {
          ctx.fillStyle = 'rgba(190, 241, 207, 0.72)';
          const crownHeight = Math.max(1, bottom - top);
          const dotRadius = Math.max(1.5 * dpr, Math.min(3 * dpr, (x1 - x0) / 18));
          for (let x = x0 + dotRadius * 2; x < x1 - dotRadius; x += dotRadius * 3) {
            for (let y = top + dotRadius * 2; y < bottom - dotRadius; y += dotRadius * 3) {
              const offset = Math.floor((y - top) / Math.max(1, crownHeight / 5)) % 2;
              if ((Math.floor((x - x0) / Math.max(1, dotRadius)) + offset) % 3 === 0) {
                ctx.beginPath();
                ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
                ctx.fill();
              }
            }
          }
        }
      }
      ctx.globalAlpha = 1;
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
      // At most 18rem tall, at the street's own proportions.
      style={{
        aspectRatio: `${Math.min(4, Math.max(0.4, widthH))} / 1`,
        maxWidth: `${18 * Math.min(4, Math.max(0.4, widthH))}rem`,
      }}
    />
  );
}
