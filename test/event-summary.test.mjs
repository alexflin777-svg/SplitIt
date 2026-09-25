/**
 * Итог события (src/lib/event-summary.ts).
 *
 * Запуск: npm run test:unit
 *
 * Этот расчёт показывается на экране закрытого события и уходит в
 * «Поделиться итогом» и «Напомнить». Ошибка здесь — это неверная сумма,
 * которую человек отправит друзьям, поэтому проверяются инварианты:
 *   * сумма балансов = 0 (деньги не появляются и не исчезают);
 *   * переводы гасят балансы до нуля с точностью до копейки;
 *   * нет NaN, Infinity, отрицательных и нулевых переводов;
 *   * уже совершённые переводы учитываются;
 *   * тексты для мессенджера содержат все переводы.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEventSummary,
  transfersFor,
  buildSummaryText,
  buildReminderText,
} from '../src/lib/event-summary.ts';
import { splitEvenly } from '../src/lib/money.ts';

const members = [
  { id: 'a', name: 'Аня' },
  { id: 'b', name: 'Миша' },
  { id: 'c', name: 'Лена' },
  { id: 'd', name: 'Паша' },
];

// Доли — как их сохраняет приложение: в копейках, сумма долей = сумме расхода.
const eq = (paidById, amount, ids = members.map((m) => m.id)) => {
  const shares = splitEvenly(amount, ids.length);
  return {
    paidById,
    amount,
    amountInGroupCurrency: amount,
    splits: ids.map((userId, i) => ({ userId, amountOwed: shares[i] })),
  };
};

const r2 = (n) => Math.round(n * 100) / 100;

function checkInvariants(summary) {
  const net = Object.values(summary.balances).map((b) => b.netAmount);
  assert.ok(Math.abs(net.reduce((a, b) => a + b, 0)) < 0.01, 'сумма балансов не равна нулю');

  const after = Object.fromEntries(Object.entries(summary.balances).map(([id, b]) => [id, b.netAmount]));
  for (const t of summary.transfers) {
    assert.ok(Number.isFinite(t.amount) && t.amount > 0, `плохой перевод ${t.amount}`);
    assert.notEqual(t.fromId, t.toId);
    after[t.fromId] += t.amount;
    after[t.toId] -= t.amount;
  }
  for (const [id, v] of Object.entries(after)) {
    assert.ok(Math.abs(v) < 0.02, `после переводов у ${id} остаток ${v}`);
  }
}

describe('computeEventSummary', () => {
  test('«Море вчетвером»: жильё, продукты, арбуз', () => {
    const s = computeEventSummary({
      currency: 'RUB',
      members,
      expenses: [eq('a', 24000), eq('b', 6300), eq('c', 2100), eq('b', 450, ['a', 'b'])],
    });
    assert.equal(s.total, 32850);
    checkInvariants(s);
    assert.ok(s.transfers.length <= members.length - 1, 'переводов больше, чем n-1');
  });

  test('уже совершённый перевод уменьшает долг', () => {
    const group = { currency: 'EUR', members: members.slice(0, 2), expenses: [eq('a', 100, ['a', 'b'])] };
    const before = computeEventSummary(group);
    assert.deepEqual(before.transfers.map((t) => [t.fromId, t.toId, t.amount]), [['b', 'a', 50]]);

    const after = computeEventSummary({ ...group, settlements: [{ payerId: 'b', payeeId: 'a', amount: '30' }] });
    assert.deepEqual(after.transfers.map((t) => [t.fromId, t.toId, t.amount]), [['b', 'a', 20]]);

    const done = computeEventSummary({ ...group, settlements: [{ payerId: 'b', payeeId: 'a', amount: '50' }] });
    assert.equal(done.transfers.length, 0);
  });

  test('трудные копейки: 100 на троих', () => {
    const s = computeEventSummary({ currency: 'USD', members: members.slice(0, 3), expenses: [eq('a', 100, ['a', 'b', 'c'])] });
    checkInvariants(s);
    // 33.34 + 33.33 + 33.33: лишняя копейка у первого (плательщика), двое переводят по 33.33.
    assert.deepEqual(s.transfers.map((t) => t.amount), [33.33, 33.33]);
  });

  test('расход без долей делится поровну', () => {
    const s = computeEventSummary({
      currency: 'RUB',
      members: members.slice(0, 2),
      expenses: [{ paidById: 'a', amount: 1000, amountInGroupCurrency: 1000 }],
    });
    assert.deepEqual(s.transfers.map((t) => [t.fromId, t.amount]), [['b', 500]]);
  });

  test('пустое событие — ни одного перевода, никаких NaN', () => {
    const s = computeEventSummary({ members, expenses: [] });
    assert.equal(s.total, 0);
    assert.equal(s.transfers.length, 0);
    for (const b of Object.values(s.balances)) assert.ok(Number.isFinite(b.netAmount));
  });

  test('случайные события: инварианты держатся на 300 прогонах', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 300; run++) {
      const n = 2 + Math.floor(rnd() * 6);
      const ms = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
      const expenses = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => {
        const payer = ms[Math.floor(rnd() * n)].id;
        const amount = r2(1 + rnd() * 5000);
        const ids = ms.filter(() => rnd() > 0.3).map((m) => m.id);
        return eq(payer, amount, ids.length ? ids : [payer]);
      });
      checkInvariants(computeEventSummary({ currency: 'EUR', members: ms, expenses }));
    }
  });
});

describe('splitEvenly', () => {
  test('сумма долей всегда равна сумме расхода до копейки', () => {
    for (const [amount, n] of [[100, 3], [0.01, 3], [10, 7], [999999.99, 13], [33.35, 2], [1, 1]]) {
      const shares = splitEvenly(amount, n);
      assert.equal(shares.length, n);
      assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100), Math.round(amount * 100), `${amount}/${n}`);
      for (const x of shares) assert.equal(Math.round(x * 100), x * 100 === Math.round(x * 100) ? x * 100 : Math.round(x * 100));
      assert.ok(Math.max(...shares) - Math.min(...shares) <= 0.0100001, 'доли отличаются больше чем на копейку');
    }
  });

  test('без участников — пустой список, а не NaN', () => {
    assert.deepEqual(splitEvenly(100, 0), []);
  });
});

describe('transfersFor', () => {
  test('делит переводы на «я должен» и «мне должны»', () => {
    const s = computeEventSummary({ currency: 'RUB', members: members.slice(0, 3), expenses: [eq('a', 300, ['a', 'b', 'c'])] });
    assert.equal(transfersFor(s, 'a').owed.length, 2);
    assert.equal(transfersFor(s, 'a').owe.length, 0);
    assert.equal(transfersFor(s, 'b').owe.length, 1);
    assert.deepEqual(transfersFor(s, null), { owe: [], owed: [] });
  });
});

describe('тексты для мессенджера', () => {
  const t = (key, vars = {}) => `${key}|${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')}`;
  const fmt = (a, c) => `${a.toFixed(2)} ${c}`;

  test('итог содержит каждый перевод', () => {
    const s = computeEventSummary({ currency: 'RUB', members: members.slice(0, 3), expenses: [eq('a', 300, ['a', 'b', 'c'])] });
    const text = buildSummaryText('Дача', s, 'RUB', t, fmt);
    assert.match(text, /summary\.shareHeader\|name=Дача/);
    assert.match(text, /Миша → Аня: 100\.00 RUB/);
    assert.match(text, /Лена → Аня: 100\.00 RUB/);
  });

  test('итог без долгов говорит «все в расчёте»', () => {
    const s = computeEventSummary({ currency: 'RUB', members, expenses: [] });
    assert.match(buildSummaryText('Дача', s, 'RUB', t, fmt), /summary\.allSettled/);
  });

  test('напоминание называет должника, сумму, получателя и событие', () => {
    const text = buildReminderText('Дача', { fromId: 'b', fromName: 'Миша', toId: 'a', toName: 'Аня', amount: 150, currency: 'RUB' }, 'RUB', t, fmt);
    assert.equal(text, 'summary.reminderText|name=Миша,amount=150.00 RUB,to=Аня,event=Дача');
  });
});
