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
 * Запуск: `npm run lint:i18n` (через tsx — локали лежат в .ts).
 */
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

const reference = ALL_MESSAGES[REFERENCE];
const refKeys = Object.keys(reference);
const problems = [];

for (const [locale, messages] of Object.entries(ALL_MESSAGES)) {
  if (locale === REFERENCE) continue;
  const allowed = new Set([...SAME_EVERYWHERE, ...(SAME_IN_LOCALE[locale] ?? [])]);

  for (const key of refKeys) {
    if (!(key in messages)) problems.push(`${locale}: нет ключа ${key}`);
    else if (messages[key] === reference[key] && !allowed.has(key)) {
      problems.push(`${locale}: ${key} не переведён («${reference[key]}»)`);
    }
  }
  for (const key of Object.keys(messages)) {
    if (!(key in reference)) problems.push(`${locale}: лишний ключ ${key} (нет в ${REFERENCE})`);
  }
}

if (problems.length) {
  console.error(`i18n: ${problems.length} расхождений\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n: ${Object.keys(ALL_MESSAGES).length} локалей × ${refKeys.length} ключей — расхождений нет.`);
