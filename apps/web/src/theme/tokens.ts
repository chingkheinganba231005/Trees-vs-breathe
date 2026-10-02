// Single source for colour values. index.css repeats them as CSS variables;
// tests/web/theme.test.ts checks the two agree and that text pairs meet WCAG AA.

export const lightTheme = {
  bg: '#fafafa',
  surface: '#ffffff',
  'surface-2': '#f1f1f0',
  ink: '#171717',
  'ink-muted': '#525252',
  line: '#d9d9d6',
  accent: '#1d6b3b',
  'accent-ink': '#ffffff',
  'accent-soft': '#e2efe6',
} as const;

export const darkTheme = {
  bg: '#0e0e0e',
  surface: '#171717',
  'surface-2': '#212121',
  ink: '#ededed',
  'ink-muted': '#a3a3a3',
  line: '#333333',
  accent: '#6cc28a',
  'accent-ink': '#0e0e0e',
  'accent-soft': '#173022',
} as const;

export type ThemeTokens = Record<keyof typeof lightTheme, string>;

// Sequential ramps, low value first. Each colour carries one meaning only:
// violet-grey is fumes, yellow-to-red is heat, green is the user's design and trees.
export const fumesRamp = [
  '#f4f3f7',
  '#e2deeb',
  '#cbc3dc',
  '#b2a6cb',
  '#9888b8',
  '#7e6ba3',
  '#65518b',
  '#4d3b70',
  '#362852',
] as const;

export const heatRamp = [
  '#fff7c2',
  '#fee58a',
  '#fdcb5a',
  '#fba83d',
  '#f5822c',
  '#e85a24',
  '#cf3820',
  '#a8221c',
  '#741515',
] as const;

// Foreground/background pairs that carry text. Body text needs 4.5:1 (WCAG 2.2 SC 1.4.3);
// the accent is also used for large text and UI borders, which need 3:1 (SC 1.4.11).
export const textPairs: ReadonlyArray<{
  fg: keyof ThemeTokens;
  bg: keyof ThemeTokens;
  min: number;
}> = [
  { fg: 'ink', bg: 'bg', min: 4.5 },
  { fg: 'ink', bg: 'surface', min: 4.5 },
  { fg: 'ink', bg: 'surface-2', min: 4.5 },
  { fg: 'ink-muted', bg: 'bg', min: 4.5 },
  { fg: 'ink-muted', bg: 'surface', min: 4.5 },
  { fg: 'ink-muted', bg: 'surface-2', min: 4.5 },
  { fg: 'accent', bg: 'bg', min: 4.5 },
  { fg: 'accent', bg: 'surface', min: 4.5 },
  { fg: 'accent-ink', bg: 'accent', min: 4.5 },
  { fg: 'ink', bg: 'accent-soft', min: 4.5 },
  { fg: 'accent', bg: 'accent-soft', min: 4.5 },
];
