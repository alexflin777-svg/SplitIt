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

export const ALL_MESSAGES: Record<Locale, Record<string, string>> = {
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
