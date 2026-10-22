/**
 * Подписи на экранах: аватар участника и множественное число.
 *
 * Запуск: node --import tsx --test test/ui-labels.test.mjs
 *
 * 2026-10-21, iPhone: поверх карточки расхода ехала синяя base64-строка — это
 * фото участника (profiles.avatar_url = data:image/jpeg;base64,…), выведенное
 * как текст. Рядом стояло «1 участников». Данные синтетические.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { avatarGlyph, isPhotoAvatar } from '../src/lib/avatar.ts';
import { translateWith } from '../src/lib/i18n/t.ts';
import { formatNativeVersion, getNativeAppVersion } from '../src/lib/app-updater.ts';

describe('Версия в профиле', () => {
  test('нативная версия со сборкой: 1.0.2 (4), а не зашитая 1.0.0', () => {
    assert.equal(formatNativeVersion({ version: '1.0.2', build: '4' }), '1.0.2 (4)');
    assert.equal(formatNativeVersion({ version: '1.0.2', build: '1.0.2' }), '1.0.2');
    assert.equal(formatNativeVersion({ version: '1.0.2', build: '' }), '1.0.2');
  });

  test('вне нативной оболочки нативной версии нет', async () => {
    assert.equal(await getNativeAppVersion(), null);
  });
});

const PHOTO = `data:image/jpeg;base64,${'QUJDRA+/'.repeat(4000)}`;

describe('avatarGlyph: только короткий значок, никогда не сырые данные', () => {
  test('эмодзи-пресеты выводятся как есть, включая ZWJ-последовательности', () => {
    for (const emoji of ['👤', '👑', '👨‍💻', '👩‍🎨', '🕶️', '👨‍👩‍👧‍👦']) {
      assert.equal(avatarGlyph(emoji), emoji);
    }
  });

  test('фото (data URL) не превращается в текст', () => {
    assert.ok(isPhotoAvatar(PHOTO));
    assert.equal(avatarGlyph(PHOTO), '👤');
  });

  test('сложные эмодзи: тоны кожи, ZWJ, флаги, субфлаги — выводятся как есть', () => {
    for (const emoji of ['👍🏽', '🧑🏿‍💻', '👩🏻‍❤️‍👨🏾', '🏳️‍🌈', '🇷🇺', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '❤️', '🐻‍❄️']) {
      assert.equal(avatarGlyph(emoji), emoji, emoji);
    }
  });

  test('короткие технические значения — нейтральный значок', () => {
    for (const raw of ['https://a.co', 'blob:x', 'QUJDRA==', 'AB', 'x', '#', '1', '*', '1️⃣', '😀x', 'x😀', ':)', 'data:', '👤 👤']) {
      assert.equal(avatarGlyph(raw), '👤', raw);
    }
  });

  test('URL, base64 без префикса, пустое и отсутствующее значение — нейтральный значок', () => {
    for (const raw of [
      'https://example.com/a.png',
      'jW3jvdYu5LyWFUYtGFaYviNXY4UcITkAV4Vb',
      'a0000000-0000-4000-8000-000000000001',
      '',
      '   ',
      null,
      undefined,
    ]) {
      assert.equal(avatarGlyph(raw), '👤', String(raw));
    }
  });
});

describe('translateWith: множественное число по правилам языка', () => {
  const ru = (count) => translateWith('ru', 'eventDetail.membersCountShort', { count });

  test('русский: участник / участника / участников', () => {
    assert.equal(ru(1), '1 участник');
    assert.equal(ru(2), '2 участника');
    assert.equal(ru(4), '4 участника');
    assert.equal(ru(5), '5 участников');
    assert.equal(ru(11), '11 участников');
    assert.equal(ru(21), '21 участник');
    assert.equal(ru(22), '22 участника');
    assert.equal(ru(0), '0 участников');
  });

  test('русский: число расходов на главной', () => {
    assert.equal(translateWith('ru', 'home.expensesCount', { count: 1 }), '1 расход');
    assert.equal(translateWith('ru', 'home.expensesCount', { count: 3 }), '3 расхода');
    assert.equal(translateWith('ru', 'home.expensesCount', { count: 7 }), '7 расходов');
  });

  test('английский: one / other', () => {
    assert.equal(translateWith('en', 'eventDetail.membersCountShort', { count: 1 }), '1 member');
    assert.equal(translateWith('en', 'eventDetail.membersCountShort', { count: 2 }), '2 members');
  });

  test('испанский: форма many для миллионов', () => {
    assert.equal(translateWith('es', 'eventDetail.membersCountShort', { count: 1 }), '1 miembro');
    assert.equal(translateWith('es', 'eventDetail.membersCountShort', { count: 2 }), '2 miembros');
    assert.equal(translateWith('es', 'eventDetail.membersCountShort', { count: 1000000 }), '1000000 de miembros');
  });

  test('язык без форм и ключ без форм работают как раньше', () => {
    assert.equal(translateWith('ja', 'eventDetail.membersCountShort', { count: 1 }), 'メンバー1人');
    assert.equal(translateWith('ru', 'eventDetail.transactionsFeed', { count: 1 }), 'Лента транзакций (1)');
    // count строкой — не число, формы не выбираются.
    assert.equal(translateWith('ru', 'eventDetail.membersCountShort', { count: '1' }), '1 участников');
  });
});
