import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, lightness } from '../../apps/web/src/theme/color';
import {
  darkTheme,
  fumesRamp,
  heatRamp,
  lightTheme,
  textPairs,
} from '../../apps/web/src/theme/tokens';

const css = readFileSync(new URL('../../apps/web/src/index.css', import.meta.url), 'utf8');

function cssBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block in index.css`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

describe('colour tokens', () => {
  it('index.css matches tokens.ts in both themes', () => {
    expect(cssBlock(':root')).toEqual(lightTheme);
    expect(cssBlock(":root[data-theme='dark']")).toEqual(darkTheme);
  });

  for (const [name, theme] of [
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const) {
    it.each(textPairs)(`${name}: $fg on $bg meets WCAG AA`, ({ fg, bg, min }) => {
      expect(contrastRatio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(min);
    });
  }
});

describe('sequential ramps', () => {
  it.each([
    ['fumes', fumesRamp],
    ['heat', heatRamp],
  ] as const)('%s ramp gets steadily darker', (_name, ramp) => {
    const L = ramp.map(lightness);
    for (let i = 1; i < L.length; i++) {
      // A visible step in CIE L* between neighbours keeps the ramp readable in greyscale.
      expect(L[i - 1]! - L[i]!).toBeGreaterThan(3);
    }
  });
});

describe('colour maths', () => {
  it('reproduces the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 6);
  });

  it('gives L* of 0, 100 and about 53.4 for black, white and mid grey', () => {
    expect(lightness('#000000')).toBeCloseTo(0, 6);
    expect(lightness('#ffffff')).toBeCloseTo(100, 6);
    // #777777 has relative luminance 0.1845, so L* = 116 * 0.1845^(1/3) - 16.
    expect(lightness('#777777')).toBeCloseTo(116 * Math.cbrt(0.18447) - 16, 2);
  });
});
