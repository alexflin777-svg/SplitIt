/**
 * Разбор текста чека.
 *
 * Запуск: node --test test/ocr.test.mjs
 *
 * Тестируется `extractDataFromText` — чистая функция, работающая по тексту,
 * который вернул Tesseract. Сам движок распознавания здесь не запускается:
 * он медленный, требует загрузки моделей и проверяет качество картинки, а не
 * нашу логику. Фикстуры — текст настоящих чеков со всеми их особенностями:
 * пробелы внутри чисел, запятая вместо точки, шапка и подвал.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractDataFromText } from '../src/lib/ocr.ts';

const ЧЕК_ПЯТЁРОЧКА = `
ПЯТЕРОЧКА
ул. Ленина, 42
Хлеб Бородинский 65.00
Молоко 3.2% 89.90
Сыр Российский 245.50
ИТОГО 400.40
НАЛИЧНЫМИ 500.00
СДАЧА 99.60
СПАСИБО ЗА ПОКУПКУ
ИНН 7707083893
`;

const ЧЕК_РЕСТОРАН = `
Ресторан "Веранда"
Стол 12
Салат Цезарь 620,00
Паста Карбонара 780,00
Вино бокал 450,00
К ОПЛАТЕ: 1 850,00
Обслуживание включено
`;

const ЧЕК_БЕЗ_ИТОГО = `
КОФЕЙНЯ
Капучино 250.00
Круассан 180.00
`;

const ЧЕК_АНГЛИЙСКИЙ = `
COFFEE HOUSE
Latte 4.50
Muffin 3.20
TOTAL 7.70
`;

describe('Извлечение итоговой суммы', () => {
  test('ИТОГО с точкой', () => {
    assert.equal(extractDataFromText(ЧЕК_ПЯТЁРОЧКА).suggestedTotal, 400.4);
  });

  test('К ОПЛАТЕ с запятой и пробелом внутри числа', () => {
    // «1 850,00» — обычный формат российского чека. Пробел как разделитель
    // разрядов и запятая как десятичный знак ломают наивный parseFloat.
    assert.equal(extractDataFromText(ЧЕК_РЕСТОРАН).suggestedTotal, 1850);
  });

  test('английский TOTAL', () => {
    assert.equal(extractDataFromText(ЧЕК_АНГЛИЙСКИЙ).suggestedTotal, 7.7);
  });

  test('без строки итога берётся сумма распознанных позиций', () => {
    // С F6 позиции разбираются, поэтому без итога честнее сложить их
    // (250 + 180), чем брать наибольшую цифру. Пользователь всё равно
    // проверяет сумму перед сохранением.
    assert.equal(extractDataFromText(ЧЕК_БЕЗ_ИТОГО).suggestedTotal, 430);
  });

  test('без итога и без позиций берётся наибольшее число с копейками', () => {
    assert.equal(extractDataFromText('КОФЕЙНЯ\n250.00\n180.00').suggestedTotal, 250);
  });

  test('сдача и наличные не принимаются за итог', () => {
    // «НАЛИЧНЫМИ 500.00» больше, чем «ИТОГО 400.40». Если бы функция брала
    // максимум вместо явного итога, в расход уехала бы сумма купюры.
    const r = extractDataFromText(ЧЕК_ПЯТЁРОЧКА);
    assert.equal(r.suggestedTotal, 400.4);
    assert.notEqual(r.suggestedTotal, 500);
  });
});

describe('Устойчивость к мусору', () => {
  test('пустой текст не роняет разбор', () => {
    const r = extractDataFromText('');
    assert.equal(r.suggestedTotal, null);
    assert.ok(typeof r.suggestedTitle === 'string');
  });

  test('текст без чисел', () => {
    const r = extractDataFromText('НЕРАСПОЗНАННЫЙ ТЕКСТ БЕЗ ЦИФР');
    assert.equal(r.suggestedTotal, null);
  });

  test('результат всегда нужной формы', () => {
    // UI читает четыре поля; отсутствие любого уронило бы экран расхода.
    for (const text of ['', 'мусор', ЧЕК_ПЯТЁРОЧКА, ЧЕК_БЕЗ_ИТОГО]) {
      const r = extractDataFromText(text);
      assert.ok('rawText' in r && 'suggestedTotal' in r);
      assert.ok('suggestedTitle' in r && Array.isArray(r.detectedItems));
      assert.ok(r.suggestedTotal === null || Number.isFinite(r.suggestedTotal));
    }
  });

  test('абсурдно большие числа не попадают в сумму', () => {
    // ИНН, номер чека и телефон — длинные числа, которые нельзя принять
    // за деньги.
    const r = extractDataFromText('ЧЕК\nИНН 770708389312\nТелефон 79161234567\nКофе 250.00');
    assert.ok(r.suggestedTotal === null || r.suggestedTotal < 500000, `получилось ${r.suggestedTotal}`);
  });
});

describe('Название расхода', () => {
  test('название берётся из шапки чека', () => {
    assert.match(extractDataFromText(ЧЕК_ПЯТЁРОЧКА).suggestedTitle, /ПЯТЕРОЧКА/);
  });

  test('служебные строки не идут в название', () => {
    const r = extractDataFromText(ЧЕК_ПЯТЁРОЧКА);
    assert.ok(!/ИТОГО|ИНН|СПАСИБО/.test(r.suggestedTitle), `в названии служебное: ${r.suggestedTitle}`);
  });

  test('название не пустое даже для мусора', () => {
    // Пустое название заблокировало бы сохранение: форма его требует.
    assert.ok(extractDataFromText('').suggestedTitle.length > 0);
  });

  test('название не длиннее разумного', () => {
    const длинный = 'А'.repeat(200) + '\nИТОГО 100.00';
    assert.ok(extractDataFromText(длинный).suggestedTitle.length <= 40);
  });
});

// ---------------------------------------------------------------------------
// F6: язык, валюта, позиции (цикл «iPhone-фидбек 1»)
// ---------------------------------------------------------------------------

import { detectLanguage, detectCurrency, parseMoney } from '../src/lib/ocr.ts';

const ЧЕК_ПЯТЁРОЧКА_ПОЗИЦИИ = `
ООО "АГРОТОРГ" ПЯТЕРОЧКА
Кассовый чек. Приход
Хлеб Бородинский 65.00
Молоко 3.2% 1л
2 X 89.90 = 179.80
Сыр Российский 245.50
Бананы 0.850 кг х 129.99 = 110.49
ИТОГО =600.79
СУММА НДС 20% 54.62
НАЛИЧНЫМИ =1000.00
СДАЧА =399.21
ИНН 7825706086
`;

const ЧЕК_США = `
TRADER JOE'S
Store #552
BANANAS 0.99
ORGANIC MILK 2 @ 3.49
2 x 3.49 6.98
SOURDOUGH BREAD 4.49
SUBTOTAL 12.46
SALES TAX 8.875% 1.11
TOTAL $13.57
VISA ****1234 $13.57
THANK YOU
`;

const ЧЕК_ГЕРМАНИЯ = `
REWE Markt GmbH
Brötchen 3 x 0,45 1,35 A
Vollmilch 1,19 A
Käse Gouda 2,79 A
Äpfel 1,5 kg 2,98 A
SUMME EUR 8,31
Geg. BAR EUR 10,00
Rückgeld EUR 1,69
MwSt 7% 0,54
Vielen Dank
`;

const ЧЕК_ТУРЦИЯ = `
MİGROS TİCARET A.Ş.
FİŞ NO: 0042
SU 0,5 LT 2 x 7,50 15,00
EKMEK 12,50
PEYNİR 89,90
ARA TOPLAM 117,40
KDV 8,70
TOPLAM ₺117,40
NAKİT 120,00
PARA ÜSTÜ 2,60
`;

const ЧЕК_КАЗАХСТАН = `
ТОО "SMALL" Алматы
Сатып алу чегі / Чек покупки
Нан 250.00 ₸
Сүт 2 x 450.00 = 900.00
Ірімшік 1 350.00
БАРЛЫҒЫ / ИТОГО: 2 500.00 ₸
ҚҚС 12%: 267.86
Қолма-қол / Наличные 3 000.00
`;

describe('F6: язык чека', () => {
  test('RU (Пятёрочка) — rus', () => assert.equal(detectLanguage(ЧЕК_ПЯТЁРОЧКА_ПОЗИЦИИ), 'rus'));
  test('EN (США) — eng', () => assert.equal(detectLanguage(ЧЕК_США), 'eng'));
  test('DE (REWE) — deu', () => assert.equal(detectLanguage(ЧЕК_ГЕРМАНИЯ), 'deu'));
  test('TR (Migros) — tur', () => assert.equal(detectLanguage(ЧЕК_ТУРЦИЯ), 'tur'));
  test('KZ (двуязычный) — kaz', () => assert.equal(detectLanguage(ЧЕК_КАЗАХСТАН), 'kaz'));
  test('пустой текст — eng, без падения', () => assert.equal(detectLanguage(''), 'eng'));
});

describe('F6: валюта чека', () => {
  test('RU без символа — RUB по языку', () => assert.equal(detectCurrency(ЧЕК_ПЯТЁРОЧКА_ПОЗИЦИИ), 'RUB'));
  test('$ — USD', () => assert.equal(detectCurrency(ЧЕК_США), 'USD'));
  test('EUR в строках — EUR', () => assert.equal(detectCurrency(ЧЕК_ГЕРМАНИЯ), 'EUR'));
  test('₺ — TRY', () => assert.equal(detectCurrency(ЧЕК_ТУРЦИЯ), 'TRY'));
  test('₸ — KZT', () => assert.equal(detectCurrency(ЧЕК_КАЗАХСТАН), 'KZT'));
  test('символы и коды', () => {
    assert.equal(detectCurrency('Total 12.00 £'), 'GBP');
    assert.equal(detectCurrency('Итого 15.00 ₾'), 'GEL');
    assert.equal(detectCurrency('Celkem 120,00 Kč'), 'CZK');
    assert.equal(detectCurrency('Razem 45,00 zł'), 'PLN');
    assert.equal(detectCurrency('TOTAL AED 45.00'), 'AED');
    assert.equal(detectCurrency('Итого 500 руб.'), 'RUB');
    assert.equal(detectCurrency('合計 ¥1,200 ありがとう'), 'JPY');
    assert.equal(detectCurrency('合计 ¥45.00 谢谢'), 'CNY');
  });
  test('английский без символа — валюта неизвестна (null), а не выдумана', () => {
    assert.equal(detectCurrency('COFFEE 4.50\nTOTAL 4.50'), null);
  });
});

describe('F6: числа в формате чека', () => {
  test('разные разделители', () => {
    assert.equal(parseMoney('1 850,00'), 1850);
    assert.equal(parseMoney('1.234,56'), 1234.56);
    assert.equal(parseMoney('1,234.56'), 1234.56);
    assert.equal(parseMoney('45.90'), 45.9);
    assert.equal(parseMoney('2 500'), 2500);
    assert.equal(parseMoney('abc'), null);
  });
});

function assertItemsConsistent(r) {
  for (const i of r.items) {
    assert.ok(i.name.length > 0, 'позиция без названия');
    for (const k of ['qty', 'unitPrice', 'total']) assert.ok(Number.isFinite(i[k]) && i[k] > 0, `${i.name}: ${k}=${i[k]}`);
    assert.ok(!/ИТОГО|TOTAL|SUMME|TOPLAM|НДС|TAX|KDV|MwSt|СДАЧА|NAKİT|BAR|VISA/i.test(i.name), `служебная строка в позициях: ${i.name}`);
  }
  assert.equal(r.itemsCount, r.items.length);
}

describe('F6: позиции и итог', () => {
  test('RU: 4 позиции, «2 X 89.90 = 179.80» с названием со строки выше, весовой товар', () => {
    const r = extractDataFromText(ЧЕК_ПЯТЁРОЧКА_ПОЗИЦИИ);
    assert.equal(r.suggestedTotal, 600.79);
    assertItemsConsistent(r);
    assert.equal(r.itemsCount, 4);
    const milk = r.items.find((i) => /Молоко/.test(i.name));
    assert.deepEqual([milk.qty, milk.unitPrice, milk.total], [2, 89.9, 179.8]);
    const bananas = r.items.find((i) => /Бананы/.test(i.name));
    assert.equal(bananas.total, 110.49);
  });

  test('EN: SUBTOTAL и TAX не позиции, итог — TOTAL с налогом', () => {
    const r = extractDataFromText(ЧЕК_США);
    assert.equal(r.suggestedTotal, 13.57);
    assertItemsConsistent(r);
    assert.equal(r.itemsCount, 3);
    assert.deepEqual(r.items.map((i) => i.total), [0.99, 6.98, 4.49]);
  });

  test('DE: «Summe», запятая, буква налоговой группы, 3 x 0,45', () => {
    const r = extractDataFromText(ЧЕК_ГЕРМАНИЯ);
    assert.equal(r.suggestedTotal, 8.31);
    assertItemsConsistent(r);
    assert.equal(r.itemsCount, 4);
    const rolls = r.items.find((i) => /Brötchen/.test(i.name));
    assert.deepEqual([rolls.qty, rolls.unitPrice, rolls.total], [3, 0.45, 1.35]);
  });

  test('TR: «Toplam», ARA TOPLAM и KDV не позиции', () => {
    const r = extractDataFromText(ЧЕК_ТУРЦИЯ);
    assert.equal(r.suggestedTotal, 117.4);
    assertItemsConsistent(r);
    assert.equal(r.itemsCount, 3);
  });

  test('KZ: «Барлығы / Итого» с пробелом в тысячах, ҚҚС не позиция', () => {
    const r = extractDataFromText(ЧЕК_КАЗАХСТАН);
    assert.equal(r.suggestedTotal, 2500);
    assertItemsConsistent(r);
    assert.equal(r.itemsCount, 3);
    assert.equal(r.items.reduce((s, i) => s + i.total, 0), 2500);
  });

  test('результат содержит язык, валюту и счётчик позиций', () => {
    const r = extractDataFromText(ЧЕК_ТУРЦИЯ);
    assert.equal(r.detectedLanguage, 'tur');
    assert.equal(r.detectedCurrency, 'TRY');
    assert.equal(typeof r.itemsCount, 'number');
  });
});

describe('F6: совместимость с iOS 15 (WKWebView)', () => {
  test('в ocr.ts нет lookbehind — WebKit до iOS 16.4 падает на нём с SyntaxError', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/lib/ocr.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\(\?<[!=]/);
  });
});

describe('F6: ложные позиции', () => {
  test('телефон, стол и оплата не становятся позициями', () => {
    const r = extractDataFromText('CAFE\nTel +49 30 1234 56.78\nTable 12.10\nLatte 4.50\nPayment 5,00\nTOTAL 4.50');
    assert.deepEqual(r.items.map((i) => i.name), ['Latte']);
  });
});
