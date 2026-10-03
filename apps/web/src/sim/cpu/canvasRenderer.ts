import { fumesAlpha, fumesColor, fumesStops, fumesT, isDark } from '../fumesColor';
import type { Particles } from '../particles';
import { TRAIL } from '../particles';
import type { SimColors, ViewWindow } from '../view';

export interface Layers {
  wind: boolean;
  speed: boolean;
  /** Time-averaged traffic fumes, violet-grey. */
  fumes: boolean;
}

const css = (c: [number, number, number], a = 1) =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

/** What the field image shows besides speed: running-mean fumes and the greenery. */
export interface FieldExtras {
  /** Running-mean concentration per node, or null before the first frame. */
  conc: Float32Array | null;
  /** Converts conc to c+. */
  cScale: number;
  /** Drag lambda per node; greenery is drawn where it is positive. */
  drag: Float32Array | null;
}

/**
 * Canvas 2D drawing for the CPU engine: fumes and speed shading, greenery, buildings, and
 * fading wind trails.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly field: HTMLCanvasElement;
  private readonly fieldCtx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private readonly canvas: HTMLCanvasElement;
  private colors: SimColors;

  constructor(canvas: HTMLCanvasElement, colors: SimColors) {
    this.canvas = canvas;
    this.colors = colors;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.field = document.createElement('canvas');
    this.fieldCtx = this.field.getContext('2d')!;
  }

  setColors(colors: SimColors): void {
    this.colors = colors;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  draw(
    view: ViewWindow,
    nx: number,
    solid: Uint8Array,
    ux: Float32Array,
    uy: Float32Array,
    uRef: number,
    particles: Particles,
    layers: Layers,
    extras: FieldExtras = { conc: null, cScale: 0, drag: null },
  ): void {
    const { ctx, canvas, colors } = this;
    const sx = canvas.width / view.width;
    const sy = canvas.height / view.height;

    ctx.fillStyle = css(colors.background);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const showFumes = layers.fumes && extras.conc !== null && extras.cScale > 0;
    if (layers.speed || showFumes || extras.drag) {
      if (!this.image || this.image.width !== view.width || this.image.height !== view.height) {
        this.field.width = view.width;
        this.field.height = view.height;
        this.image = this.fieldCtx.createImageData(view.width, view.height);
      }
      const d = this.image.data;
      const stops = fumesStops(isDark(colors.background));
      const bg = colors.background;
      const ink = colors.ink;
      const green = colors.green;
      for (let y = 0; y < view.height; y++) {
        for (let x = 0; x < view.width; x++) {
          const k = y * nx + view.x0 + x;
          const o = ((view.height - 1 - y) * view.width + x) * 4;
          if (solid[k]) {
            d[o + 3] = 0;
            continue;
          }
          let r = bg[0];
          let g = bg[1];
          let b = bg[2];
          if (showFumes) {
            const t = fumesT(extras.conc![k]! * extras.cScale);
            const a = fumesAlpha(t);
            const f = fumesColor(t, stops);
            r += a * (f[0] - r);
            g += a * (f[1] - g);
            b += a * (f[2] - b);
          }
          if (layers.speed) {
            const a = 0.32 * Math.min(1, Math.hypot(ux[k]!, uy[k]!) / (1.2 * uRef));
            r += a * (ink[0] - r);
            g += a * (ink[1] - g);
            b += a * (ink[2] - b);
          }
          if (extras.drag && extras.drag[k]! > 0) {
            r += 0.45 * (green[0] - r);
            g += 0.45 * (green[1] - g);
            b += 0.45 * (green[2] - b);
          }
          d[o] = Math.round(255 * r);
          d[o + 1] = Math.round(255 * g);
          d[o + 2] = Math.round(255 * b);
          d[o + 3] = 255;
        }
      }
      this.fieldCtx.putImageData(this.image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.field, 0, 0, canvas.width, canvas.height);
    }

    if (layers.wind) {
      // Each particle draws its last few positions, older segments fainter. Drawing the history
      // explicitly avoids the grey haze that repeated fading leaves in an 8-bit canvas.
      ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
      ctx.lineCap = 'round';
      for (let j = 0; j < TRAIL - 1; j++) {
        ctx.strokeStyle = css(colors.particle, 0.85 * (1 - j / (TRAIL - 1)));
        ctx.beginPath();
        for (let p = 0; p < particles.count; p++) {
          const a = p * TRAIL + j;
          if (particles.age[p]! <= j) continue;
          ctx.moveTo(
            (particles.trailX[a]! - view.x0) * sx,
            canvas.height - particles.trailY[a]! * sy,
          );
          ctx.lineTo(
            (particles.trailX[a + 1]! - view.x0) * sx,
            canvas.height - particles.trailY[a + 1]! * sy,
          );
        }
        ctx.stroke();
      }
    }

    // Buildings last, so trails never draw over them.
    ctx.fillStyle = css(colors.building);
    for (let y = 0; y < view.height; y++) {
      let runStart = -1;
      for (let x = 0; x <= view.width; x++) {
        const isSolid = x < view.width && solid[y * nx + view.x0 + x] === 1;
        if (isSolid && runStart < 0) runStart = x;
        if (!isSolid && runStart >= 0) {
          ctx.fillRect(
            runStart * sx,
            canvas.height - (y + 1) * sy,
            (x - runStart) * sx + 0.5,
            sy + 0.5,
          );
          runStart = -1;
        }
      }
    }
  }
}
