'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DEFAULT_LOCALE,
  detectDeviceLocale,
  Locale,
  SUPPORTED_LOCALES,
} from './config';
import { messages as ru } from './locales/ru';
import { messages as en } from './locales/en';
import { messages as es } from './locales/es';
import { messages as de } from './locales/de';
import { messages as fr } from './locales/fr';
import { messages as it } from './locales/it';
import { messages as pt } from './locales/pt';
import { messages as tr } from './locales/tr';
import { messages as zh } from './locales/zh';
import { messages as ja } from './locales/ja';

const STORAGE_KEY = 'splitit_locale';

const ALL_MESSAGES: Record<Locale, Record<string, string>> = {
  ru,
  en,
  es,
  de,
  fr,
  it,
  pt,
  tr,
  zh,
  ja,
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Resolves the locale to use on first paint, before any client-side
 * detection can run: reads a previously saved explicit choice, otherwise
 * falls back to DEFAULT_LOCALE. This keeps server/client markup identical
 * (avoids hydration mismatches) — device-language detection only kicks in
 * client-side in the effect below, on genuinely first launch.
 */
function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — treat as unset.
  }
  return null;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStoredLocale();
    if (stored) {
      setLocaleState(stored);
    } else {
      // First launch, no explicit choice saved yet: use the device/browser
      // language. This is the "installs with device language by default"
      // requirement — it only applies once, before the user ever picks a
      // language themselves.
      const deviceLocale = detectDeviceLocale();
      setLocaleState(deviceLocale);
      try {
        window.localStorage.setItem(STORAGE_KEY, deviceLocale);
      } catch {
        // Ignore — falls back to detecting again next launch, harmless.
      }
    }
    setHydrated(true);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures — locale still applies for this session.
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = ALL_MESSAGES[locale] ?? ALL_MESSAGES[DEFAULT_LOCALE];
      let str = dict[key] ?? ALL_MESSAGES[DEFAULT_LOCALE][key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replaceAll(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  // Avoid flashing untranslated/default-locale content before hydration
  // resolves the real locale on first paint; children still render (SSR/
  // export needs static output), just briefly in DEFAULT_LOCALE.
  void hydrated;

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
