// F6: распределение расхода по позициям чека между участниками.
// Инварианты: сумма долей строго равна итогу, нет отрицательных и NaN,
// общая позиция делится поровну, разница (скидка/чаевые) — пропорционально.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { allocateByItems } from '../src/lib/item-split.ts';

const cents = (x) => Math.round(x * 100);
const sum = (shares) => Object.values(shares).reduce((s, v) => s + cents(v), 0);

function assertInvariants(shares, total) {
  assert.equal(sum(shares), cents(total), `сумма долей ${sum(shares)} ≠ ${cents(total)}`);
  for (const [id, v] of Object.entries(shares)) {
    assert.ok(Number.isFinite(v) && v >= 0, `${id}: ${v}`);
    assert.equal(cents(v) / 100, v, `${id}: больше двух знаков — ${v}`);
  }
}

describe('allocateByItems', () => {
  test('личные позиции и общая поровну, без разницы', () => {
    const shares = allocateByItems(1000, [
      { total: 400, memberIds: ['a'] },
      { total: 300, memberIds: ['b'] },
      { total: 300, memberIds: ['a', 'b', 'c'] },
    ]);
    assertInvariants(shares, 1000);
    assert.deepEqual(shares, { a: 500, b: 400, c: 100 });
  });

  test('чаевые делятся пропорционально сумме позиций', () => {
    const shares = allocateByItems(110, [
      { total: 60, memberIds: ['a'] },
      { total: 40, memberIds: ['b'] },
    ]);
    assertInvariants(shares, 110);
    assert.deepEqual(shares, { a: 66, b: 44 });
  });

  test('скидка уменьшает доли пропорционально и не уводит в минус', () => {
    const shares = allocateByItems(90, [
      { total: 99.99, memberIds: ['a'] },
      { total: 0.01, memberIds: ['b'] },
    ]);
    assertInvariants(shares, 90);
  });

  test('копейки: 100 на троих по одной общей позиции', () => {
    const shares = allocateByItems(100, [{ total: 100, memberIds: ['a', 'b', 'c'] }]);
    assertInvariants(shares, 100);
    assert.deepEqual(Object.values(shares).sort(), [33.33, 33.33, 33.34]);
  });

  test('итог в валюте события отличается от суммы чека (конвертация)', () => {
    const shares = allocateByItems(1234.57, [
      { total: 7.5, memberIds: ['a'] },
      { total: 5, memberIds: ['b', 'c'] },
    ]);
    assertInvariants(shares, 1234.57);
  });

  test('позиция без участников делится на всех, кто есть в других позициях', () => {
    const shares = allocateByItems(30, [
      { total: 10, memberIds: ['a'] },
      { total: 20, memberIds: [] },
    ], ['a', 'b']);
    assertInvariants(shares, 30);
    assert.deepEqual(shares, { a: 20, b: 10 });
  });

  test('позиции с нулевой суммой — итог поровну на всех участников', () => {
    const shares = allocateByItems(10, [{ total: 0, memberIds: ['a', 'b'] }], ['a', 'b']);
    assertInvariants(shares, 10);
  });

  test('случайные наборы: инварианты держатся', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (let n = 0; n < 300; n++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => ({
        total: Math.round(rnd() * 50000) / 100,
        memberIds: ids.filter(() => rnd() > 0.5),
      }));
      const total = Math.max(0.01, Math.round(rnd() * 100000) / 100);
      const shares = allocateByItems(total, items, ids);
      assertInvariants(shares, total);
    }
  });

  test('некорректный итог — пустой результат, а не NaN', () => {
    assert.deepEqual(allocateByItems(NaN, [{ total: 1, memberIds: ['a'] }]), {});
    assert.deepEqual(allocateByItems(0, [{ total: 1, memberIds: ['a'] }]), {});
  });
});
