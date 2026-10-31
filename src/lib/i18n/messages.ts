import { Locale } from './config';
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
// Тексты экранов 1.1.0 — отдельными файлами, та же проверка полноты (scripts/check-i18n.mjs).
import { messages as ru11 } from './locales/v11/ru';
import { messages as en11 } from './locales/v11/en';
import { messages as es11 } from './locales/v11/es';
import { messages as de11 } from './locales/v11/de';
import { messages as fr11 } from './locales/v11/fr';
import { messages as it11 } from './locales/v11/it';
import { messages as pt11 } from './locales/v11/pt';
import { messages as tr11 } from './locales/v11/tr';
import { messages as zh11 } from './locales/v11/zh';
import { messages as ja11 } from './locales/v11/ja';

export const ALL_MESSAGES: Record<Locale, Record<string, string>> = {
  ru: { ...ru, ...ru11 },
  en: { ...en, ...en11 },
  es: { ...es, ...es11 },
  de: { ...de, ...de11 },
  fr: { ...fr, ...fr11 },
  it: { ...it, ...it11 },
  pt: { ...pt, ...pt11 },
  tr: { ...tr, ...tr11 },
  zh: { ...zh, ...zh11 },
  ja: { ...ja, ...ja11 },
};
