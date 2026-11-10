/**
 * Переключение языка (1.1.1, круг 3): гонка ленивых словарей.
 *
 * Запуск: node --import tsx --test test/i18n-race.test.mjs
 *
 * ru и en лежат в стартовом наборе и должны включаться сразу, без ожидания.
 * Если словарь раннего выбора догрузился позже словаря более нового — побеждает
 * последний выбор, поздний ответ его не перетирает.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { localeSwitcher } from '../src/lib/i18n/loaded.ts';

/** Загрузчик, которым тест управляет вручную: resolve(locale) завершает загрузку. */
function manualLoader() {
  const waiting = {};
  const load = (locale) => new Promise((resolve, reject) => (waiting[locale] = { resolve, reject }));
  return { load, resolve: (l) => waiting[l].resolve(), reject: (l) => waiting[l].reject(new Error('net')) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('localeSwitcher', () => {
  test('ru и en включаются синхронно, без ожидания загрузки', () => {
    const applied = [];
    const { load } = manualLoader();
    const sw = localeSwitcher((l) => applied.push(l), load);
    sw('ru');
    assert.deepEqual(applied, ['ru']);
    sw('en');
    assert.deepEqual(applied, ['ru', 'en']);
  });

  test('ранний запрос, завершившийся позже, не перетирает поздний выбор', async () => {
    const applied = [];
    const loader = manualLoader();
    const sw = localeSwitcher((l) => applied.push(l), loader.load);
    sw('es');
    sw('de');
    loader.resolve('de');
    await tick();
    loader.resolve('es');
    await tick();
    assert.deepEqual(applied, ['de']);
  });

  test('ленивый словарь, догрузившийся после выбора ru, не включается', async () => {
    const applied = [];
    const loader = manualLoader();
    const sw = localeSwitcher((l) => applied.push(l), loader.load);
    sw('es');
    sw('ru');
    loader.resolve('es');
    await tick();
    assert.deepEqual(applied, ['ru']);
  });

  test('сбой загрузки последнего выбора включает язык с запасным текстом, а не молчит', async () => {
    const applied = [];
    const loader = manualLoader();
    const sw = localeSwitcher((l) => applied.push(l), loader.load);
    const warn = console.warn;
    console.warn = () => {};
    try {
      sw('ja');
      loader.reject('ja');
      await tick();
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(applied, ['ja']);
  });
});
