import { describe, expect, it } from 'vitest';
import en from '../../apps/web/src/i18n/en.json';
import zhHant from '../../apps/web/src/i18n/zh-Hant.json';
import { detectLang, format } from '../../apps/web/src/i18n/strings';

describe('strings files', () => {
  it('zh-Hant has exactly the keys of en', () => {
    expect(Object.keys(zhHant).sort()).toEqual(Object.keys(en).sort());
  });

  it('no string is empty', () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(zhHant)]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('placeholders match between languages', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(zhHant[key]), key).toEqual(vars(en[key]));
    }
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(format('Planned for phase {phase}', { phase: 3 })).toBe('Planned for phase 3');
    expect(format('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });
});

describe('detectLang', () => {
  it.each([
    [['zh-HK'], 'zh-Hant'],
    [['zh-TW', 'en'], 'zh-Hant'],
    [['zh-Hant-HK'], 'zh-Hant'],
    [['zh-CN'], 'en'],
    [['en-GB', 'zh-HK'], 'en'],
    [['fr-FR', 'zh-HK'], 'zh-Hant'],
    [[], 'en'],
  ] as const)('%j -> %s', (langs, expected) => {
    expect(detectLang(langs)).toBe(expected);
  });
});
