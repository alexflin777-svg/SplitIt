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

  test('без строки итога берётся наибольшая сумма', () => {
    // Догадка, но осмысленная: в чеке без итога самая большая цифра обычно и
    // есть сумма. Пользователь всё равно проверяет её перед сохранением.
    assert.equal(extractDataFromText(ЧЕК_БЕЗ_ИТОГО).suggestedTotal, 250);
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
