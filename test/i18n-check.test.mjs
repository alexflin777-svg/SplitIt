/**
 * Негативный контроль гейта переводов (scripts/check-i18n.mjs).
 *
 * Запуск: node --import tsx --test test/i18n-check.test.mjs
 *
 * Ревью 2026-10-21: первая версия поддержки множественного числа исключила
 * формы `ключ#…` из проверки — удаление ru `#one` («1 участников») и английский
 * текст в русской форме проходили молча. Здесь каждая порча словаря должна
 * ронять проверку, а настоящие словари — проходить.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkI18n } from '../scripts/check-i18n.mjs';
import { ALL_MESSAGES } from '../src/lib/i18n/messages.ts';

const KEY = 'eventDetail.membersCountShort';
const clone = () => Object.fromEntries(Object.entries(ALL_MESSAGES).map(([l, m]) => [l, { ...m }]));
const has = (problems, re) => problems.some((p) => re.test(p));

describe('check-i18n: множественное число', () => {
  test('настоящие словари всех 10 локалей проходят', () => {
    assert.deepEqual(checkI18n(ALL_MESSAGES), []);
  });

  test('удалённая ru-форма #one роняет проверку', () => {
    const all = clone();
    delete all.ru[`${KEY}#one`];
    assert.ok(has(checkI18n(all), /^ru: нет формы eventDetail\.membersCountShort#one$/));
  });

  test('удалённая ru-форма #few роняет проверку', () => {
    const all = clone();
    delete all.ru[`${KEY}#few`];
    assert.ok(has(checkI18n(all), /^ru: нет формы eventDetail\.membersCountShort#few$/));
  });

  test('английский текст в ru-форме роняет проверку', () => {
    const all = clone();
    all.ru[`${KEY}#one`] = all.en[`${KEY}#one`];
    assert.ok(has(checkI18n(all), /^ru: eventDetail\.membersCountShort#one не переведён/));
  });

  test('английский базовый текст в ru-форме тоже ловится', () => {
    const all = clone();
    all.ru[`${KEY}#few`] = all.en[KEY];
    assert.ok(has(checkI18n(all), /^ru: eventDetail\.membersCountShort#few не переведён/));
  });

  test('несуществующая в языке категория роняет проверку', () => {
    const all = clone();
    all.ru[`${KEY}#two`] = '{count} участничка';
    all.ja[`${KEY}#one`] = 'メンバー{count}人';
    const problems = checkI18n(all);
    assert.ok(has(problems, /^ru: форма eventDetail\.membersCountShort#two — категории «two»/));
    assert.ok(has(problems, /^ja: форма eventDetail\.membersCountShort#one — категории «one»/));
  });

  test('форма без {count} и форма неизвестного ключа роняют проверку', () => {
    const all = clone();
    all.ru[`${KEY}#one`] = 'один участник';
    all.ru['home.unknownKey#one'] = '{count} что-то';
    const problems = checkI18n(all);
    assert.ok(has(problems, /^ru: форма eventDetail\.membersCountShort#one без \{count\}$/));
    assert.ok(has(problems, /^ru: форма home\.unknownKey#one — ключ не объявлен plural/));
  });

  test('разные наборы категорий у языков не требуются: ja без форм проходит', () => {
    const all = clone();
    assert.equal(Object.keys(all.ja).some((k) => k.startsWith(`${KEY}#`)), false);
    assert.deepEqual(checkI18n(all), []);
  });

  test('обычные ключи по-прежнему проверяются', () => {
    const all = clone();
    delete all.de['nav.home'];
    all.ru['nav.friends'] = all.en['nav.friends'];
    const problems = checkI18n(all);
    assert.ok(has(problems, /^de: нет ключа nav\.home$/));
    assert.ok(has(problems, /^ru: nav\.friends не переведён/));
  });
});
