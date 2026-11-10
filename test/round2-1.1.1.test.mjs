/**
 * 1.1.1, круг 2 (ревью Codex perf-codex.md): смена аккаунта без перезагрузки,
 * отказ в доступе после снимка, вход по deep link только из начатой попытки,
 * версия снимков, список проектов страницами, userinfo в deep link.
 * Запуск: node --import tsx --test test/round2-1.1.1.test.mjs
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** localStorage: ключи — собственные свойства (их перебирает clearSnaps), методы — в прототипе. */
class MemoryStorage {
  getItem(k) {
    return Object.hasOwn(this, k) ? this[k] : null;
  }
  setItem(k, v) {
    this[k] = String(v);
  }
  removeItem(k) {
    delete this[k];
  }
  get length() {
    return Object.keys(this).length;
  }
  key(i) {
    return Object.keys(this)[i] ?? null;
  }
}
const ls = new MemoryStorage();
globalThis.window = { localStorage: ls, dispatchEvent: () => true };
globalThis.localStorage = ls;
const keys = () => Object.keys(ls);

const snap = await import('../src/lib/snapshot.ts');
const sb = await import('../src/lib/supabase.ts');
const { createProjectsStore } = await import('../src/lib/projects-store.ts');
const { beginAuthAttempt, acceptAuthCallback } = await import('../src/lib/auth-attempt.ts');
const { ownAuthCallback } = await import('../src/lib/auth-return.ts');

const user = (id) => ({ id, email: `${id}@example.com`, full_name: id });
const deferred = () => {
  let open;
  const gate = new Promise((r) => (open = r));
  return { gate, open };
};

beforeEach(() => {
  for (const k of keys()) ls.removeItem(k);
  snap.clearSnaps();
});

describe('смена аккаунта без перезагрузки (блокер 1)', () => {
  test('поздний ответ getActiveSession аккаунта A не сохраняет профиль A после входа B', async () => {
    sb.saveLocalSession(user('A'));
    const state = { who: 'A', gate: deferred() };
    const client = {
      auth: {
        getUser: async () => {
          const who = state.who; // ответ сервера — тот, кто был в момент запроса
          await state.gate.gate;
          return { data: { user: { id: who, email: `${who}@example.com`, user_metadata: {}, created_at: '' } }, error: null };
        },
      },
      from: () => {
        const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }) };
        return b;
      },
    };
    const pending = sb.activeSessionVia(client);
    // Вход B, пока запрос A в полёте.
    sb.saveLocalSession(user('B'));
    state.who = 'B';
    state.gate.open();
    const got = await pending;
    assert.equal(got?.id, 'B', 'B не получает профиль A');
    assert.equal(sb.getLocalSession()?.id, 'B', 'профиль A не перезаписал сессию B');
  });

  test('fetchProject: A начал запрос → вход B → B получает свой ответ, не A', async () => {
    sb.saveLocalSession(user('A'));
    const state = { who: 'A', gate: deferred() };
    const client = {
      from(table) {
        const who = state.who;
        const b = {
          select: () => b,
          eq: () => b,
          in: () => b,
          order: () => b,
          range: () => b,
          maybeSingle: () => b,
          then: (res, rej) =>
            state.gate.gate
              .then(() =>
                table === 'projects'
                  ? { data: { id: 'p', name: `проект ${who}`, currency: 'RUB', owner_id: who, created_at: '' }, error: null }
                  : { data: [], error: null },
              )
              .then(res, rej),
        };
        return b;
      },
    };
    const store = createProjectsStore(client);
    const forA = store.fetchProject('p');
    sb.saveLocalSession(user('B'));
    state.who = 'B';
    const forB = store.fetchProject('p');
    state.gate.open();
    assert.equal((await forA).data.project.name, 'проект A');
    assert.equal((await forB).data.project.name, 'проект B', 'B не получает результат A из общей карты «в полёте»');
  });

  test('снимок, начатый в прежнем поколении входа, не сохраняется; выход стирает снимки', async () => {
    sb.saveLocalSession(user('A'));
    const gen = snap.authGeneration();
    snap.writeSnap('A', 'home-project-tiles', [{ id: 'p' }], gen);
    assert.ok(snap.readSnap('A', 'home-project-tiles', Array.isArray));
    await sb.signOutUser();
    assert.notEqual(snap.authGeneration(), gen, 'выход — новое поколение');
    assert.equal(snap.readSnap('A', 'home-project-tiles', Array.isArray), null, 'снимки стёрты');
    snap.writeSnap('A', 'home-project-tiles', [{ id: 'p' }], gen); // поздний ответ A
    assert.equal(snap.readSnap('A', 'home-project-tiles', Array.isArray), null, 'поздний ответ не сохранён');
    assert.ok(!keys().some((k) => k.startsWith('splitit_snap:')), 'и в localStorage пусто');
  });
});

describe('отказ в доступе после снимка (блокер 2)', () => {
  const name = 'project:p';
  const ok = (v) => !!v && typeof v === 'object';

  test('«нет прав / не найдено» — снимок удаляется, экран обнуляется', () => {
    sb.saveLocalSession(user('A'));
    const gen = snap.authGeneration();
    snap.writeSnap('A', name, { x: 1 }, gen);
    const r = snap.settleSnap('A', name, gen, { data: null, error: 'нет прав', reason: 'denied' });
    assert.equal(r, 'denied');
    assert.equal(snap.readSnap('A', name, ok), null);
    assert.ok(!keys().some((k) => k.includes(name)));
  });

  test('сеть / таймаут / 5xx — снимок остаётся, экран показывает его с ошибкой', () => {
    sb.saveLocalSession(user('A'));
    const gen = snap.authGeneration();
    snap.writeSnap('A', name, { x: 1 }, gen);
    for (const reason of ['network', undefined]) {
      const r = snap.settleSnap('A', name, gen, { data: null, error: 'Нет связи с сервером.', reason });
      assert.equal(r, 'kept');
      assert.deepEqual(snap.readSnap('A', name, ok), { x: 1 });
    }
  });

  test('ответ прежнего поколения не применяется и не сохраняется', () => {
    sb.saveLocalSession(user('A'));
    const gen = snap.authGeneration();
    sb.saveLocalSession(user('B'));
    assert.equal(snap.settleSnap('A', name, gen, { data: { x: 1 }, error: null }), 'stale');
    assert.equal(snap.readSnap('A', name, ok), null);
  });

  test('store различает причины: пустой ответ RLS и 42501 — denied, обрыв связи и 5xx — network', async () => {
    const make = (resp) => ({
      from() {
        const b = { select: () => b, eq: () => b, in: () => b, order: () => b, range: () => b, maybeSingle: () => b, then: (res) => res(resp()) };
        return b;
      },
    });
    const denied = await createProjectsStore(make(() => ({ data: null, error: null }))).fetchProject('p1');
    assert.equal(denied.reason, 'denied');
    const net = await createProjectsStore(make(() => ({ data: null, error: { message: 'TypeError: Failed to fetch' } }))).fetchProject('p2');
    assert.equal(net.reason, 'network');
    const s5xx = await createProjectsStore(make(() => ({ data: null, error: { message: 'upstream', code: '' }, status: 503 }))).fetchProject('p3');
    assert.equal(s5xx.reason, 'network');
    const rls = await createProjectsStore(make(() => ({ data: null, error: { message: 'permission denied', code: '42501' } }))).fetchProject('p4');
    assert.equal(rls.reason, 'denied');
  });
});

describe('вход по deep link — только из начатой на устройстве попытки (блокер 3)', () => {
  const kv = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };

  test('Telegram: без начатой попытки callback отклонён', () => {
    assert.equal(acceptAuthCallback('telegram', 'любой', kv()), false);
  });

  test('Telegram: своя попытка принимается один раз; повтор отклонён', () => {
    const s = kv();
    const id = beginAuthAttempt('telegram', s, 1_000);
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(acceptAuthCallback('telegram', id, s, 2_000), true);
    assert.equal(acceptAuthCallback('telegram', id, s, 3_000), false, 'повторный callback');
  });

  test('Telegram: чужой идентификатор или его отсутствие — отклонено, попытка погашена', () => {
    const s = kv();
    const id = beginAuthAttempt('telegram', s, 0);
    assert.equal(acceptAuthCallback('telegram', 'чужой', s, 1), false);
    assert.equal(acceptAuthCallback('telegram', id, s, 2), false, 'после подбора попытка уже погашена');
    const s2 = kv();
    beginAuthAttempt('telegram', s2, 0);
    assert.equal(acceptAuthCallback('telegram', null, s2, 1), false, 'страница без attempt');
  });

  test('просроченная попытка (старше 10 минут) отклонена', () => {
    const s = kv();
    const id = beginAuthAttempt('telegram', s, 0);
    assert.equal(acceptAuthCallback('telegram', id, s, 10 * 60_000 + 1), false);
  });

  test('Google: нужен незавершённый вход Google; Telegram-попытка не подходит', () => {
    const s = kv();
    assert.equal(acceptAuthCallback('google', null, s), false);
    beginAuthAttempt('telegram', s, 0);
    assert.equal(acceptAuthCallback('google', null, s, 1), false);
    beginAuthAttempt('google', s, 0);
    assert.equal(acceptAuthCallback('google', null, s, 1), true);
    assert.equal(acceptAuthCallback('google', null, s, 2), false);
  });

  test('Google: код без PKCE-verifier этого устройства не меняется на сессию (и в сеть не уходит)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const s = kv();
    let fetched = 0;
    const client = createClient('https://example.invalid', 'anon', {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: s, storageKey: 'k' },
      global: { fetch: async () => (fetched++, new Response('{}', { status: 500 })) },
    });
    const { error } = await client.auth.exchangeCodeForSession('code-from-attacker');
    assert.ok(error, 'обмен отклонён');
    assert.match(error.name, /PKCE|CodeVerifier/i);
    assert.equal(fetched, 0);
  });

  test('ownAuthCallback отклоняет username/password в адресе', () => {
    assert.equal(ownAuthCallback('app.splitit.mobile://evil@auth/callback?code=abc'), null);
    assert.equal(ownAuthCallback('app.splitit.mobile://u:p@auth/callback?code=abc'), null);
    assert.equal(ownAuthCallback('app.splitit.mobile://auth/callback?code=abc')?.get('code'), 'abc');
  });
});

describe('снимок: версия и структура (п. 4)', () => {
  test('{"oldFormat":true} — несовместимо: удаляется, экран читает сервер', () => {
    ls.setItem('splitit_snap:A:home-project-tiles', JSON.stringify({ oldFormat: true }));
    assert.equal(snap.readSnap('A', 'home-project-tiles', Array.isArray), null);
    assert.equal(ls.getItem('splitit_snap:A:home-project-tiles'), null);
  });

  test('запись без версии (формат круга 1) — тоже удаляется', () => {
    ls.setItem('splitit_snap:A:home-project-tiles', JSON.stringify([{ id: 'p' }]));
    assert.equal(snap.readSnap('A', 'home-project-tiles', Array.isArray), null);
    assert.equal(ls.getItem('splitit_snap:A:home-project-tiles'), null);
  });

  test('своя версия и верная структура — читается из localStorage', () => {
    sb.saveLocalSession(user('A'));
    snap.writeSnap('A', 'home-project-tiles', [{ id: 'p' }], snap.authGeneration());
    const raw = ls.getItem('splitit_snap:A:home-project-tiles');
    snap.clearSnaps();
    ls.setItem('splitit_snap:A:home-project-tiles', raw);
    assert.deepEqual(snap.readSnap('A', 'home-project-tiles', Array.isArray), [{ id: 'p' }]);
  });
});

describe('список проектов (п. 6)', () => {
  test('читается страницами: больше 1000 проектов не теряются', async () => {
    const all = Array.from({ length: 1203 }, (_, i) => ({ id: `p${i}`, name: `${i}`, currency: 'RUB', owner_id: 'u', created_at: '' }));
    const client = {
      from() {
        const q = { range: [0, 999] };
        const b = {
          select: () => b,
          order: () => b,
          range: (a, z) => ((q.range = [a, Math.min(z, a + 999)]), b), // как max-rows PostgREST
          then: (res) => res({ data: all.slice(q.range[0], q.range[1] + 1), error: null }),
        };
        return b;
      },
    };
    const r = await createProjectsStore(client).fetchProjects();
    assert.equal(r.data?.length, 1203);
  });
});
