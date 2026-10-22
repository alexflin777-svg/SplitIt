/**
 * Проверка полноты переводов (P1-8).
 *
 * «10 языков» должно быть фактом, а не заявкой. Скрипт падает, если:
 *   1. в какой-либо локали нет ключа, который есть в `en`, или есть лишний;
 *   2. значение в не-английской локали совпадает с английским — то есть
 *      перевода нет, и пользователь видит английский текст под видом своего
 *      языка. Исключения — бренды и слова, которые в данном языке действительно
 *      пишутся так же (списки ниже).
 *
 * Формы множественного числа (`ключ#one`, `ключ#few`, …) проверяются так же
 * строго, но по правилам своего языка, а не по набору en:
 *   3. plural-ключ объявляется формами в `en`; в каждой локали обязательны все
 *      категории её Intl.PluralRules, кроме `other` (это базовый ключ). У ru это
 *      one/few/many, у en — one, у ja — ничего. Пропуск формы = «1 участников»;
 *   4. форма из категории, которой в языке нет, — ошибка (её не выберут никогда);
 *   5. форма, совпавшая с любой английской формой того же ключа, — не переведена.
 *
 * Запуск: `npm run lint:i18n` (через tsx — локали лежат в .ts). Сама проверка —
 * функция checkI18n: на ней держатся негативные тесты test/i18n-check.test.mjs.
 */
import { pathToFileURL } from 'node:url';
import { ALL_MESSAGES } from '../src/lib/i18n/messages.ts';

const REFERENCE = 'en';

// Одинаковы во всех языках: бренды и международные обозначения.
const SAME_EVERYWHERE = new Set([
  'app.tagline', // «Split-Check» — название продукта
  'auth.telegramWebApp', // «Telegram WebApp: @{name}» — бренд и ник
  'eventDetail.ok', // «OK»
]);

// Слова, которые в конкретном языке совпадают с английскими по праву.
const SAME_IN_LOCALE = {
  ru: ['auth.emailLabel', 'profile.email'],
  es: ['home.balance', 'eventDetail.balance', 'balance.title', 'eventDetail.actionBalance', 'common.error', 'eventDetail.categoryCount'],
  de: ['eventNew.category.restaurant', 'eventNew.category.party', 'home.filter.restaurant', 'profile.name', 'profile.versionLabel', 'eventDetail.category.transport', 'expenseNew.cat.transport'],
  fr: ['eventNew.category.restaurant', 'home.filter.restaurant', 'profile.versionLabel', 'eventDetail.categoryCount', 'eventDetail.contacts', 'eventDetail.category.transport', 'expenseNew.cat.transport'],
  it: ['nav.home', 'auth.emailLabel', 'auth.passwordLabel', 'profile.email', 'eventDetail.categoryCount', 'eventDetail.actionReport'],
  pt: ['eventDetail.categoryCount'],
};

const isPluralForm = (key) => key.includes('#');

/** Возвращает список расхождений; пустой список — проверка пройдена. */
export function checkI18n(all) {
  const reference = all[REFERENCE];
  const refKeys = Object.keys(reference).filter((key) => !isPluralForm(key));
  const problems = [];

  // Plural-ключи объявляет en: base → английские значения всех его форм.
  const pluralBases = new Map();
  for (const key of Object.keys(reference).filter(isPluralForm)) {
    const base = key.split('#')[0];
    if (!(base in reference)) problems.push(`${REFERENCE}: форма ${key} без базового ключа`);
    pluralBases.set(base, [...(pluralBases.get(base) ?? [reference[base]]), reference[key]]);
  }

  for (const [locale, messages] of Object.entries(all)) {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const allowed = new Set([...SAME_EVERYWHERE, ...(SAME_IN_LOCALE[locale] ?? [])]);

    for (const key of Object.keys(messages).filter(isPluralForm)) {
      const [base, category] = key.split('#');
      if (!pluralBases.has(base)) problems.push(`${locale}: форма ${key} — ключ не объявлен plural в ${REFERENCE}`);
      if (!categories.includes(category) || category === 'other') {
        problems.push(`${locale}: форма ${key} — категории «${category}» в языке нет или она задаётся базовым ключом`);
      }
      if (!messages[key].includes('{count}')) problems.push(`${locale}: форма ${key} без {count}`);
      if (locale !== REFERENCE && pluralBases.get(base)?.includes(messages[key]) && !allowed.has(base)) {
        problems.push(`${locale}: ${key} не переведён («${messages[key]}»)`);
      }
    }
    for (const base of pluralBases.keys()) {
      for (const category of categories) {
        if (category !== 'other' && !(`${base}#${category}` in messages)) {
          problems.push(`${locale}: нет формы ${base}#${category}`);
        }
      }
    }

    if (locale === REFERENCE) continue;
    for (const key of refKeys) {
      if (!(key in messages)) problems.push(`${locale}: нет ключа ${key}`);
      else if (messages[key] === reference[key] && !allowed.has(key)) {
        problems.push(`${locale}: ${key} не переведён («${reference[key]}»)`);
      }
    }
    for (const key of Object.keys(messages)) {
      if (!isPluralForm(key) && !(key in reference)) problems.push(`${locale}: лишний ключ ${key} (нет в ${REFERENCE})`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkI18n(ALL_MESSAGES);
  if (problems.length) {
    console.error(`i18n: ${problems.length} расхождений\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const keys = Object.keys(ALL_MESSAGES[REFERENCE]).filter((key) => !isPluralForm(key)).length;
  console.log(`i18n: ${Object.keys(ALL_MESSAGES).length} локалей × ${keys} ключей — расхождений нет.`);
}
