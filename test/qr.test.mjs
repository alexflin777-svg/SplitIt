// QR ссылки приглашения (3г, круг 2): матрица совпадает с эталоном библиотеки
// на той же строке, чужая строка даёт другой код, мусор — без QR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import qrcode from 'qrcode-generator';
import { qrMatrix, qrPath } from '../src/lib/qr.ts';

const reference = (s) => {
  const qr = qrcode(0, 'M');
  qr.addData(s, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
};

test('QR кодирует ровно ссылку приглашения', () => {
  for (const link of ['https://konstantalabs.ru/invite?code=kzn7q2', 'http://localhost:3000/projects/join?code=svd4k2']) {
    const m = qrMatrix(link);
    assert.deepEqual(m, reference(link));
    assert.notDeepEqual(m, reference(link + 'x'));
    // Угловой поисковый узор 7×7: первая строка целиком тёмная.
    assert.deepEqual(m[0].slice(0, 7), Array(7).fill(true));
  }
});

test('пустая и невалидная ссылка — QR нет', () => {
  const tooLong = 'https://a.b/?c=' + 'x'.repeat(3000);
  for (const bad of [null, undefined, '', '/invite?code=x', 'не ссылка', 'javascript:alert(1)', 'ftp://a.b/c', 'https://a.b/я', tooLong]) {
    assert.equal(qrMatrix(bad), null, String(bad));
  }
});

test('SVG-путь: по квадрату на каждый тёмный модуль', () => {
  const m = qrMatrix('https://a.b/c');
  const dark = m.flat().filter(Boolean).length;
  assert.equal(qrPath(m).match(/M/g).length, dark);
  assert.equal(qrPath([[true, false], [false, true]]), 'M0 0h1v1h-1zM1 1h1v1h-1z');
});
