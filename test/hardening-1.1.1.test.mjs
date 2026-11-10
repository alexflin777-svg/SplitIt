/**
 * 1.1.1: заголовки сайта, правило пароля, предел времени запроса к базе.
 * Запуск: node --import tsx --test test/hardening-1.1.1.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePassword } from '../src/lib/credentials.ts';
import { fetchWithTimeout } from '../src/lib/fetch-timeout.ts';
import { ownAuthCallback } from '../src/lib/auth-return.ts';

describe('deep link входа', () => {
  test('свои схемы и путь — параметры; чужое — null', () => {
    assert.equal(ownAuthCallback('app.splitit.mobile://auth/callback?code=abc')?.get('code'), 'abc');
    assert.equal(ownAuthCallback('app.splitit.mobile.dev://auth/callback?tg_token_hash=t')?.get('tg_token_hash'), 't');
    for (const bad of [
      'https://evil.example/auth/callback?code=abc',
      'app.splitit.mobile://evil/auth/callback?code=abc',
      'app.splitit.mobile://auth/callback/extra?code=abc',
      'evil://auth/callback?code=abc',
      'не адрес auth/callback',
    ]) {
      assert.equal(ownAuthCallback(bad), null, bad);
    }
  });
});

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headersFor = (source) => Object.fromEntries((vercel.headers.find((h) => h.source === source)?.headers ?? []).map((h) => [h.key, h.value]));

describe('vercel.json: заголовки', () => {
  const all = headersFor('/(.*)');

  test('рамки, MIME, Referrer — на всех адресах', () => {
    assert.equal(all['X-Frame-Options'], 'DENY');
    assert.equal(all['X-Content-Type-Options'], 'nosniff');
    assert.equal(all['Referrer-Policy'], 'strict-origin-when-cross-origin');
  });

  test('CSP — только Report-Only: вход и OCR не ломаются, пока политику не проверили', () => {
    assert.ok(all['Content-Security-Policy-Report-Only']?.includes("default-src 'self'"));
    assert.ok(!vercel.headers.some((h) => h.headers.some((x) => x.key === 'Content-Security-Policy')), 'enforce-CSP не задан');
  });

  test('камера — только на экране нового расхода (OCR); микрофон и геолокация — нигде', () => {
    assert.equal(headersFor('/((?!events/expense/new).*)')['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
    assert.equal(headersFor('/events/expense/new(.*)')['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()');
    const other = new RegExp('^/((?!events/expense/new).*)$');
    assert.ok(other.test('/'), 'главная — без камеры');
    assert.ok(!other.test('/events/expense/new'), 'экран OCR не попадает в запрет');
  });
});

describe('пароль', () => {
  test('регистрация и смена: от 8 символов', () => {
    assert.ok(validatePassword('1234567'));
    assert.equal(validatePassword('12345678'), null);
  });
});

describe('fetchWithTimeout', () => {
  const hang = (_input, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));

  test('запрос дольше предела — ошибка TimeoutError, а не вечное ожидание', async () => {
    // Таймер AbortSignal.timeout в Node не держит процесс — держим сами, пока ждём.
    const keepAlive = setTimeout(() => {}, 1000);
    await assert.rejects(fetchWithTimeout(hang, 30)('https://x.invalid'), (e) => e.name === 'TimeoutError');
    clearTimeout(keepAlive);
  });

  test('собственная отмена запроса сохраняется', async () => {
    const own = new AbortController();
    const p = fetchWithTimeout(hang, 10_000)('https://x.invalid', { signal: own.signal });
    own.abort(new Error('отменено'));
    await assert.rejects(p, /отменено/);
  });

  test('быстрый ответ проходит как есть', async () => {
    const res = await fetchWithTimeout(async () => new Response('ok'), 1000)('https://x.invalid');
    assert.equal(await res.text(), 'ok');
  });
});
