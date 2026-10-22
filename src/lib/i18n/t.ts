import { DEFAULT_LOCALE, Locale, SUPPORTED_LOCALES, detectDeviceLocale } from './config';
import { ALL_MESSAGES } from './messages';

const STORAGE_KEY = 'splitit_locale';

/**
 * Resolves the active locale outside of React — the data/service layer
 * (store.ts, remote-store.ts, supabase.ts, ...) has no access to
 * I18nProvider's context. Reads the same localStorage key I18nProvider
 * writes to, so both stay in sync without sharing runtime state.
 */
function currentLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through.
  }
  return detectDeviceLocale();
}

export function translateWith(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const dict = ALL_MESSAGES[locale] ?? ALL_MESSAGES[DEFAULT_LOCALE];
  // Множественное число: при числовом count берётся вариант `key#one|few|many`
  // по правилам языка, если он есть в словаре; иначе — базовый ключ. Без этого
  // экран писал «1 участников».
  const count = vars?.count;
  const plural =
    typeof count === 'number' ? dict[`${key}#${new Intl.PluralRules(locale).select(count)}`] : undefined;
  let str = plural ?? dict[key] ?? ALL_MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

/** Non-hook translator for modules outside the React tree. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translateWith(currentLocale(), key, vars);
}
