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
import { translateWith } from './t';
import { localeSwitcher } from './loaded';

const STORAGE_KEY = 'splitit_locale';

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
 * client-side in the effect below, while no explicit choice is saved.
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
  // До эффекта — DEFAULT_LOCALE: разметка сервера и клиента совпадает (экспорт статический).
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [switchTo] = useState(() => localeSwitcher(setLocaleState));

  useEffect(() => {
    // Язык устройства не сохраняется: в хранилище лежит только явный выбор
    // человека. Раньше первый определённый язык записывался как выбор и
    // замораживался — если навигатор в первый миг сообщал en-US, интерфейс
    // оставался английским навсегда (круг 3, трасса в perf/REPORT.md).
    switchTo(readStoredLocale() ?? detectDeviceLocale());
  }, [switchTo]);

  const setLocale = useCallback((next: Locale) => {
    switchTo(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures — locale still applies for this session.
    }
  }, [switchTo]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translateWith(locale, key, vars),
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

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
