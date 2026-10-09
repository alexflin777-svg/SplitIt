/**
 * Распознавание чеков SplitIT (в устройстве, Tesseract.js; облака нет).
 *
 * Из текста чека извлекаются: итог, название, язык, валюта и позиции
 * («название … цена», «2 x 150.00», «кол-во × цена = сумма»). Разбор текста —
 * чистые функции (extractDataFromText и помощники), они покрыты
 * test/ocr.test.mjs без запуска движка.
 */

import { CURRENCIES } from './currency';

/** Коды traineddata Tesseract, которые мы различаем. */
export type OcrLanguage = 'rus' | 'eng' | 'deu' | 'fra' | 'spa' | 'ita' | 'por' | 'tur' | 'kaz';

export interface ReceiptItem {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface OcrResult {
  rawText: string;
  suggestedTotal: number | null;
  suggestedTitle: string | null;
  /** Старое поле (название и сумма позиции) — оставлено для совместимости. */
  detectedItems: Array<{ name: string; price: number }>;
  detectedLanguage: OcrLanguage;
  /** Код валюты (ISO 4217) по символам/кодам в чеке или по языку; null — непонятно. */
  detectedCurrency: string | null;
  items: ReceiptItem[];
  itemsCount: number;
}

/** Дальше нет смысла запускать распознавание: браузер съест память и повиснет. */
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

/** Языки, для которых имеет смысл второй проход своей моделью. */
const SECOND_PASS_LANGUAGES = new Set<OcrLanguage>(['deu', 'fra', 'spa', 'ita', 'por', 'tur']);

export interface OcrOutcome {
  /** 'ok' — что-то распознано, 'empty' — движок отработал, но данных нет. */
  status: 'ok' | 'empty' | 'error';
  result: OcrResult | null;
  /** Текст для пользователя. Заполнен всегда, кроме успешного распознавания. */
  message: string | null;
}

declare global {
  interface Window {
    /** Только для E2E-сборки (NEXT_PUBLIC_OCR_TEST_HOOK=1): текст вместо Tesseract. */
    __splititOcrText?: string;
  }
}

/**
 * Распознавание чека.
 *
 * Исход возвращается явно: сбой не притворяется результатом (раньше любая
 * ошибка Tesseract превращалась в «Оплата по чеку» и вечный спиннер).
 */
export async function parseReceiptImage(imageFile: File | Blob): Promise<OcrOutcome> {
  if (imageFile.size > MAX_RECEIPT_BYTES) {
    const mb = (imageFile.size / 1024 / 1024).toFixed(1);
    return {
      status: 'error',
      result: null,
      message: `Файл слишком большой (${mb} МБ). Распознавание работает с файлами до 8 МБ — сфотографируйте чек в меньшем разрешении или введите сумму вручную.`,
    };
  }

  if (imageFile instanceof File && !imageFile.type.startsWith('image/')) {
    return {
      status: 'error',
      result: null,
      message: 'Это не изображение. Выберите фотографию чека или введите сумму вручную.',
    };
  }

  try {
    const text = await recognizeText(imageFile);
    const result = extractDataFromText(text);

    if (result.suggestedTotal === null && result.items.length === 0) {
      return {
        status: 'empty',
        result,
        message: 'Сумма в чеке не распозналась. Введите её вручную.',
      };
    }

    return { status: 'ok', result, message: null };
  } catch (error: any) {
    console.error('[SplitIT] Ошибка распознавания чека', error);
    return {
      status: 'error',
      result: null,
      message: `Не удалось распознать чек: ${error?.message ?? 'движок распознавания недоступен'}. Введите сумму вручную.`,
    };
  }
}

/**
 * Первый проход — eng+rus. Если по тексту похоже на de/fr/es/it/pt/tr, второй
 * проход моделью этого языка: диакритика и слова вроде «Summe»/«Toplam»
 * распознаются заметно точнее. Сбой второго прохода не роняет распознавание —
 * остаётся текст первого, а причина пишется в консоль.
 */
async function recognizeText(imageFile: File | Blob): Promise<string> {
  if (
    process.env.NEXT_PUBLIC_OCR_TEST_HOOK === '1' &&
    typeof window !== 'undefined' &&
    typeof window.__splititOcrText === 'string'
  ) {
    return window.__splititOcrText;
  }

  const Tesseract = await import('tesseract.js');
  const first = await Tesseract.recognize(imageFile, 'eng+rus', { logger: () => {} });
  const language = detectLanguage(first.data.text);
  if (!SECOND_PASS_LANGUAGES.has(language)) return first.data.text;

  try {
    const second = await Tesseract.recognize(imageFile, `${language}+eng`, { logger: () => {} });
    return second.data.text || first.data.text;
  } catch (error) {
    console.warn(`[SplitIT] Второй проход OCR (${language}) не удался, используется первый`, error);
    return first.data.text;
  }
}

// ---------------------------------------------------------------------------
// Язык
// ---------------------------------------------------------------------------

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

// Кириллица и диакритика — не «слово» для \b, поэтому границы заданы явно.
const LETTER = 'A-Za-zÀ-ÿĞğİıŞşА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі';
// Без ретроспективной проверки (lookbehind): WebKit понимает её только с
// iOS 16.4, а приложение поддерживает iOS 15 — модуль упал бы с SyntaxError
// при загрузке экрана. Поэтому предыдущий символ захватывается явно.
const NOT_LETTER_BEFORE = `(?:^|[^${LETTER}])`;
const NOT_LETTER_AFTER = `(?![${LETTER}])`;
const word = (w: string, flags = 'gi') => new RegExp(`${NOT_LETTER_BEFORE}(?:${w})${NOT_LETTER_AFTER}`, flags);

const LATIN_LANGUAGE_HINTS: Array<{ lang: OcrLanguage; letters: RegExp; words: RegExp }> = [
  { lang: 'tur', letters: /[ğışŞĞİ]/g, words: word('TOPLAM|KDV|NAK[İI]T|F[İI]Ş|TUTAR|PARA [ÜU]ST[ÜU]|TE[ŞS]EKK[ÜU]R') },
  { lang: 'deu', letters: /[äöüßÄÖÜ]/g, words: word('SUMME|MWST|GESAMT|R[ÜU]CKGELD|GEG\\.?|GEGEBEN|ZU ZAHLEN|BAR|DANKE') },
  { lang: 'fra', letters: /[éèêàçœùÉÈ]/g, words: word('TVA|TTC|MONTANT|ESP[ÈE]CES|RENDU|MERCI') },
  { lang: 'spa', letters: /[ñÑ¿¡]/g, words: word('GRACIAS|EFECTIVO|IMPORTE|CAMBIO') },
  { lang: 'ita', letters: /[ìòÌÒ]/g, words: word('TOTALE|GRAZIE|CONTANTI|RESTO|SCONTRINO|IMPORTO') },
  { lang: 'por', letters: /[ãõÃÕ]/g, words: word('OBRIGAD[OA]|TROCO|DINHEIRO|CONTRIBUINTE|NIF') },
];

/** Язык чека по доле кириллицы/латиницы, диакритике и служебным словам. */
export function detectLanguage(text: string): OcrLanguage {
  const cyrillic = count(text, /[а-яёәғқңөұүһі]/gi);
  const latin = count(text, /[a-z]/gi);

  if (cyrillic > latin) {
    return count(text, /[әғқңөұүһ]/gi) >= 2 || /БАРЛЫҒЫ|ЖИЫНЫ|ҚҚС/i.test(text) ? 'kaz' : 'rus';
  }

  let best: OcrLanguage = 'eng';
  let bestScore = 0;
  for (const hint of LATIN_LANGUAGE_HINTS) {
    const score = count(text, hint.letters) * 2 + count(text, hint.words) * 5;
    if (score > bestScore) {
      best = hint.lang;
      bestScore = score;
    }
  }
  return bestScore >= 5 ? best : 'eng';
}

// ---------------------------------------------------------------------------
// Валюта
// ---------------------------------------------------------------------------

const CURRENCY_MARKERS: Array<{ code: string; re: RegExp }> = [
  { code: 'RUB', re: /₽/g },
  { code: 'RUB', re: word('руб\\.?|RUB') },
  { code: 'KZT', re: /₸/g },
  { code: 'KZT', re: word('тг|тенге|KZT') },
  { code: 'TRY', re: /₺/g },
  { code: 'TRY', re: word('TL|TRY', 'g') },
  { code: 'EUR', re: /€/g },
  { code: 'EUR', re: word('EUR', 'g') },
  { code: 'GBP', re: /£/g },
  { code: 'GBP', re: word('GBP', 'g') },
  { code: 'GEL', re: /₾/g },
  { code: 'GEL', re: word('GEL|лари', 'g') },
  { code: 'CZK', re: word('Kč|CZK', 'g') },
  { code: 'PLN', re: word('zł|PLN', 'g') },
  { code: 'AED', re: word('AED', 'g') },
  { code: 'AED', re: /د\.إ/g },
  { code: 'UAH', re: /₴/g },
  { code: 'INR', re: /₹/g },
  { code: 'KRW', re: /₩/g },
  { code: 'CHF', re: word('CHF', 'g') },
  { code: 'USD', re: /\$/g },
  { code: 'USD', re: word('USD', 'g') },
  { code: 'JPY', re: word('JPY', 'g') },
  { code: 'CNY', re: word('CNY|RMB', 'g') },
  { code: 'YEN', re: /[¥円元]/g },
];

const CURRENCY_BY_LANGUAGE: Partial<Record<OcrLanguage, string>> = {
  rus: 'RUB',
  kaz: 'KZT',
  tur: 'TRY',
  deu: 'EUR',
  fra: 'EUR',
  spa: 'EUR',
  ita: 'EUR',
  por: 'EUR',
};

/** Валюта по символам и кодам в чеке; если их нет — подсказка по языку. */
export function detectCurrency(text: string, language: OcrLanguage = detectLanguage(text)): string | null {
  const scores = new Map<string, number>();
  for (const { code, re } of CURRENCY_MARKERS) {
    const n = count(text, re);
    if (n > 0) scores.set(code, (scores.get(code) ?? 0) + n);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [code, score] of scores) {
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }

  if (best === 'YEN') {
    // ¥ общий у иены и юаня: японская кана или 円 — иена, иероглифы без каны — юань.
    if (/[぀-ヿ円]/.test(text)) return 'JPY';
    if (/[一-鿿]/.test(text)) return 'CNY';
    return 'JPY';
  }
  return best ?? CURRENCY_BY_LANGUAGE[language] ?? null;
}

/** Есть ли валюта среди поддерживаемых приложением (для подстановки в форму). */
export function isSupportedCurrency(code: string | null): code is string {
  return !!code && code in CURRENCIES;
}

// ---------------------------------------------------------------------------
// Числа
// ---------------------------------------------------------------------------

/**
 * Денежное число в формате чека: «1 850,00», «1.234,56», «1,234.56», «45.90».
 * Последний разделитель с двумя цифрами после — десятичный, прочие — разряды.
 */
export function parseMoney(raw: string): number | null {
  const s = raw.replace(/[\s ']/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  let normalized: string;
  const decimal = s.match(/[.,](\d{2})$/);
  if (decimal) {
    normalized = s.slice(0, -3).replace(/[.,]/g, '') + '.' + decimal[1];
  } else {
    normalized = s.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '');
    if (/[.,]/.test(normalized)) return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Количество: «2», «0.850», «1,5». */
function parseQty(raw: string): number {
  return Number(raw.replace(',', '.'));
}

/** Деньги с копейками: «1 850,00», «1.234,56», «45.90». */
const MONEY = String.raw`\d{1,3}(?:[  ]\d{3})+[.,]\d{2}|\d{1,3}(?:[.,]\d{3})+[.,]\d{2}|\d+[.,]\d{2}`;
/** Хвост после цены: валюта или буква налоговой группы («3,50 A»). */
const PRICE_TAIL = String.raw`\s*(?:₽|€|\$|£|₺|₸|руб\.?|р\.?|TL|тг|EUR|USD|[A-Da-d])?\s*$`;
/** Перед ценой: пробел, «=», «*», валюта или начало строки. */
const PRICE_HEAD = String.raw`(?:^|[\s*=:₽€$£₺₸])`;

const TRAILING_PRICE = new RegExp(String.raw`${PRICE_HEAD}(${MONEY})${PRICE_TAIL}`);
const QTY_TIMES_PRICE = new RegExp(
  String.raw`(?:^|\s)(\d+(?:[.,]\d{1,3})?)\s*(?:шт\.?|pcs\.?|stk\.?|ad\.?|adet|кг|kg)?\s*[xXхХ×*@]\s*(${MONEY})(?:\s*=?\s*(${MONEY}))?${PRICE_TAIL}`,
);

// ---------------------------------------------------------------------------
// Итог и служебные строки
// ---------------------------------------------------------------------------

/** Сильные ключевые слова итога (последнее вхождение побеждает). */
const STRONG_TOTAL = word(
  'ИТОГО|ИТОГ|К ОПЛАТЕ|ЖИЫНЫ|БАРЛЫҒЫ|TOTAL|TOTALE|SUMME|GESAMT|ZU ZAHLEN|TOPLAM|IMPORTE TOTAL|MONTANT TTC',
  'i',
);
/** Слабые: используются, только если сильных нет; тоже закрывают список позиций. */
const WEAK_TOTAL = word('ВСЕГО|СУММА|SUBTOTAL|SUB TOTAL|ARA TOPLAM|ZWISCHENSUMME', 'i');
/** Налог, оплата, сдача, скидка, реквизиты — не позиции и не итог. */
const SERVICE_LINE = word(
  [
    'НДС', 'ҚҚС', 'СДАЧА', 'НАЛИЧН[А-Яа-я]*', 'БЕЗНАЛ[А-Яа-я]*', 'КАРТ[А-Яа-я]*', 'ОПЛАТА', 'СКИДКА', 'ИНН', 'КАССИР', 'СМЕНА',
    'TAX', 'VAT', 'CHANGE', 'CASH', 'CARD', 'VISA', 'MASTERCARD', 'TIPS?', 'DISCOUNT', 'GRATUITY',
    'MWST', 'UST', 'R[ÜU]CKGELD', 'GEG\\.?', 'GEGEBEN', 'RABATT', 'BAR',
    'KDV', 'NAK[İI]T', 'KRED[İI]', '[İI]ND[İI]R[İI]M', 'PARA [ÜU]ST[ÜU]',
    'TVA', 'ESP[ÈE]CES', 'RENDU', 'REMISE', 'IVA', 'CAMBIO', 'EFECTIVO', 'DESCUENTO', 'CONTANTI', 'RESTO', 'SCONTO', 'TROCO', 'DINHEIRO', 'DESCONTO',
    'Қолма-қол',
    // Реквизиты и шапка: телефон, стол, заказ — не позиции.
    'ТЕЛ\\.?', 'ТЕЛЕФОН', 'СТОЛ', 'ЗАКАЗ', 'TEL\\.?', 'PHONE', 'TABLE', 'ORDER', 'PAYMENT', 'PAID', 'MASA', 'TISCH', 'MESA', 'TAVOLO',
  ].join('|'),
  'i',
);

/** Последнее число в строке итога (с копейками или целое, в т.ч. «2 500»). */
function totalFromLine(line: string): number | null {
  const all = [...line.matchAll(new RegExp(`${MONEY}|\\d{1,3}(?:[ \\u00a0]\\d{3})+(?![.,]?\\d)|\\d+`, 'g'))];
  for (let i = all.length - 1; i >= 0; i--) {
    const value = parseMoney(all[i][0]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

const hasLetters = (s: string) => new RegExp(`[${LETTER}]{2,}`).test(s);
const cleanName = (s: string) => s.replace(/[\s.:*=@\-–—]+$/g, '').trim();

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

export function extractDataFromText(text: string): OcrResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const detectedLanguage = detectLanguage(text);

  let strongTotal: number | null = null;
  let weakTotal: number | null = null;
  let suggestedTitle: string | null = null;
  const items: ReceiptItem[] = [];
  // Строка с названием без цены: цена может прийти следующей строкой «2 x 89.90».
  let pendingName: string | null = null;
  let itemsClosed = false;

  for (const line of lines) {
    const isStrong = STRONG_TOTAL.test(line);
    const isWeak = !isStrong && WEAK_TOTAL.test(line);
    const isService = SERVICE_LINE.test(line);

    if ((isStrong || isWeak) && !isService) {
      const value = totalFromLine(line);
      if (value !== null && value < 1_000_000_000) {
        if (isStrong) strongTotal = value;
        else weakTotal = value;
      }
    }

    // Позиции идут до первой строки итога/подытога; дальше — налог, оплата, сдача.
    if (isStrong || isWeak) {
      itemsClosed = true;
      continue;
    }
    if (itemsClosed || isService) continue;

    const qty = line.match(QTY_TIMES_PRICE);
    if (qty && qty.index !== undefined) {
      const q = parseQty(qty[1]);
      const unit = parseMoney(qty[2]);
      const stated = qty[3] ? parseMoney(qty[3]) : null;
      const before = cleanName(line.slice(0, qty.index));
      const name = hasLetters(before) ? before : pendingName;
      if (name && unit !== null && unit > 0 && Number.isFinite(q) && q > 0) {
        const total = stated ?? Math.round(q * unit * 100) / 100;
        if (total > 0) items.push({ name: name.slice(0, 60), qty: q, unitPrice: unit, total });
      }
      pendingName = null;
      continue;
    }

    const price = line.match(TRAILING_PRICE);
    if (price && price.index !== undefined) {
      const name = cleanName(line.slice(0, price.index));
      const value = parseMoney(price[1]);
      if (hasLetters(name) && value !== null && value > 0) {
        items.push({ name: name.slice(0, 60), qty: 1, unitPrice: value, total: value });
        pendingName = null;
        continue;
      }
    }

    if (hasLetters(line)) {
      if (!suggestedTitle && line.length > 3 && !/ЧЕК|ИТОГО|СПАСИБО|ИНН|КАССА|RECEIPT|THANK|STORE #/i.test(line)) {
        suggestedTitle = line.substring(0, 30);
      }
      pendingName = line;
    }
  }

  let suggestedTotal = strongTotal ?? weakTotal;

  // Итога нет: сумма позиций, а если и позиций нет — наибольшее число с копейками.
  if (suggestedTotal === null && items.length > 0) {
    suggestedTotal = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
  }
  if (suggestedTotal === null) {
    let maxVal = 0;
    for (const m of text.match(new RegExp(MONEY, 'g')) ?? []) {
      const val = parseMoney(m);
      if (val !== null && val > maxVal && val < 500000) maxVal = val;
    }
    if (maxVal > 0) suggestedTotal = maxVal;
  }

  return {
    rawText: text,
    suggestedTotal,
    suggestedTitle: suggestedTitle || 'Покупка по чеку',
    detectedItems: items.map((i) => ({ name: i.name, price: i.total })),
    detectedLanguage,
    detectedCurrency: detectCurrency(text, detectedLanguage),
    items,
    itemsCount: items.length,
  };
}
