export type Locale =
  | 'ru'
  | 'en'
  | 'es'
  | 'de'
  | 'fr'
  | 'it'
  | 'pt'
  | 'tr'
  | 'zh'
  | 'ja';

export const SUPPORTED_LOCALES: Locale[] = [
  'ru',
  'en',
  'es',
  'de',
  'fr',
  'it',
  'pt',
  'tr',
  'zh',
  'ja',
];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  tr: 'Türkçe',
  zh: '中文',
  ja: '日本語',
};

/**
 * Detects the device/browser locale and maps it to one of our supported
 * locales. Used only as the *default* on first launch — the user's explicit
 * choice (stored later) always wins once they change it in Profile settings.
 *
 * Falls back to English when the device language isn't one we ship, or when
 * running server-side / in an environment without `navigator`.
 */
export function detectDeviceLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  const candidates = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language];

  for (const raw of candidates) {
    if (!raw) continue;
    const base = raw.toLowerCase().split('-')[0];
    // Chinese: prefer matching by full tag first since zh-TW/zh-HK/zh-CN all
    // map to the same 'zh' bucket in this app (no Traditional/Simplified split yet).
    if (base === 'zh') return 'zh';
    if ((SUPPORTED_LOCALES as string[]).includes(base)) {
      return base as Locale;
    }
  }

  return DEFAULT_LOCALE;
}
