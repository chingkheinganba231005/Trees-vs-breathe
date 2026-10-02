// Colour maths for the palette checks. Formulas: WCAG 2.2 relative luminance and contrast ratio
// (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance), CIE 1976 L* with the D65 white point.

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// For sRGB primaries, CIE Y equals the WCAG relative luminance, so L* follows directly.
export function lightness(hex: string): number {
  const y = relativeLuminance(hex);
  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  return y > eps ? 116 * Math.cbrt(y) - 16 : kappa * y;
}
