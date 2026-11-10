'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  DEFAULT_LOCALE,
  detectDeviceLocale,
  Locale,
  LOCALE_LABELS,
  localeOffer,
  SUPPORTED_LOCALES,
} from './config';
import { translateWith } from './t';
import { localeSwitcher } from './loaded';

const STORAGE_KEY = 'splitit_locale';
const MANUAL_KEY = 'splitit_locale_manual';

/** Предложение языка устройства для записи 1.0.x (localeOffer): читается как внешнее хранилище. */
const offerListeners = new Set<() => void>();
const subscribeOffer = (l: () => void) => {
  offerListeners.add(l);
  return () => offerListeners.delete(l);
};
function readOffer(): Locale | null {
  let manual: string | null;
  try {
    manual = window.localStorage.getItem(MANUAL_KEY);
  } catch {
    return null; // хранилище недоступно — выбор всё равно не сохранить, не предлагаем
  }
  return localeOffer(readStoredLocale(), manual, detectDeviceLocale());
}

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
      // Отметка: это выбор человека в 1.1.1 — предложение языка устройства больше не показывается.
      window.localStorage.setItem(MANUAL_KEY, '1');
    } catch {
      // Ignore write failures — locale still applies for this session.
    }
    for (const l of offerListeners) l();
  }, [switchTo]);

  const offer = useSyncExternalStore(subscribeOffer, readOffer, () => null);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translateWith(locale, key, vars),
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
      {offer && (
        <div
          role="dialog"
          aria-label={t('locale.offer', { lang: LOCALE_LABELS[offer] })}
          data-testid="locale-offer"
          className="fixed left-0 right-0 top-0 z-[60] px-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]"
        >
          <div className="mx-auto flex max-w-md items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
            <span className="flex-1">{t('locale.offer', { lang: LOCALE_LABELS[offer] })}</span>
            <button type="button" onClick={() => setLocale(offer)} className="h-10 rounded-full bg-white px-3.5 font-bold text-slate-900">
              {LOCALE_LABELS[offer]}
            </button>
            <button type="button" onClick={() => setLocale(locale)} className="h-10 rounded-full px-3 font-bold text-white/80">
              {t('locale.offerKeep')}
            </button>
          </div>
        </div>
      )}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
