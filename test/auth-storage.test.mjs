// Сессия не теряется при смене адреса Supabase (регрессия 1.0.2 → 1.0.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_STORAGE_KEY, migrateAuthStorage } from '../src/lib/auth-storage.ts';

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
}

test('ключ закреплён за проектом, как у 1.0.2', () => {
  // supabase-js 2.x для https://jrarbbfsqrkjckujfpcz.supabase.co строит именно этот ключ.
  const legacy = `sb-${new URL('https://jrarbbfsqrkjckujfpcz.supabase.co').hostname.split('.')[0]}-auth-token`;
  assert.equal(AUTH_STORAGE_KEY, legacy);
});

test('сессия 1.0.3 переносится на закреплённый ключ вместе с code-verifier', () => {
  const s = mem({ 'sb-api-auth-token': 'S', 'sb-api-auth-token-code-verifier': 'V' });
  migrateAuthStorage(s);
  assert.equal(s.getItem(AUTH_STORAGE_KEY), 'S');
  assert.equal(s.getItem(AUTH_STORAGE_KEY + '-code-verifier'), 'V');
  assert.equal(s.getItem('sb-api-auth-token'), null);
});

test('существующая сессия 1.0.2 не перезаписывается', () => {
  const s = mem({ [AUTH_STORAGE_KEY]: 'OLD', 'sb-api-auth-token': 'NEW' });
  migrateAuthStorage(s);
  assert.equal(s.getItem(AUTH_STORAGE_KEY), 'OLD');
});

test('без хранилища — без ошибок', () => {
  migrateAuthStorage(undefined);
});
