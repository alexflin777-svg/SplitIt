/**
 * Тесты проверки подписи Telegram Login Widget.
 * Гоняются обычным node/tsx: verify.ts написан на Web Crypto без Deno-специфики.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyTelegramAuth,
  computeTelegramHash,
  buildDataCheckString,
} from '../supabase/functions/telegram-auth/verify.ts';

const BOT_TOKEN = '1234567890:TEST-TOKEN-abcdef';
const NOW = 1_800_000_000;

/** Собирает валидный payload, подписанный настоящим алгоритмом. */
async function signedPayload(overrides = {}) {
  const base = {
    id: 42,
    first_name: 'Иван',
    username: 'ivan_travels',
    auth_date: NOW - 30,
    ...overrides,
  };
  const hash = await computeTelegramHash(base, BOT_TOKEN);
  return { ...base, hash };
}

test('валидная подпись принимается', async () => {
  const payload = await signedPayload();
  const res = await verifyTelegramAuth(payload, BOT_TOKEN, 600, NOW);
  assert.equal(res.ok, true);
});

test('изменение любого поля после подписи отклоняется', async () => {
  const payload = await signedPayload();
  const tampered = { ...payload, id: 43 };
  const res = await verifyTelegramAuth(tampered, BOT_TOKEN, 600, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'signature mismatch');
});

test('подпись чужим ботовым токеном отклоняется', async () => {
  const payload = await signedPayload();
  const res = await verifyTelegramAuth(payload, 'other-token', 600, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'signature mismatch');
});

test('просроченный auth_date отклоняется (защита от replay)', async () => {
  const payload = await signedPayload({ auth_date: NOW - 601 });
  const res = await verifyTelegramAuth(payload, BOT_TOKEN, 600, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'auth_date is too old');
});

test('auth_date из будущего отклоняется', async () => {
  const payload = await signedPayload({ auth_date: NOW + 120 });
  const res = await verifyTelegramAuth(payload, BOT_TOKEN, 600, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'auth_date is in the future');
});

test('пустой токен на сервере — отказ, а не тихий пропуск', async () => {
  const payload = await signedPayload();
  const res = await verifyTelegramAuth(payload, '', 600, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'bot token is not configured');
});

test('мусорный hash отклоняется до криптографии', async () => {
  const payload = await signedPayload();
  const res = await verifyTelegramAuth({ ...payload, hash: 'zz' }, BOT_TOKEN, 600, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'malformed hash');
});

test('отрицательный/дробный telegram id отклоняется', async () => {
  const bad = await signedPayload({ id: -1 });
  assert.equal((await verifyTelegramAuth(bad, BOT_TOKEN, 600, NOW)).ok, false);
});

test('data_check_string сортирует ключи и пропускает hash', () => {
  const s = buildDataCheckString({ b: 2, a: 1, hash: 'x' });
  assert.equal(s, 'a=1\nb=2');
});
