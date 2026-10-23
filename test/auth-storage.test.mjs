// Сессия не теряется и не подменяется при смене адреса Supabase (1.0.2 → 1.0.3 → 1.0.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_STORAGE_KEY as K, FORMER_KEY as F, migrateAuthStorage } from '../src/lib/auth-storage.ts';

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
}

test('ключ закреплён за проектом, как у 1.0.2', () => {
  assert.equal(K, `sb-${new URL('https://jrarbbfsqrkjckujfpcz.supabase.co').hostname.split('.')[0]}-auth-token`);
});

test('1.0.2 → 1.0.4: сессия 1.0.2 остаётся как есть', () => {
  const s = mem({ [K]: 'A' });
  migrateAuthStorage(s);
  assert.equal(s.getItem(K), 'A');
});

test('чистая 1.0.3 → 1.0.4: сессия и code-verifier переносятся', () => {
  const s = mem({ [F]: 'S', [F + '-code-verifier']: 'V' });
  migrateAuthStorage(s);
  assert.equal(s.getItem(K), 'S');
  assert.equal(s.getItem(K + '-code-verifier'), 'V');
  assert.equal(s.getItem(F), null);
});

test('1.0.2 → 1.0.3 (повторный вход, другой аккаунт) → 1.0.4: побеждает более новая сессия 1.0.3', () => {
  const s = mem({ [K]: 'OLD-A', [K + '-user']: 'userA', [F]: 'NEW-B', [F + '-user']: 'userB' });
  migrateAuthStorage(s);
  assert.equal(s.getItem(K), 'NEW-B');
  assert.equal(s.getItem(K + '-user'), 'userB');
  assert.equal(s.getItem(F), null);
});

test('незавершённый PKCE-вход в 1.0.3: verifier переносится без сессии, старая сессия 1.0.2 снимается', () => {
  const s = mem({ [K]: 'OLD-A', [F + '-code-verifier']: 'V' });
  migrateAuthStorage(s);
  assert.equal(s.getItem(K + '-code-verifier'), 'V');
  assert.equal(s.getItem(K), null);
});

test('повторный вызов ничего не меняет', () => {
  const s = mem({ [F]: 'S' });
  migrateAuthStorage(s);
  s.setItem(K, 'REFRESHED');
  migrateAuthStorage(s);
  assert.equal(s.getItem(K), 'REFRESHED');
});

test('без хранилища — без ошибок', () => {
  migrateAuthStorage(undefined);
});
