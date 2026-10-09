// G1: сохранение неравных долей при правке расхода.
// Инварианты: сумма долей строго равна новому итогу в копейках, результат не
// зависит от порядка входа, нулевые доли остаются нулями, «нет пропорции» — null.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  totalCents,
  sameTotal,
  isEvenSplit,
  rescaleSplits,
  resolveSplitMode,
} from '../src/lib/split-rescale.ts';

const cents = (x) => Math.round(x * 100);
const mk = (...amounts) => amounts.map((a, i) => ({ userId: `u${String(i + 1).padStart(2, '0')}`, amountOwed: a }));
const sumCents = (splits) => splits.reduce((s, x) => s + cents(x.amountOwed), 0);
const byUser = (splits) => Object.fromEntries(splits.map((s) => [s.userId, cents(s.amountOwed)]));

// Детерминированный ГПСЧ (mulberry32): тест воспроизводим при любом запуске.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rescaleSplits: точность', () => {
  test('[15.40, 13.20, 2.20] 30.80 -> 61.60 ровно вдвое', () => {
    const res = rescaleSplits(mk(15.4, 13.2, 2.2), 61.6);
    assert.deepEqual(res.map((s) => s.amountOwed), [30.8, 26.4, 4.4]);
    assert.equal(sumCents(res), 6160);
  });

  test('100 -> 100.01: лишняя копейка уходит детерминированно (при равных остатках — меньший userId)', () => {
    const res = rescaleSplits(mk(50, 50), 100.01);
    assert.equal(sumCents(res), 10001);
    assert.deepEqual(res.map((s) => s.amountOwed), [50.01, 50]);
  });

  test('копейка достаётся наибольшему остатку, а не первому в списке', () => {
    // веса 1:2 -> 3 коп: 1 и 2 без остатка; 4 коп: 1.33 и 2.67 -> лишняя второму
    const res = rescaleSplits(mk(0.01, 0.02), 0.04);
    assert.deepEqual(res.map((s) => cents(s.amountOwed)), [1, 3]);
  });

  test('сохраняет порядок и состав участников', () => {
    const input = [
      { userId: 'zz', amountOwed: 10 },
      { userId: 'aa', amountOwed: 20 },
    ];
    const res = rescaleSplits(input, 60);
    assert.deepEqual(res.map((s) => s.userId), ['zz', 'aa']);
    assert.deepEqual(res.map((s) => s.amountOwed), [20, 40]);
  });

  test('не мутирует вход', () => {
    const input = mk(1, 2, 3);
    const copy = JSON.parse(JSON.stringify(input));
    rescaleSplits(input, 10);
    assert.deepEqual(input, copy);
  });

  test('большие суммы точны: 999999999.99', () => {
    const res = rescaleSplits(mk(33.33, 33.33, 33.34), 999999999.99);
    assert.equal(sumCents(res), 99999999999);
    for (const s of res) assert.equal(cents(s.amountOwed) / 100, s.amountOwed);
  });

  test('большой итог и неравные веса: сумма в копейках точна', () => {
    const res = rescaleSplits(mk(0.01, 123456.78, 7.77), 999999999.99);
    assert.equal(sumCents(res), 99999999999);
  });

  test('нулевая доля остаётся нулём', () => {
    const res = rescaleSplits(mk(10, 0, 20), 90);
    assert.deepEqual(res.map((s) => s.amountOwed), [30, 0, 60]);
  });

  test('нулевая доля остаётся нулём даже когда есть остаток', () => {
    const res = rescaleSplits(mk(1, 0, 1, 1), 100);
    assert.equal(res[1].amountOwed, 0);
    assert.equal(sumCents(res), 10000);
  });

  test('один участник получает весь итог', () => {
    assert.deepEqual(rescaleSplits(mk(5), 12.34).map((s) => s.amountOwed), [12.34]);
  });
});

describe('rescaleSplits: независимость от порядка', () => {
  test('перестановка входа даёт те же суммы у тех же пользователей', () => {
    const base = mk(33.33, 33.33, 33.34, 0, 10.01);
    const expected = byUser(rescaleSplits(base, 77.77));
    const rnd = prng(42);
    for (let k = 0; k < 50; k++) {
      const perm = [...base];
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      assert.deepEqual(byUser(rescaleSplits(perm, 77.77)), expected);
    }
  });
});

describe('rescaleSplits: property-style (сид 20261011)', () => {
  test('сумма долей строго равна новому итогу; нет отрицательных и NaN', () => {
    const rnd = prng(20261011);
    for (let iter = 0; iter < 2000; iter++) {
      const n = 1 + Math.floor(rnd() * 8);
      const amounts = Array.from({ length: n }, () => (rnd() < 0.15 ? 0 : cents(rnd() * 500) / 100));
      if (amounts.every((a) => a === 0)) amounts[0] = 1;
      const input = mk(...amounts);
      const targetC = 1 + Math.floor(rnd() * 100_000_000);
      const res = rescaleSplits(input, targetC / 100);
      assert.ok(res, `null для ${JSON.stringify(input)} -> ${targetC}`);
      assert.equal(sumCents(res), targetC, `${JSON.stringify(amounts)} -> ${targetC}`);
      assert.equal(res.length, input.length);
      res.forEach((s, i) => {
        assert.ok(Number.isFinite(s.amountOwed) && s.amountOwed >= 0);
        if (amounts[i] === 0) assert.equal(s.amountOwed, 0);
      });
      // перестановка не меняет результата по пользователям
      const reversed = rescaleSplits([...input].reverse(), targetC / 100);
      assert.deepEqual(byUser(reversed), byUser(res));
    }
  });
});

describe('rescaleSplits: null', () => {
  test('итог <= 0', () => {
    assert.equal(rescaleSplits(mk(1, 2), 0), null);
    assert.equal(rescaleSplits(mk(1, 2), -5), null);
    assert.equal(rescaleSplits(mk(1, 2), 0.004), null);
  });
  test('итог NaN / Infinity', () => {
    assert.equal(rescaleSplits(mk(1, 2), NaN), null);
    assert.equal(rescaleSplits(mk(1, 2), Infinity), null);
  });
  test('все веса нулевые', () => {
    assert.equal(rescaleSplits(mk(0, 0), 10), null);
  });
  test('пустой список', () => {
    assert.equal(rescaleSplits([], 10), null);
  });
});

describe('totalCents / sameTotal', () => {
  test('totalCents без ошибок плавающей точки', () => {
    assert.equal(totalCents(mk(0.1, 0.2)), 30);
    assert.equal(totalCents([]), 0);
  });
  test('sameTotal: совпадение с точностью до копейки', () => {
    assert.equal(sameTotal(mk(0.1, 0.2), 0.3), true);
    assert.equal(sameTotal(mk(15.4, 13.2, 2.2), 30.8), true);
    assert.equal(sameTotal(mk(10, 10), 20.01), false);
  });
  test('sameTotal: NaN и Infinity не совпадают', () => {
    assert.equal(sameTotal(mk(10), NaN), false);
    assert.equal(sameTotal(mk(10), Infinity), false);
  });
});

describe('isEvenSplit', () => {
  test('поровну', () => {
    assert.equal(isEvenSplit(mk(5, 5)), true);
  });
  test('поровну с копеечным остатком, в любом порядке', () => {
    assert.equal(isEvenSplit(mk(33.34, 33.33, 33.33)), true);
    assert.equal(isEvenSplit(mk(33.33, 33.34, 33.33)), true);
    assert.equal(isEvenSplit(mk(33.33, 33.33, 33.34)), true);
  });
  test('неравные доли', () => {
    assert.equal(isEvenSplit(mk(15.4, 13.2, 2.2)), false);
    assert.equal(isEvenSplit(mk(0, 10)), false);
  });
  test('пустой список считается равным', () => {
    assert.equal(isEvenSplit([]), true);
  });
});

describe('resolveSplitMode', () => {
  const even = mk(5, 5);
  const uneven = mk(3, 7);
  test('сохранённый тип главнее всего', () => {
    assert.equal(resolveSplitMode({ splitMode: 'items', splitType: 'equal', splits: even }), 'items');
    assert.equal(resolveSplitMode({ splitMode: 'exact', splits: even }), 'exact');
    assert.equal(resolveSplitMode({ splitMode: 'equal', splits: uneven }), 'equal');
    assert.equal(resolveSplitMode({ splitMode: 'shares', splitType: 'shares', splits: even }), 'shares');
  });
  test('старый splitType shares -> items', () => {
    assert.equal(resolveSplitMode({ splitType: 'shares', splits: uneven }), 'items');
  });
  test('нет типа: поровну -> equal, иначе exact', () => {
    assert.equal(resolveSplitMode({ splits: even }), 'equal');
    assert.equal(resolveSplitMode({ splits: uneven }), 'exact');
    assert.equal(resolveSplitMode({ splitMode: null, splitType: null, splits: uneven }), 'exact');
  });
  test('неизвестное значение splitMode игнорируется', () => {
    assert.equal(resolveSplitMode({ splitMode: 'bogus', splits: even }), 'equal');
    assert.equal(resolveSplitMode({ splitMode: '', splits: uneven }), 'exact');
  });
});
