/**
 * Алгоритм упрощения долгов.
 *
 * Запуск: node --test test/debt-simplification.test.mjs
 *
 * До сих пор расчёт был покрыт ровно одним E2E-случаем: 9000 ₽ на троих
 * сводились к двум переводам по 3000. Это главная функция приложения —
 * ради неё оно и существует, — и одного примера мало.
 *
 * Здесь проверяется не только «сколько переводов», но и три свойства, которые
 * обязаны выполняться всегда: сумма переводов сходится с долгами, никто не
 * платит больше, чем должен, никто не получает больше, чем ему причитается.
 * Свойство ловит целый класс ошибок, а не один пример.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyDebts } from '../src/lib/debt-simplification.ts';

/** Удобный конструктор входа: { Алексей: 6000, Мария: -3000 }. */
function balances(spec) {
  return Object.fromEntries(
    Object.entries(spec).map(([name, netAmount]) => [`id-${name}`, { name, netAmount }]),
  );
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Проверяет инварианты, не зависящие от конкретных чисел.
 * Возвращает список нарушений, чтобы сообщение об ошибке было предметным.
 */
function checkInvariants(input, transactions) {
  const problems = [];

  for (const t of transactions) {
    if (!(t.amount > 0)) problems.push(`перевод не положителен: ${t.amount}`);
    if (t.fromId === t.toId) problems.push(`перевод самому себе: ${t.fromName}`);
  }

  // Сколько каждый в итоге отдаёт и получает.
  const moved = {};
  for (const t of transactions) {
    moved[t.fromId] = (moved[t.fromId] ?? 0) - t.amount;
    moved[t.toId] = (moved[t.toId] ?? 0) + t.amount;
  }

  for (const [id, data] of Object.entries(input)) {
    const expected = round2(data.netAmount);
    const actual = round2(moved[id] ?? 0);
    // Знак netAmount: положительный — человеку должны, значит он получает.
    if (Math.abs(expected - actual) > 0.011) {
      problems.push(`${data.name}: ожидалось ${expected}, по переводам ${actual}`);
    }
  }

  return problems;
}

function expectValid(spec) {
  const input = balances(spec);
  const transactions = simplifyDebts(input);
  const problems = checkInvariants(input, transactions);
  assert.deepEqual(problems, [], `нарушены инварианты:\n  ${problems.join('\n  ')}`);
  return transactions;
}

describe('Базовые случаи', () => {
  test('один должник, один кредитор — один перевод', () => {
    const t = expectValid({ Алексей: 3000, Мария: -3000 });
    assert.equal(t.length, 1);
    assert.equal(t[0].fromName, 'Мария');
    assert.equal(t[0].toName, 'Алексей');
    assert.equal(t[0].amount, 3000);
  });

  test('9000 на троих сводится к двум переводам', () => {
    // Тот самый случай из E2E, здесь как опорная точка.
    const t = expectValid({ Алексей: 6000, Мария: -3000, Дмитрий: -3000 });
    assert.equal(t.length, 2);
    assert.deepEqual(
      t.map((x) => x.amount),
      [3000, 3000],
    );
  });

  test('все в нуле — переводов нет', () => {
    assert.deepEqual(simplifyDebts(balances({ Алексей: 0, Мария: 0 })), []);
  });

  test('пустой вход', () => {
    assert.deepEqual(simplifyDebts({}), []);
  });
});

describe('Свойства алгоритма', () => {
  test('число переводов не больше, чем участников минус один', () => {
    // Теоретический минимум для графа долгов. Больше — значит алгоритм
    // не упрощает, а просто перечисляет долги.
    const spec = { А: 500, Б: 300, В: -200, Г: -600, Д: 0 };
    const t = expectValid(spec);
    const participants = Object.values(spec).filter((v) => Math.abs(v) > 0.01).length;
    assert.ok(
      t.length <= participants - 1,
      `переводов ${t.length}, участников с ненулевым балансом ${participants}`,
    );
  });

  test('участник с нулевым балансом не участвует в переводах', () => {
    const t = expectValid({ Алексей: 4000, Мария: -4000, Иван: 0 });
    const names = t.flatMap((x) => [x.fromName, x.toName]);
    assert.ok(!names.includes('Иван'), 'Иван попал в переводы, хотя ничего не должен');
  });

  test('кольцо долгов на входе даёт ноль переводов', () => {
    // А должен Б, Б должен В, В должен А по 1000. Сворачивает кольцо не эта
    // функция, а расчёт балансов до неё: сюда приходят уже чистые остатки,
    // и все три нулевые. Проверяется, что алгоритм не выдумывает переводы
    // там, где двигать нечего.
    const t = expectValid({ А: 0, Б: 0, В: 0 });
    assert.equal(t.length, 0);
  });

  test('частичное погашение уменьшает остаток, а не обнуляет его', () => {
    // Мария была должна 3000, вернула 1000 — на вход приходит остаток 2000.
    const t = expectValid({ Алексей: 2000, Мария: -2000 });
    assert.equal(t.length, 1);
    assert.equal(t[0].amount, 2000);
  });

  test('длинная цепочка не разрастается', () => {
    const t = expectValid({ А: 100, Б: 100, В: 100, Г: -150, Д: -150 });
    assert.ok(t.length <= 4, `переводов ${t.length}, ожидалось не больше 4`);
  });
});

describe('Копейки и округление', () => {
  test('деление 100 на троих не теряет и не создаёт денег', () => {
    // 100 / 3 = 33.333…, и суммарно доли не сходятся с исходной суммой.
    // Алгоритм не обязан это исправлять, но обязан не увеличивать расхождение.
    const input = balances({ Алексей: 66.67, Мария: -33.33, Дмитрий: -33.34 });
    const t = simplifyDebts(input);
    const problems = checkInvariants(input, t);
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('суммы переводов округлены до копеек', () => {
    const t = expectValid({ Алексей: 33.33, Мария: -33.33 });
    for (const x of t) {
      assert.equal(x.amount, round2(x.amount), `не округлено: ${x.amount}`);
    }
  });

  test('расхождение меньше копейки не порождает перевод', () => {
    // Иначе в интерфейсе появлялись бы переводы на 0.00 ₽.
    const t = simplifyDebts(balances({ Алексей: 0.005, Мария: -0.005 }));
    assert.deepEqual(t, [], 'алгоритм создал перевод из шума округления');
  });
});

describe('Устойчивость', () => {
  test('несбалансированный вход не зацикливает алгоритм', () => {
    // Такого быть не должно, но если данные повреждены — функция обязана
    // вернуть управление, а не подвесить интерфейс.
    const t = simplifyDebts(balances({ Алексей: 1000, Мария: -10 }));
    assert.ok(Array.isArray(t));
    assert.ok(t.length < 10);
  });

  test('валюта проставляется в каждый перевод', () => {
    const t = simplifyDebts(balances({ Алексей: 100, Мария: -100 }), 'USD');
    assert.equal(t[0].currency, 'USD');
  });

  test('по умолчанию рубли', () => {
    const t = simplifyDebts(balances({ Алексей: 100, Мария: -100 }));
    assert.equal(t[0].currency, 'RUB');
  });

  test('большая группа считается за разумное время', () => {
    const spec = {};
    for (let i = 0; i < 60; i += 1) spec[`Ч${i}`] = i < 30 ? 100 : -100;
    const started = Date.now();
    const t = expectValid(spec);
    assert.ok(Date.now() - started < 1000, 'расчёт занял больше секунды');
    assert.ok(t.length <= 59);
  });
});
