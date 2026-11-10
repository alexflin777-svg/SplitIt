import type { Locale } from './config';
import { messages as ru } from './locales/ru';
import { messages as en } from './locales/en';
import { messages as ru11 } from './locales/v11/ru';
import { messages as en11 } from './locales/v11/en';

/**
 * Словари, доступные синхронно. В стартовом JS — только ru (основная аудитория)
 * и en (DEFAULT_LOCALE и запасной текст); остальные восемь языков грузятся
 * отдельными кусками при выборе (раньше все десять весили ~600 КБ на старте).
 * Полный набор для проверок — messages.ts (ALL_MESSAGES).
 */
export const LOADED: Partial<Record<Locale, Record<string, string>>> = {
  ru: { ...ru, ...ru11 },
  en: { ...en, ...en11 },
};

type Dict = { messages: Record<string, string> };
const pair = (a: Promise<Dict>, b: Promise<Dict>) => Promise.all([a, b]).then(([x, y]) => ({ ...x.messages, ...y.messages }));

// Каждый import() написан явно: сборщику нужен литерал пути, чтобы выделить кусок.
const LOADERS: Partial<Record<Locale, () => Promise<Record<string, string>>>> = {
  es: () => pair(import('./locales/es'), import('./locales/v11/es')),
  de: () => pair(import('./locales/de'), import('./locales/v11/de')),
  fr: () => pair(import('./locales/fr'), import('./locales/v11/fr')),
  it: () => pair(import('./locales/it'), import('./locales/v11/it')),
  pt: () => pair(import('./locales/pt'), import('./locales/v11/pt')),
  tr: () => pair(import('./locales/tr'), import('./locales/v11/tr')),
  zh: () => pair(import('./locales/zh'), import('./locales/v11/zh')),
  ja: () => pair(import('./locales/ja'), import('./locales/v11/ja')),
};

const pending: Partial<Record<Locale, Promise<void>>> = {};

/**
 * Переключатель языка: готовый словарь включается сразу, ленивый — после
 * загрузки (до неё виден прежний язык). При гонке побеждает последний выбор:
 * поздний ответ более раннего запроса не включается. Сбой загрузки — язык
 * включается с запасным текстом, а не молча остаётся прежним.
 */
export function localeSwitcher(apply: (l: Locale) => void, load = loadLocale) {
  let latest = 0;
  return (locale: Locale) => {
    const id = ++latest;
    if (LOADED[locale]) return apply(locale);
    load(locale).then(
      () => id === latest && apply(locale),
      (e) => {
        console.warn('[SplitIT] словарь не загрузился', locale, e);
        if (id === latest) apply(locale);
      },
    );
  };
}

/** Догружает словарь языка; повторные вызовы ждут ту же загрузку. */
export function loadLocale(locale: Locale): Promise<void> {
  if (LOADED[locale]) return Promise.resolve();
  const loader = LOADERS[locale];
  if (!loader) return Promise.resolve();
  return (pending[locale] ??= loader().then(
    (dict) => {
      LOADED[locale] = dict;
    },
    (e) => {
      delete pending[locale];
      throw e;
    },
  ));
}
