/**
 * Расчётное ядро «Проекта» — каждый пример PROJECT-SPEC.md (§3, §3а.3–§3а.7, §4)
 * с цифрами по каждому участнику, а не только суммы.
 *
 * Запуск: npx tsx --test test/project-calc.test.mjs
 *
 * Все суммы в тесте — копейки; rub(15_000) = 1 500 000 коп.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePeriod,
  closePeriodDebt,
  simulatePreview,
  validateTerms,
  formatBreakdown,
} from '../src/lib/project-calc.ts';

const rub = (n) => Math.round(n * 100);
const A = 'a';
const Bo = 'b';
const V = 'v';
const MEMBERS = [
  { id: A, name: 'Аня', position: 1, role: 'user' },
  { id: Bo, name: 'Боря', position: 2, role: 'user' },
  { id: V, name: 'Вика', position: 3, role: 'guest' },
];
const NAME = { a: 'Аня', b: 'Боря', v: 'Вика' };

const line = (memberId, over = {}) => ({
  memberId,
  expensesBack: true,
  rate: { type: 'none', amount: 0 },
  inRemainder: true,
  shareBp: 0,
  contribNew: 0,
  debtWriteOff: 0,
  ...over,
});
const fixed = (r) => ({ rate: { type: 'period', amount: rub(r) } });
const shares = [4000, 4000, 2000];

const income = (memberId, r) => ({ type: 'income', memberId, amount: rub(r) });
const expense = (memberId, r) => ({ type: 'expense', memberId, amount: rub(r) });
const refund = (memberId, r) => ({ type: 'income_refund', memberId, amount: rub(r) });

/** §3: доходы Аня 120 000 / Боря 60 000; расходы 15 000 / 6 000 / 9 000. */
const BASE_OPS = [income(A, 120_000), income(Bo, 60_000), expense(A, 15_000), expense(Bo, 6_000), expense(V, 9_000)];

// Шаблоны §3а.3.
const T_EQUAL = {
  contribEnabled: false,
  remainderMethod: 'equal',
  lines: [A, Bo, V].map((id) => line(id, { expensesBack: false })),
};
const T_A = { contribEnabled: false, remainderMethod: 'equal', lines: [A, Bo, V].map((id) => line(id)) };
const T_A_PCT = {
  contribEnabled: false,
  remainderMethod: 'percent',
  lines: [A, Bo, V].map((id, k) => line(id, { shareBp: shares[k] })),
};
const T_B = {
  contribEnabled: false,
  remainderMethod: 'percent',
  lines: [
    line(A, { ...fixed(20_000), shareBp: 4000 }),
    line(Bo, { ...fixed(20_000), shareBp: 4000 }),
    line(V, { ...fixed(15_000), shareBp: 2000 }),
  ],
};
const T_V = {
  contribEnabled: true,
  remainderMethod: 'percent',
  lines: [
    line(A, { ...fixed(20_000), shareBp: 4000 }),
    line(Bo, { ...fixed(20_000), shareBp: 4000, contribNew: rub(30_000), contribKind: 'item', contribNote: 'Объектив' }),
    line(V, { ...fixed(15_000), shareBp: 2000 }),
  ],
};
// §3а.4 «Свои условия».
const T_MIXED = {
  contribEnabled: true,
  remainderMethod: 'percent',
  lines: [
    line(A, { ...fixed(20_000), shareBp: 4000 }),
    line(Bo, { shareBp: 4000, contribNew: rub(30_000), contribKind: 'item', contribNote: 'Объектив' }),
    line(V, { rate: { type: 'hourly', amount: rub(1_500) }, shareBp: 2000 }),
  ],
};

/** Поле по людям в порядке Аня, Боря, Вика (в рублях). */
const per = (res, field) => res.order.map((id) => res.perPerson[id][field] / 100);
const transfers = (res) => res.transfers.map((t) => [NAME[t.fromId], NAME[t.toId], t.amount / 100]);

/** Инварианты §8 для любого результата. */
function checkInvariants(res) {
  const people = res.order.map((id) => res.perPerson[id]);
  const sum = (f) => people.reduce((s, p) => s + p[f], 0);
  assert.equal(sum('owed'), sum('onHand'), 'Σ положено = Σ на руках');
  assert.equal(sum('owed'), res.netIncome, 'Σ положено = чистые доходы');
  assert.equal(sum('transfer'), 0, 'Σ переводов = 0');
  for (const p of people) {
    for (const f of ['expensesBack', 'contributionBack', 'rate', 'remainderShare', 'owed', 'onHand', 'transfer']) {
      assert.ok(Number.isSafeInteger(p[f]), `${p.name}.${f} = ${p[f]} — не целые копейки`);
    }
  }
  for (const t of res.transfers) {
    assert.ok(Number.isSafeInteger(t.amount) && t.amount > 0, `перевод ${t.amount}`);
  }
  // Переводы ровно закрывают разницу каждого.
  const moved = Object.fromEntries(res.order.map((id) => [id, 0]));
  for (const t of res.transfers) {
    moved[t.fromId] -= t.amount;
    moved[t.toId] += t.amount;
  }
  for (const p of people) assert.equal(moved[p.memberId], p.transfer, `${p.name}: переводы ≠ разница`);
  for (const d of Object.values(res.debtAfter)) assert.ok(d >= 0, 'долг по вкладу ≥ 0');
  if (res.profit <= 0) {
    assert.equal(res.contributionsRepaid, 0);
    assert.equal(res.ratesPaid, 0);
  }
}

function calc(terms, operations, extra = {}) {
  const res = calculatePeriod({ members: MEMBERS, terms, operations, ...extra });
  checkInvariants(res);
  return res;
}

describe('§3а.3 шаблоны на общих цифрах §3', () => {
  test('«Поровну»: по 60 000, Аня → Вика 60 000', () => {
    const r = calc(T_EQUAL, BASE_OPS);
    assert.equal(r.profit, rub(180_000));
    assert.deepEqual(per(r, 'expensesBack'), [0, 0, 0]);
    assert.deepEqual(per(r, 'owed'), [60_000, 60_000, 60_000]);
    assert.deepEqual(per(r, 'transfer'), [-60_000, 0, 60_000]);
    assert.deepEqual(transfers(r), [['Аня', 'Вика', 60_000]]);
  });

  test('«Вернуть расходы и поровну»: 65 000 / 56 000 / 59 000', () => {
    const r = calc(T_A, BASE_OPS);
    assert.equal(r.profit, rub(150_000));
    assert.deepEqual(per(r, 'remainderShare'), [50_000, 50_000, 50_000]);
    assert.deepEqual(per(r, 'owed'), [65_000, 56_000, 59_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 55_000],
      ['Боря', 'Вика', 4_000],
    ]);
  });

  test('то же «по %» 40/40/20 = §3 вариант А', () => {
    const r = calc(T_A_PCT, BASE_OPS);
    assert.deepEqual(per(r, 'expensesBack'), [15_000, 6_000, 9_000]);
    assert.deepEqual(per(r, 'remainderShare'), [60_000, 60_000, 30_000]);
    assert.deepEqual(per(r, 'owed'), [75_000, 66_000, 39_000]);
    assert.deepEqual(per(r, 'onHand'), [120_000, 60_000, 0]);
    assert.deepEqual(per(r, 'transfer'), [-45_000, 6_000, 39_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 39_000],
      ['Аня', 'Боря', 6_000],
    ]);
  });

  test('«Ставки + доли» = §3 вариант Б', () => {
    const r = calc(T_B, BASE_OPS);
    assert.deepEqual(per(r, 'rate'), [20_000, 20_000, 15_000]);
    assert.equal(r.remainder, rub(95_000));
    assert.deepEqual(per(r, 'remainderShare'), [38_000, 38_000, 19_000]);
    assert.deepEqual(per(r, 'owed'), [73_000, 64_000, 43_000]);
    assert.deepEqual(per(r, 'transfer'), [-47_000, 4_000, 43_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 43_000],
      ['Аня', 'Боря', 4_000],
    ]);
  });

  test('«Ставки + доли» со ставками 0 = вариант А', () => {
    const zero = { ...T_B, lines: T_B.lines.map((l) => ({ ...l, rate: { type: 'period', amount: 0 } })) };
    assert.deepEqual(per(calc(zero, BASE_OPS), 'owed'), [75_000, 66_000, 39_000]);
  });

  test('«Вклады + ставки + доли» = §3 вариант В', () => {
    const r = calc(T_V, BASE_OPS, { debtAtStart: { b: rub(30_000) } });
    assert.deepEqual(per(r, 'contributionBack'), [0, 30_000, 0]);
    assert.deepEqual(per(r, 'rate'), [20_000, 20_000, 15_000]);
    assert.deepEqual(per(r, 'remainderShare'), [26_000, 26_000, 13_000]);
    assert.deepEqual(per(r, 'owed'), [61_000, 82_000, 37_000]);
    assert.deepEqual(per(r, 'transfer'), [-59_000, 22_000, 37_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 37_000],
      ['Аня', 'Боря', 22_000],
    ]);
    assert.deepEqual(r.debtAfter, { a: 0, b: 0, v: 0 });
  });
});

describe('§3 убыток, прибыль меньше ставок, возврат дохода', () => {
  test('убыток: доход 20 000, расходы 30 000', () => {
    const ops = [income(A, 20_000), expense(A, 15_000), expense(Bo, 6_000), expense(V, 9_000)];
    const r = calc(T_B, ops);
    assert.equal(r.profit, rub(-10_000));
    assert.deepEqual(per(r, 'rate'), [0, 0, 0]);
    assert.deepEqual(per(r, 'remainderShare'), [-4_000, -4_000, -2_000]);
    assert.deepEqual(per(r, 'owed'), [11_000, 2_000, 7_000]);
    assert.deepEqual(per(r, 'transfer'), [-9_000, 2_000, 7_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 7_000],
      ['Аня', 'Боря', 2_000],
    ]);
    assert.match(formatBreakdown(r.perPerson.a), /Доля убытка: 40 % от 10 000 ₽ = −4 000 ₽/);
  });

  test('прибыль 33 000 при ставках 55 000 → по 60 %: 12 000 / 12 000 / 9 000', () => {
    const ops = [income(A, 63_000), expense(A, 15_000), expense(Bo, 6_000), expense(V, 9_000)];
    const r = calc(T_B, ops);
    assert.equal(r.profit, rub(33_000));
    assert.equal(r.ratesAccrued, rub(55_000));
    assert.deepEqual(per(r, 'rate'), [12_000, 12_000, 9_000]);
    assert.deepEqual(per(r, 'rateAccrued'), [20_000, 20_000, 15_000]);
    assert.equal(r.remainder, 0);
    assert.match(formatBreakdown(r.perPerson.a), /Ставка за период 20 000 ₽ = 20 000 ₽, хватило прибыли на 12 000 ₽/);
  });

  test('ноябрь: возврат 30 000 за закрытый октябрь → убыток −15 000', () => {
    const ops = [refund(A, 30_000), income(V, 20_000), expense(Bo, 5_000)];
    const r = calc(T_B, ops);
    assert.equal(r.netIncome, rub(-10_000));
    assert.equal(r.profit, rub(-15_000));
    assert.deepEqual(per(r, 'expensesBack'), [0, 5_000, 0]);
    assert.deepEqual(per(r, 'remainderShare'), [-6_000, -6_000, -3_000]);
    assert.deepEqual(per(r, 'owed'), [-6_000, -1_000, -3_000]);
    assert.deepEqual(per(r, 'onHand'), [-30_000, 0, 20_000]);
    assert.deepEqual(per(r, 'transfer'), [24_000, -1_000, -23_000]);
    assert.deepEqual(transfers(r), [
      ['Вика', 'Аня', 23_000],
      ['Боря', 'Аня', 1_000],
    ]);
  });
});

describe('§3а.4 смешанный пример «Свои условия»', () => {
  const r = calc(T_MIXED, BASE_OPS, { debtAtStart: { b: rub(30_000) }, quantities: { v: { hours: 1000 } } });

  test('цифры таблицы по людям', () => {
    assert.equal(r.profit, rub(150_000));
    assert.deepEqual(per(r, 'contributionBack'), [0, 30_000, 0]);
    assert.deepEqual(per(r, 'rate'), [20_000, 0, 15_000]);
    assert.equal(r.remainder, rub(85_000));
    assert.deepEqual(per(r, 'remainderShare'), [34_000, 34_000, 17_000]);
    assert.deepEqual(per(r, 'owed'), [69_000, 70_000, 41_000]);
    assert.deepEqual(per(r, 'transfer'), [-51_000, 10_000, 41_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 41_000],
      ['Аня', 'Боря', 10_000],
    ]);
    assert.deepEqual(r.debtAfter, { a: 0, b: 0, v: 0 });
  });

  test('«Из чего сумма» у Вики', () => {
    assert.equal(
      formatBreakdown(r.perPerson.v),
      'Расходы назад 9 000 ₽ + Работа 10 ч × 1 500 ₽ = 15 000 ₽ + 20 % от 85 000 ₽ = 17 000 ₽ = 41 000 ₽',
    );
    assert.deepEqual(
      r.perPerson.v.breakdown.map((b) => [b.kind, b.amount / 100]),
      [
        ['expenses', 9_000],
        ['rate', 15_000],
        ['remainder', 17_000],
      ],
    );
    assert.equal(
      formatBreakdown(r.perPerson.b),
      'Расходы назад 6 000 ₽ + Вклад назад 30 000 ₽ + 40 % от 85 000 ₽ = 34 000 ₽ = 70 000 ₽',
    );
  });
});

describe('§3а.5 три периода: перенос вклада, убыток, погашение', () => {
  const ledger = [{ memberId: Bo, kind: 'credit', amount: rub(30_000) }]; // при accept_terms
  let debt = { a: 0, b: rub(30_000), v: 0 };

  test('октябрь: R 20 000, ставки не выплачены, долг 10 000', () => {
    const ops = [income(A, 50_000), expense(A, 15_000), expense(Bo, 6_000), expense(V, 9_000)];
    const r = calc(T_MIXED, ops, { debtAtStart: debt, quantities: { v: { hours: 1000 } } });
    assert.equal(r.profit, rub(20_000));
    assert.deepEqual(per(r, 'contributionBack'), [0, 20_000, 0]);
    assert.deepEqual(per(r, 'rate'), [0, 0, 0]);
    assert.deepEqual(per(r, 'rateAccrued'), [20_000, 0, 15_000]);
    assert.deepEqual(per(r, 'remainderShare'), [0, 0, 0]);
    assert.deepEqual(per(r, 'owed'), [15_000, 26_000, 9_000]);
    assert.deepEqual(per(r, 'transfer'), [-35_000, 26_000, 9_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Боря', 26_000],
      ['Аня', 'Вика', 9_000],
    ]);
    const close = closePeriodDebt({ members: MEMBERS, debtAtStart: debt, repaid: { b: r.perPerson.b.contributionBack } });
    assert.deepEqual(close.entries, [{ memberId: Bo, kind: 'repay', amount: rub(20_000), period: 'current' }]);
    ledger.push(...close.entries);
    debt = close.debtAtNextStart;
    assert.deepEqual(debt, { a: 0, b: rub(10_000), v: 0 });
  });

  test('ноябрь: убыток −8 000, долг 10 000 не трогается', () => {
    const ops = [income(V, 12_000), expense(Bo, 20_000)];
    const r = calc(T_MIXED, ops, { debtAtStart: debt, quantities: { v: { hours: 400 } } });
    assert.equal(r.profit, rub(-8_000));
    assert.deepEqual(per(r, 'contributionBack'), [0, 0, 0]);
    assert.deepEqual(per(r, 'rateAccrued'), [20_000, 0, 6_000]);
    assert.deepEqual(per(r, 'rate'), [0, 0, 0]);
    assert.deepEqual(per(r, 'remainderShare'), [-3_200, -3_200, -1_600]);
    assert.deepEqual(per(r, 'owed'), [-3_200, 16_800, -1_600]);
    assert.deepEqual(per(r, 'transfer'), [-3_200, 16_800, -13_600]);
    assert.deepEqual(transfers(r), [
      ['Вика', 'Боря', 13_600],
      ['Аня', 'Боря', 3_200],
    ]);
    const close = closePeriodDebt({ members: MEMBERS, debtAtStart: debt, repaid: {} });
    assert.deepEqual(close.entries, []);
    debt = close.debtAtNextStart;
    assert.deepEqual(debt, { a: 0, b: rub(10_000), v: 0 });
  });

  test('декабрь: R 10 000, долг 0, журнал сходится', () => {
    const r = calc(T_MIXED, [income(Bo, 100_000)], { debtAtStart: debt, quantities: { v: { hours: 700 } } });
    assert.deepEqual(per(r, 'contributionBack'), [0, 10_000, 0]);
    assert.deepEqual(per(r, 'rate'), [20_000, 0, 10_500]);
    assert.equal(r.remainder, rub(59_500));
    assert.deepEqual(per(r, 'remainderShare'), [23_800, 23_800, 11_900]);
    assert.deepEqual(per(r, 'owed'), [43_800, 33_800, 22_400]);
    assert.deepEqual(per(r, 'transfer'), [43_800, -66_200, 22_400]);
    assert.deepEqual(transfers(r), [
      ['Боря', 'Аня', 43_800],
      ['Боря', 'Вика', 22_400],
    ]);
    const close = closePeriodDebt({ members: MEMBERS, debtAtStart: debt, repaid: { b: r.perPerson.b.contributionBack } });
    ledger.push(...close.entries);
    assert.deepEqual(close.debtAtNextStart, { a: 0, b: 0, v: 0 });
    const balance = ledger.reduce((s, e) => s + (e.kind === 'credit' ? e.amount : -e.amount), 0);
    assert.equal(balance, 0);
  });
});

describe('§3а.6 короткие примеры', () => {
  test('урезание смешанных ставок: P 51 000 → 12 000 / 0 / 9 000', () => {
    const ops = [income(A, 81_000), expense(A, 15_000), expense(Bo, 6_000), expense(V, 9_000)];
    const r = calc(T_MIXED, ops, { debtAtStart: { b: rub(30_000) }, quantities: { v: { hours: 1000 } } });
    assert.equal(r.profit, rub(51_000));
    assert.equal(r.contributionsRepaid, rub(30_000));
    assert.deepEqual(per(r, 'rate'), [12_000, 0, 9_000]);
    assert.equal(r.remainder, 0);
  });

  test('расходы Ани «за свой счёт»: 55 000 / 61 000 / 64 000', () => {
    const terms = { ...T_A, lines: [line(A, { expensesBack: false }), line(Bo), line(V)] };
    const r = calc(terms, BASE_OPS);
    assert.deepEqual(per(r, 'expensesBack'), [0, 6_000, 9_000]);
    assert.equal(r.profit, rub(165_000));
    assert.deepEqual(per(r, 'owed'), [55_000, 61_000, 64_000]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 64_000],
      ['Аня', 'Боря', 1_000],
    ]);
  });

  const T_HOURS = { contribEnabled: false, remainderMethod: 'hours', lines: [A, Bo, V].map((id) => line(id)) };
  const H753 = { a: { hours: 700 }, b: { hours: 500 }, v: { hours: 300 } };

  test('по часам, копейки: 46 666,67 / 33 333,33 / 20 000,00', () => {
    const r = calc(T_HOURS, [income(A, 100_000)], { quantities: H753 });
    assert.deepEqual(per(r, 'remainderShare'), [46_666.67, 33_333.33, 20_000]);
  });

  test('по часам, убыток: −46 666,67 / −33 333,33 / −20 000,00', () => {
    const r = calc(T_HOURS, [expense(A, 100_000)], { quantities: H753 });
    assert.equal(r.remainder, rub(-100_000));
    assert.deepEqual(per(r, 'remainderShare'), [-46_666.67, -33_333.33, -20_000]);
    assert.ok(r.notes.includes('Убыток делится по часам, как и прибыль'));
  });

  test('по часам, часов нет → поровну 33 333,34 / 33 333,33 / 33 333,33', () => {
    const r = calc(T_HOURS, [income(A, 100_000)]);
    assert.deepEqual(per(r, 'remainderShare'), [33_333.34, 33_333.33, 33_333.33]);
    assert.ok(r.notes.includes('Часы не внесены — делим поровну'));
  });

  test('предпросмотр «на примере»: 40 000 / 50 000 / 10 000, с 10 ч у Вики 34 000 / 44 000 / 22 000', () => {
    const input = deepFreeze({ members: MEMBERS, terms: T_MIXED, ledgerDebt: {} });
    const { after, before } = simulatePreview(input);
    checkInvariants(after);
    assert.equal(before, undefined);
    assert.deepEqual(per(after, 'contributionBack'), [0, 30_000, 0]);
    assert.deepEqual(per(after, 'rate'), [20_000, 0, 0]);
    assert.deepEqual(per(after, 'remainderShare'), [20_000, 20_000, 10_000]);
    assert.deepEqual(per(after, 'owed'), [40_000, 50_000, 10_000]);
    assert.ok(after.notes.includes('Вика: примерно 0 ч — ставка 0'));

    const with10 = simulatePreview(deepFreeze({ ...input, quantities: { v: { hours: 1000 } } })).after;
    assert.deepEqual(per(with10, 'rate'), [20_000, 0, 15_000]);
    assert.deepEqual(per(with10, 'remainderShare'), [14_000, 14_000, 7_000]);
    assert.deepEqual(per(with10, 'owed'), [34_000, 44_000, 22_000]);
  });

  test('предпросмотр «на прошлом периоде»: было 43 800 / 33 800 / 22 400 → стало 43 200 / 33 200 / 23 600', () => {
    const proposed = {
      ...T_MIXED,
      lines: T_MIXED.lines.map((l) =>
        l.memberId === V ? { ...l, rate: { type: 'period', amount: rub(12_000) } } : { ...l, contribNew: 0 },
      ),
    };
    const input = deepFreeze({
      members: MEMBERS,
      terms: proposed,
      operations: [income(Bo, 100_000)],
      quantities: { v: { hours: 700 } },
      baseline: { terms: T_MIXED, debtAtStart: { b: rub(10_000) } },
      contributionsTotal: { b: rub(30_000) },
    });
    const { before, after } = simulatePreview(input);
    checkInvariants(before);
    checkInvariants(after);
    assert.deepEqual(per(before, 'owed'), [43_800, 33_800, 22_400]);
    assert.equal(after.contributionsRepaid, rub(10_000));
    assert.equal(after.ratesPaid, rub(32_000));
    assert.deepEqual(per(after, 'remainderShare'), [23_200, 23_200, 11_600]);
    assert.deepEqual(per(after, 'owed'), [43_200, 33_200, 23_600]);
  });

  test('предпросмотр «на прошлом периоде» с новым вкладом Ани 5 000: стало 46 200 / 31 200 / 22 600', () => {
    // Декабрь §3а.5, предложено: Вике фикс 12 000, Аня вносит 5 000 деньгами.
    // Долг стало: Аня 0 + 5 000 − 0 = 5 000; Боря 10 000 + 0 − 0 = 10 000; ΣD 15 000.
    // P 100 000 → R 15 000 (5 000 / 10 000 / 0); S 20 000 + 0 + 12 000 = 32 000;
    // O 100 000 − 15 000 − 32 000 = 53 000 → 40/40/20 = 21 200 / 21 200 / 10 600.
    // Положено: Аня 5 000 + 20 000 + 21 200 = 46 200; Боря 10 000 + 21 200 = 31 200;
    // Вика 12 000 + 10 600 = 22 600 (Σ 100 000 ✓). Было — как в декабре: 43 800 / 33 800 / 22 400.
    const proposed = {
      ...T_MIXED,
      lines: T_MIXED.lines.map((l) =>
        l.memberId === V
          ? { ...l, rate: { type: 'period', amount: rub(12_000) } }
          : l.memberId === A
            ? { ...l, contribNew: rub(5_000), contribKind: 'money' }
            : { ...l, contribNew: 0 },
      ),
    };
    const { before, after } = simulatePreview(
      deepFreeze({
        members: MEMBERS,
        terms: proposed,
        operations: [income(Bo, 100_000)],
        quantities: { v: { hours: 700 } },
        baseline: { terms: T_MIXED, debtAtStart: { b: rub(10_000) } },
        contributionsTotal: { b: rub(30_000) },
      }),
    );
    checkInvariants(before);
    checkInvariants(after);
    assert.deepEqual(per(before, 'owed'), [43_800, 33_800, 22_400]);
    assert.deepEqual(per(after, 'contributionBack'), [5_000, 10_000, 0]);
    assert.deepEqual(per(after, 'rate'), [20_000, 0, 12_000]);
    assert.equal(after.remainder, rub(53_000));
    assert.deepEqual(per(after, 'remainderShare'), [21_200, 21_200, 10_600]);
    assert.deepEqual(per(after, 'owed'), [46_200, 31_200, 22_600]);
    assert.deepEqual(per(after, 'transfer'), [46_200, -68_800, 22_600]);
  });

  test('предпросмотр «по вкладам»: было весами 10 000 / 5 000 / 0, стало — с новым вкладом Вики 15 000', () => {
    // Доход 30 000 на карту Вики, долга на начало нет.
    // Было: веса 10 000 / 5 000 / 0, R 0, O 30 000 → 20 000 / 10 000 / 0.
    // Стало: долг Вики 15 000 → R 15 000; O 15 000, веса 10 000 / 5 000 / 15 000 →
    // 5 000 / 2 500 / 7 500; положено 5 000 / 2 500 / 22 500 (Σ 30 000 ✓).
    const baseTerms = { contribEnabled: true, remainderMethod: 'contributions', lines: [A, Bo, V].map((id) => line(id)) };
    const proposed = { ...baseTerms, lines: [line(A), line(Bo), line(V, { contribNew: rub(15_000), contribKind: 'money' })] };
    const { before, after } = simulatePreview(
      deepFreeze({
        members: MEMBERS,
        terms: proposed,
        operations: [income(V, 30_000)],
        baseline: { terms: baseTerms, debtAtStart: {} },
        contributionsTotal: { a: rub(10_000), b: rub(5_000), v: 0 },
      }),
    );
    checkInvariants(before);
    checkInvariants(after);
    assert.deepEqual(per(before, 'remainderShare'), [20_000, 10_000, 0]);
    assert.deepEqual(per(before, 'owed'), [20_000, 10_000, 0]);
    assert.deepEqual(per(after, 'contributionBack'), [0, 0, 15_000]);
    assert.deepEqual(per(after, 'remainderShare'), [5_000, 2_500, 7_500]);
    assert.deepEqual(per(after, 'owed'), [5_000, 2_500, 22_500]);
  });

  const T_CONTRIB = { contribEnabled: true, remainderMethod: 'contributions', lines: [A, Bo, V].map((id) => line(id)) };
  const CONTRIB_TOTAL = { a: rub(10_000), b: rub(5_000), v: 0 };

  test('два вкладчика, частичный возврат: R 6 666,67 / 3 333,33 / 0', () => {
    const r = calc(T_CONTRIB, [income(V, 10_000)], {
      debtAtStart: { a: rub(10_000), b: rub(5_000), v: 0 },
      contributionsTotal: CONTRIB_TOTAL,
    });
    assert.deepEqual(per(r, 'contributionBack'), [6_666.67, 3_333.33, 0]);
    assert.deepEqual(per(r, 'rate'), [0, 0, 0]);
    assert.equal(r.remainder, 0);
    assert.deepEqual(per(r, 'owed'), [6_666.67, 3_333.33, 0]);
    assert.deepEqual(per(r, 'onHand'), [0, 0, 10_000]);
    assert.deepEqual(transfers(r), [
      ['Вика', 'Аня', 6_666.67],
      ['Вика', 'Боря', 3_333.33],
    ]);
    assert.deepEqual(r.debtAfter, { a: rub(3_333.33), b: rub(1_666.67), v: 0 });
  });

  test('«по вкладам» после возврата: вес не уменьшился, положено 20 000 / 10 000 / 0', () => {
    const r = calc(T_CONTRIB, [income(V, 30_000)], {
      debtAtStart: { a: rub(3_333.33), b: rub(1_666.67), v: 0 },
      contributionsTotal: CONTRIB_TOTAL,
    });
    assert.deepEqual(per(r, 'contributionBack'), [3_333.33, 1_666.67, 0]);
    assert.equal(r.remainder, rub(25_000));
    assert.deepEqual(per(r, 'remainderShare'), [16_666.67, 8_333.33, 0]);
    assert.deepEqual(per(r, 'owed'), [20_000, 10_000, 0]);
    assert.deepEqual(transfers(r), [
      ['Вика', 'Аня', 20_000],
      ['Вика', 'Боря', 10_000],
    ]);
    assert.deepEqual(r.debtAfter, { a: 0, b: 0, v: 0 });
  });

  test('«по вкладам» после списания: списано 1 666,67 (а не 5 000), положено 21 111,11 / 8 888,89 / 0', () => {
    const next = { ...T_CONTRIB, lines: T_CONTRIB.lines.map((l) => (l.memberId === Bo ? { ...l, debtWriteOff: rub(5_000) } : l)) };
    const close = closePeriodDebt({
      members: MEMBERS,
      debtAtStart: { a: rub(10_000), b: rub(5_000), v: 0 },
      repaid: { a: rub(6_666.67), b: rub(3_333.33) },
      nextTerms: next,
    });
    assert.deepEqual(close.entries, [
      { memberId: A, kind: 'repay', amount: rub(6_666.67), period: 'current' },
      { memberId: Bo, kind: 'repay', amount: rub(3_333.33), period: 'current' },
      { memberId: Bo, kind: 'write_off', amount: rub(1_666.67), period: 'next' },
    ]);
    assert.deepEqual(close.debtAtNextStart, { a: rub(3_333.33), b: 0, v: 0 });

    const r = calc(next, [income(V, 30_000)], { debtAtStart: close.debtAtNextStart, contributionsTotal: CONTRIB_TOTAL });
    assert.deepEqual(per(r, 'contributionBack'), [3_333.33, 0, 0]);
    assert.equal(r.remainder, rub(26_666.67));
    assert.deepEqual(per(r, 'remainderShare'), [17_777.78, 8_888.89, 0]);
    assert.deepEqual(per(r, 'owed'), [21_111.11, 8_888.89, 0]);
    assert.deepEqual(transfers(r), [
      ['Вика', 'Аня', 21_111.11],
      ['Вика', 'Боря', 8_888.89],
    ]);
  });

  test('нулевые ветки: R_i = 0, S_i = 0, «Вкладов нет — поровну» 333,34 / 333,33 / 333,33', () => {
    const terms = {
      contribEnabled: true,
      remainderMethod: 'contributions',
      lines: [A, Bo, V].map((id) => line(id, { rate: { type: 'hourly', amount: rub(1_500) } })),
    };
    const r = calc(terms, [income(A, 1_000)]);
    assert.deepEqual(per(r, 'contributionBack'), [0, 0, 0]);
    assert.deepEqual(per(r, 'rate'), [0, 0, 0]);
    assert.deepEqual(per(r, 'remainderShare'), [333.34, 333.33, 333.33]);
    assert.ok(r.notes.includes('Вкладов нет — поровну'));
    assert.ok(r.notes.includes('Вика: часы не внесены — ставка 0'));
    assert.deepEqual(per(r, 'transfer'), [-666.66, 333.33, 333.33]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Боря', 333.33],
      ['Аня', 'Вика', 333.33],
    ]);
  });

  test('ставка за штуку 1 333,33 × 2,5 шт. = 3 333,33; положено 2 222,23 / 2 222,22 / 5 555,55', () => {
    const terms = { ...T_A, lines: [line(A), line(Bo), line(V, { rate: { type: 'piece', amount: rub(1_333.33) } })] };
    const r = calc(terms, [income(A, 10_000)], { quantities: { v: { pieces: 250 } } });
    assert.deepEqual(per(r, 'rateAccrued'), [0, 0, 3_333.33]);
    assert.deepEqual(per(r, 'rate'), [0, 0, 3_333.33]);
    assert.equal(r.remainder, rub(6_666.67));
    assert.deepEqual(per(r, 'remainderShare'), [2_222.23, 2_222.22, 2_222.22]);
    assert.deepEqual(per(r, 'owed'), [2_222.23, 2_222.22, 5_555.55]);
    assert.deepEqual(transfers(r), [
      ['Аня', 'Вика', 5_555.55],
      ['Аня', 'Боря', 2_222.22],
    ]);
    assert.equal(
      formatBreakdown(r.perPerson.v),
      '2,5 шт. × 1 333,33 ₽ = 3 333,33 ₽ + поровну от 6 666,67 ₽ = 2 222,22 ₽ = 5 555,55 ₽',
    );
  });

  test('списание на границе: repay 20 000 → write_off 10 000 (не 30 000) → credit 5 000; долг ноября 5 000', () => {
    const ops = [income(A, 50_000), expense(A, 15_000), expense(Bo, 6_000), expense(V, 9_000)];
    const debt = { a: 0, b: rub(30_000), v: 0 };
    const oct = calc(T_MIXED, ops, { debtAtStart: debt, quantities: { v: { hours: 1000 } } });
    const nov = {
      ...T_MIXED,
      lines: T_MIXED.lines.map((l) =>
        l.memberId === Bo ? { ...l, debtWriteOff: rub(30_000), contribNew: rub(5_000), contribNote: 'Штатив' } : { ...l, contribNew: 0 },
      ),
    };
    assert.deepEqual(validateTerms(nov, { members: MEMBERS, currentDebt: debt }).errors, []);
    const close = closePeriodDebt({
      members: MEMBERS,
      debtAtStart: debt,
      repaid: { b: oct.perPerson.b.contributionBack },
      nextTerms: nov,
    });
    assert.deepEqual(close.entries, [
      { memberId: Bo, kind: 'repay', amount: rub(20_000), period: 'current' },
      { memberId: Bo, kind: 'write_off', amount: rub(10_000), period: 'next' },
      { memberId: Bo, kind: 'credit', amount: rub(5_000), period: 'next' },
    ]);
    assert.equal(close.entries.filter((e) => e.kind === 'credit').length, 1);
    assert.equal(close.debtAtNextStart.b, rub(5_000));
  });

  test('новый вклад при выключенном блоке 2 долга не создаёт', () => {
    const next = { ...T_A, lines: [line(A), line(Bo, { contribNew: rub(5_000) }), line(V)] };
    const close = closePeriodDebt({ members: MEMBERS, debtAtStart: {}, repaid: {}, nextTerms: next });
    assert.deepEqual(close.entries, []);
    assert.equal(close.debtAtNextStart.b, 0);
  });

  test('closePeriodDebt: отрицательные и дробные копейки отклоняются', () => {
    const base = { members: MEMBERS, debtAtStart: { b: rub(10_000) }, repaid: {} };
    assert.throws(() => closePeriodDebt({ ...base, repaid: { b: -1 } }), /целые неотрицательные копейки/);
    assert.throws(() => closePeriodDebt({ ...base, repaid: { b: 0.5 } }), /целые неотрицательные копейки/);
    assert.throws(() => closePeriodDebt({ ...base, debtAtStart: { b: 1.5 } }), /целые неотрицательные копейки/);
    const next = (over) => ({ ...T_V, lines: T_V.lines.map((l) => (l.memberId === Bo ? { ...l, ...over } : l)) });
    assert.throws(() => closePeriodDebt({ ...base, nextTerms: next({ debtWriteOff: -1 }) }), /целые неотрицательные копейки/);
    assert.throws(() => closePeriodDebt({ ...base, nextTerms: next({ contribNew: 0.5 }) }), /целые неотрицательные копейки/);
  });
});

describe('§4 округление и пограничные случаи', () => {
  test('1 000,00 ₽ поровну → 333,34 / 333,33 / 333,33', () => {
    assert.deepEqual(per(calc(T_EQUAL, [income(A, 1_000)]), 'remainderShare'), [333.34, 333.33, 333.33]);
  });

  test('1,01 ₽ по 40/40/20 → 0,41 / 0,40 / 0,20 (ничья — первому по порядку)', () => {
    assert.deepEqual(per(calc(T_A_PCT, [income(V, 1.01)]), 'remainderShare'), [0.41, 0.4, 0.2]);
  });

  test('ничья определяется position, а не порядком в массиве', () => {
    const shuffled = [MEMBERS[2], MEMBERS[0], MEMBERS[1]];
    const r = calculatePeriod({ members: shuffled, terms: T_EQUAL, operations: [income(A, 1_000)] });
    assert.deepEqual(per(r, 'remainderShare'), [333.34, 333.33, 333.33]);
  });

  test('участник, добавленный в середине периода: расходы назад, остатка нет', () => {
    const members = [...MEMBERS, { id: 'g', name: 'Гена', position: 4, role: 'guest' }];
    const r = calculatePeriod({ members, terms: T_EQUAL, operations: [income(A, 3_000), expense('g', 600)] });
    checkInvariants(r);
    assert.equal(r.perPerson.g.expensesBack, rub(600));
    assert.equal(r.perPerson.g.remainderShare, 0);
    assert.equal(r.perPerson.g.owed, rub(600));
    assert.deepEqual(per(r, 'remainderShare').slice(0, 3), [800, 800, 800]);
  });

  test('P = 0 для каждого шаблона: R = 0, S = 0, положено = свои расходы', () => {
    const ops = [income(A, 30_000), expense(A, 15_000), expense(Bo, 6_000), expense(V, 9_000)];
    for (const t of [T_A, T_A_PCT, T_B, T_V, T_MIXED]) {
      const r = calc(t, ops, { debtAtStart: { b: rub(30_000) }, quantities: { v: { hours: 1000 } } });
      assert.equal(r.profit, 0);
      assert.deepEqual(per(r, 'owed'), [15_000, 6_000, 9_000]);
      if (t.contribEnabled) assert.equal(r.debtAfter.b, rub(30_000));
    }
  });

  test('убыток при весе 0: доля ровно 0, а не −0 (как в базе; найдено сверкой SQL ↔ TS)', () => {
    const t = { contribEnabled: true, remainderMethod: 'contributions', lines: [line(A), line(Bo, { contribNew: rub(100) }), line(V)] };
    const r = calc(t, [income(A, 100), expense(V, 400)]);
    assert.ok(Object.is(r.perPerson.a.remainderShare, 0), 'у Ани −0');
    assert.equal(r.perPerson.b.remainderShare, rub(-300));
  });

  test('отрицательная или дробная сумма операции отклоняется', () => {
    assert.throws(() => calculatePeriod({ members: MEMBERS, terms: T_A, operations: [{ type: 'income', memberId: A, amount: -1 }] }));
    assert.throws(() => calculatePeriod({ members: MEMBERS, terms: T_A, operations: [{ type: 'income', memberId: A, amount: 1.5 }] }));
  });
});

describe('§3а.7 validateTerms — отрицательные проверки', () => {
  const ctx = { members: MEMBERS, currentDebt: { b: rub(10_000) } };
  const msgs = (terms, c = ctx) => validateTerms(terms, c).errors.map((e) => e.message);
  const withLine = (base, id, over) => ({ ...base, lines: base.lines.map((l) => (l.memberId === id ? { ...l, ...over } : l)) });

  test('корректные шаблоны проходят', () => {
    for (const t of [T_EQUAL, T_A, T_A_PCT, T_B, T_MIXED]) assert.deepEqual(msgs(t, { members: MEMBERS }), []);
  });

  test('сумма % ≠ 100 → «Сейчас 90 %, нужно 100 %»', () => {
    assert.ok(msgs(withLine(T_B, V, { shareBp: 1000 })).includes('Сейчас 90 %, нужно 100 %'));
  });

  test('доля > 0 у неучаствующего', () => {
    const t = withLine(T_B, V, { inRemainder: false });
    const m = msgs(t);
    assert.ok(m.includes('Вика: не участвует в остатке, доля должна быть 0 %'));
    assert.ok(m.includes('Сейчас 80 %, нужно 100 %'));
  });

  test('никто не участвует в остатке', () => {
    const t = { ...T_A, lines: T_A.lines.map((l) => ({ ...l, inRemainder: false })) };
    assert.ok(msgs(t).includes('Кто-то должен получать остаток'));
  });

  test('ставка < 0 или дробные копейки', () => {
    assert.ok(msgs(withLine(T_B, A, { rate: { type: 'period', amount: -100 } })).includes('Ставка не может быть меньше нуля'));
    assert.ok(msgs(withLine(T_B, A, { rate: { type: 'period', amount: 100.5 } })).includes('Ставка не может быть меньше нуля'));
    assert.ok(msgs(withLine(T_B, A, { rate: { type: 'period', amount: rub(100_000_001) } })).includes('Ставка не больше 100 000 000 ₽'));
    assert.ok(msgs(withLine(T_B, A, { rate: { type: 'none', amount: 100 } })).includes('Тип «нет» — ставка 0'));
  });

  test('за час с нулевой ставкой — предупреждение, не ошибка', () => {
    const r = validateTerms(withLine(T_A, V, { rate: { type: 'hourly', amount: 0 } }), { members: MEMBERS });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings.map((w) => w.message), ['ставка 0 — по сути „нет“']);
  });

  test('вклад < 0; вещь без описания или оценки', () => {
    assert.ok(msgs(withLine(T_V, Bo, { contribNew: -1 })).includes('Вклад не может быть меньше нуля'));
    assert.ok(msgs(withLine(T_V, Bo, { contribNote: '  ' })).includes('Опиши вещь и укажи оценку'));
    assert.ok(msgs(withLine(T_V, Bo, { contribNew: 0 })).includes('Опиши вещь и укажи оценку'));
  });

  test('«списать до» больше долга → «Можно списать не больше 10 000 ₽»', () => {
    assert.ok(msgs(withLine(T_MIXED, Bo, { contribNew: 0, debtWriteOff: rub(15_000) })).includes('Можно списать не больше 10 000 ₽'));
  });

  test('выключение блока 2 без списания всего долга', () => {
    const off = { ...T_B };
    assert.ok(msgs(off).includes('Сначала верните или спишите весь долг: Боря 10 000 ₽'));
    assert.deepEqual(msgs(withLine(off, Bo, { debtWriteOff: rub(10_000) })), []);
  });

  test('выход участника без списания всего долга', () => {
    const t = withLine(withLine(T_MIXED, Bo, { contribNew: 0, contribKind: undefined, inRemainder: false, shareBp: 0 }), A, {
      shareBp: 8000,
    });
    const leaving = { ...ctx, leaving: [Bo] };
    assert.ok(msgs(t, leaving).includes('Сначала верните или спишите весь долг: Боря 10 000 ₽'));
    assert.deepEqual(msgs(withLine(t, Bo, { debtWriteOff: rub(10_000) }), leaving), []);
    const noLine = { ...t, lines: t.lines.filter((l) => l.memberId !== Bo) };
    assert.ok(msgs(noLine, leaving).includes('Сначала верните или спишите весь долг: Боря 10 000 ₽'));
  });

  test('выключение блока 2: должник без строки в условиях тоже должен списать весь долг', () => {
    const noBo = { ...T_B, lines: T_B.lines.filter((l) => l.memberId !== Bo).map((l) => (l.memberId === A ? { ...l, shareBp: 8000 } : l)) };
    assert.deepEqual(msgs(noBo), ['Сначала верните или спишите весь долг: Боря 10 000 ₽']);
    assert.deepEqual(msgs(noBo, { ...ctx, stage: 'accept' }), ['Боря: долг вырос до 10 000 ₽ — предложите условия заново']);
    // Со строкой и неполным списанием — одно сообщение, не два.
    assert.deepEqual(msgs(withLine(T_B, Bo, { debtWriteOff: rub(4_000) })), ['Сначала верните или спишите весь долг: Боря 10 000 ₽']);
  });

  test('выходящий участник не может вносить новый вклад', () => {
    // Сценарий ревью: Боря выходит, долг 10 000, X = 10 000, новый денежный вклад 5 000, блок 2 вкл.
    const t = withLine(withLine(T_MIXED, Bo, { inRemainder: false, shareBp: 0, debtWriteOff: rub(10_000), contribNew: rub(5_000), contribKind: 'money', contribNote: undefined }), A, {
      shareBp: 8000,
    });
    assert.deepEqual(msgs(t, { ...ctx, leaving: [Bo] }), ['Выходящий участник не может вносить новый вклад']);
    assert.deepEqual(msgs(withLine(t, Bo, { contribNew: 0 }), { ...ctx, leaving: [Bo] }), []);
  });

  test('«по %» 50/50/0 при «все участвуют» отклоняется, хотя сумма 100 %', () => {
    const t = { ...T_A_PCT, lines: T_A_PCT.lines.map((l, k) => ({ ...l, shareBp: [5000, 5000, 0][k] })) };
    assert.deepEqual(msgs(t, { members: MEMBERS }), ['Вика: участвует в остатке, а доля 0 %']);
  });

  test('денежный вклад 0,5 копейки отклоняется', () => {
    const t = withLine(T_V, Bo, { contribNew: 0.5, contribKind: 'money', contribNote: undefined });
    assert.deepEqual(msgs(t, { members: MEMBERS }), ['Вклад не может быть меньше нуля']);
  });

  test('последнее согласие после роста долга выше X', () => {
    const t = withLine(T_B, Bo, { debtWriteOff: rub(10_000) });
    assert.deepEqual(msgs(t, { ...ctx, stage: 'accept' }), []);
    const grown = { members: MEMBERS, currentDebt: { b: rub(15_000) }, stage: 'accept' };
    assert.deepEqual(msgs(t, grown), ['Боря: долг вырос до 15 000 ₽ — предложите условия заново']);
  });

  test('две строки на одного участника и строка на вышедшего', () => {
    const dup = { ...T_A, lines: [...T_A.lines, line(A)] };
    assert.ok(msgs(dup).includes('Условия — только для участников проекта, по одной строке на человека'));
    const left = { members: MEMBERS.map((m) => (m.id === V ? { ...m, status: 'left' } : m)) };
    assert.ok(msgs(T_A, left).includes('Условия — только для участников проекта, по одной строке на человека'));
  });

  test('«по вкладам» без вкладов — предупреждение «Вкладов нет — поровну»', () => {
    const r = validateTerms({ contribEnabled: true, remainderMethod: 'contributions', lines: T_A.lines }, ctx);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings.map((w) => w.message), ['Вкладов нет — поровну']);
  });
});

describe('Инвариант на 500 случайных входах', () => {
  test('Σ положено = Σ на руках, Σ перевод = 0, всё в целых копейках', () => {
    const rnd = mulberry32(20261031);
    const int = (n) => Math.floor(rnd() * n);
    const methods = ['equal', 'percent', 'contributions', 'hours'];
    const rateTypes = ['none', 'period', 'hourly', 'piece'];
    for (let run = 0; run < 500; run += 1) {
      const n = 1 + int(6);
      const members = Array.from({ length: n }, (_, k) => ({ id: `m${k}`, name: `У${k}`, position: n - k, role: 'user' }));
      const method = methods[int(4)];
      const inRem = members.map(() => rnd() < 0.8);
      if (!inRem.some(Boolean)) inRem[0] = true;
      // Доли по % суммой 10000 среди участвующих.
      const bp = members.map(() => 0);
      const part = members.map((_, k) => k).filter((k) => inRem[k]);
      let left = 10_000;
      part.forEach((k, idx) => {
        bp[k] = idx === part.length - 1 ? left : 1 + int(left - (part.length - idx - 1));
        left -= bp[k];
      });
      const terms = {
        contribEnabled: rnd() < 0.5,
        remainderMethod: method,
        lines: members.map((m, k) =>
          line(m.id, {
            expensesBack: rnd() < 0.8,
            rate: { type: rateTypes[int(4)], amount: int(5_000_000) },
            inRemainder: inRem[k],
            shareBp: method === 'percent' ? bp[k] : 0,
            contribNew: rnd() < 0.3 ? int(10_000_000) : 0,
          }),
        ),
      };
      terms.lines.forEach((l) => {
        if (l.rate.type === 'none') l.rate.amount = 0;
      });
      const ops = Array.from({ length: int(12) }, () => ({
        type: ['income', 'income', 'expense', 'income_refund'][int(4)],
        memberId: members[int(n)].id,
        amount: 1 + int(50_000_000),
      }));
      const quantities = Object.fromEntries(
        members.map((m) => [m.id, { hours: rnd() < 0.7 ? int(999_900) : 0, pieces: rnd() < 0.7 ? int(100_000_000) : 0 }]),
      );
      const debtAtStart = Object.fromEntries(members.map((m) => [m.id, rnd() < 0.4 ? int(20_000_000) : 0]));
      const input = { members, terms, operations: ops, quantities, debtAtStart };
      const snapshot = JSON.stringify(input);
      const r = calculatePeriod(input);
      checkInvariants(r);
      assert.equal(JSON.stringify(input), snapshot, 'вход мутирован');
      const S = Object.values(r.perPerson).reduce((s, p) => s + p.rate, 0);
      assert.ok(S <= r.ratesAccrued, 'выплачено ставок не больше начисленного');
      const close = closePeriodDebt({
        members,
        debtAtStart,
        repaid: Object.fromEntries(r.order.map((id) => [id, r.perPerson[id].contributionBack])),
        nextTerms: terms,
      });
      for (const d of Object.values(close.debtAtNextStart)) assert.ok(d >= 0);
    }
  });
});

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
