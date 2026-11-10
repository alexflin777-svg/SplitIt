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
 * Язык, сохранённый до 1.1.1, мог быть не выбором человека: первое определение
 * записывалось как выбор, и мгновенный en-US навигатора замораживал запасной en
 * (круг 3). Отличить такой en от осознанного нельзя — молча не меняем, а один раз
 * предлагаем язык устройства. manual — отметка явного выбора в 1.1.1.
 */
export function localeOffer(stored: Locale | null, manual: string | null, device: Locale): Locale | null {
  return stored === DEFAULT_LOCALE && !manual && device !== DEFAULT_LOCALE ? device : null;
}

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
