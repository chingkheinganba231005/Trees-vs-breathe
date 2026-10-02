import en from './en.json';
import zhHant from './zh-Hant.json';

export type Lang = 'en' | 'zh-Hant';
export type StringKey = keyof typeof en;
export type Strings = Record<StringKey, string>;
export type Vars = Record<string, string | number>;

// zh-Hant.json must carry exactly the keys of en.json; tests/web/i18n.test.ts enforces it.
export const strings: Record<Lang, Strings> = { en, 'zh-Hant': zhHant as Strings };

export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

// Hong Kong, Taiwan and Macau users, or anyone asking for Hant script, get Traditional Chinese.
export function detectLang(languages: readonly string[]): Lang {
  for (const tag of languages) {
    const t = tag.toLowerCase();
    if (t.startsWith('zh')) {
      return t.includes('hant') || /-(hk|tw|mo)\b/.test(t) ? 'zh-Hant' : 'en';
    }
    if (t.startsWith('en')) return 'en';
  }
  return 'en';
}
