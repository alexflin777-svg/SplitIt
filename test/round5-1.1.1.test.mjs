/**
 * 1.1.1, круг 5 (закрывающий вердикт Codex perf-codex-r2.md): вход из пустой
 * сессии инвалидирует прежние запросы; причина ошибки (denied/network) доходит
 * до потребителей; Telegram-мост совместим со старыми и новыми клиентами;
 * ошибочный callback гасит попытку; предложение языка для записей 1.0.x.
 * Запуск: node --import tsx --test test/round5-1.1.1.test.mjs
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

const snap = await import('../src/lib/snapshot.ts');
const sb = await import('../src/lib/supabase.ts');
const { createProjectsStore } = await import('../src/lib/projects-store.ts');
const { fetchAllPages } = await import('../src/lib/paging.ts');
const { beginAuthAttempt } = await import('../src/lib/auth-attempt.ts');

const user = (id) => ({ id, email: `${id}@example.com`, full_name: id });
const deferred = () => {
  let open;
  const gate = new Promise((r) => (open = r));
  return { gate, open };
};

beforeEach(() => {
  for (const k of Object.keys(ls)) ls.removeItem(k);
  snap.clearSnaps();
});

describe('п.1: вход из пустой сессии инвалидирует прежние запросы', () => {
  /** Auth отвечает тем, кто был в момент запроса; первый ответ задержан. */
  function slowAuthClient(state) {
    return {
      auth: {
        getUser: async () => {
          const who = state.who;
          if (state.gate) {
            const g = state.gate;
            state.gate = null;
            await g.gate;
          }
          return { data: { user: { id: who, email: `${who}@example.com`, user_metadata: {}, created_at: '' } }, error: null };
        },
      },
      from: () => {
        const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }) };
        return b;
      },
    };
  }

  test('сценарий Codex: начат запрос профиля A → сохранён B → поздний ответ A → локально остаётся B', async () => {
    assert.equal(sb.getLocalSession(), null, 'пустая локальная сессия');
    const state = { who: 'A', gate: deferred() };
    const gate = state.gate;
    const pending = sb.activeSessionVia(slowAuthClient(state));
    sb.saveLocalSession(user('B')); // вход B, пока запрос A в полёте
    state.who = 'B';
    gate.open();
    const got = await pending;
    assert.equal(sb.getLocalSession()?.id, 'B', 'поздний ответ A не перезаписал B');
    assert.equal(got?.id, 'B');
  });

  test('поколение растёт при null → uid и uid → null; перемонтирование экрана — только при смене аккаунта и выходе', () => {
    const g0 = snap.authGeneration();
    const s0 = snap.authScope?.();
    sb.saveLocalSession(user('A'));
    assert.ok(snap.authGeneration() > g0, 'null → A: прежние запросы недействительны');
    assert.equal(snap.authScope?.(), s0, 'первый вход не перемонтирует /auth и онбординг');
    const g1 = snap.authGeneration();
    sb.saveLocalSession({ ...user('A'), full_name: 'A2' });
    assert.equal(snap.authGeneration(), g1, 'тот же аккаунт (правка профиля) — то же поколение');
    sb.clearLocalSession();
    assert.ok(snap.authGeneration() > g1, 'A → null');
    assert.ok(snap.authScope() > s0, 'выход перемонтирует экраны');
  });

  test('первое восстановление сессии (локального профиля нет) отдаёт профиль, общий запрос не зацикливается', async () => {
    let calls = 0;
    const client = slowAuthClient({ who: 'A', gate: null });
    const getUser = client.auth.getUser;
    client.auth.getUser = (...a) => (calls++, getUser(...a));
    const [x, y] = await Promise.all([sb.activeSessionVia(client), sb.activeSessionVia(client)]);
    assert.equal(x?.id, 'A');
    assert.equal(y?.id, 'A');
    assert.equal(calls, 1, 'одновременные вызовы делят один запрос');
    assert.equal(sb.getLocalSession()?.id, 'A');
  });

  test('ответ store, начатый до входа из пустой сессии, не сохраняется в снимок', () => {
    const gen = snap.authGeneration();
    sb.saveLocalSession(user('B'));
    assert.equal(snap.settleSnap('B', 'home-project-tiles', gen, { data: [{ id: 'pA' }], error: null }), 'stale');
    assert.equal(snap.readSnap('B', 'home-project-tiles', Array.isArray), null);
  });
});

describe('п.2: причина ошибки доходит до потребителей', () => {
  /** Клиент, у которого таблица fail отвечает resp. */
  const clientFailing = (fail, resp) => ({
    from(table) {
      const b = {
        select: () => b,
        eq: () => b,
        in: () => b,
        order: () => b,
        range: () => b,
        maybeSingle: () => b,
        then: (res) => res(table === fail ? resp : { data: [], error: null }),
      };
      return b;
    },
  });
  const denied403 = { data: null, error: { message: 'permission denied for table projects', code: '42501' }, status: 403 };
  const net = { data: null, error: { message: 'TypeError: Failed to fetch' } };

  test('fetchHome: 403/42501 на списке проектов → reason denied', async () => {
    const r = await createProjectsStore(clientFailing('projects', denied403)).fetchHome();
    assert.equal(r.data, null);
    assert.equal(r.reason, 'denied');
  });

  test('fetchHome: отказ в таблице проекта → denied; обрыв связи → network', async () => {
    const d = await createProjectsStore(clientFailing('project_members', { ...denied403, error: { message: 'x', code: '42501' } })).fetchHome();
    assert.equal(d.reason, 'denied');
    const n = await createProjectsStore(clientFailing('projects', net)).fetchHome();
    assert.equal(n.reason, 'network');
  });

  test('fetchPeriodOperations: 42501 → denied, сеть → network', async () => {
    const d = await createProjectsStore(clientFailing('project_operations', denied403)).fetchPeriodOperations('p', 'per');
    assert.equal(d.reason, 'denied');
    const n = await createProjectsStore(clientFailing('project_operations', net)).fetchPeriodOperations('p', 'per');
    assert.equal(n.reason, 'network');
  });

  test('fetchAllPages передаёт причину ошибки страницы', async () => {
    const r = await fetchAllPages(async () => ({ data: null, error: 'нет прав', reason: 'denied' }));
    assert.equal(r.reason, 'denied');
  });
});

describe('п.3: Telegram-мост совместим со старыми и новыми клиентами', async () => {
  const { telegramBridgeAuth } = await import('../src/lib/telegram-bridge.ts').catch(() => ({}));
  const invokeOk = async () => ({ data: { token_hash: 'th1' }, error: null });
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

  test('старое приложение (страница без attempt) — deep link без attempt, вход работает как раньше', async () => {
    const r = await telegramBridgeAuth({ id: 1 }, '', invokeOk);
    assert.equal(r.url, 'app.splitit.mobile://auth/callback?tg_token_hash=th1');
  });

  test('новое приложение (с attempt) — attempt возвращается в deep link', async () => {
    const r = await telegramBridgeAuth({ id: 1 }, `?attempt=${id}`, invokeOk);
    assert.equal(r.url, `app.splitit.mobile://auth/callback?tg_token_hash=th1&attempt=${id}`);
  });

  test('испорченный attempt — честная ошибка, токен не запрашивается', async () => {
    let called = 0;
    const r = await telegramBridgeAuth({ id: 1 }, '?attempt=evil', async () => (called++, { data: { token_hash: 'x' }, error: null }));
    assert.ok(r.error);
    assert.equal(called, 0);
  });

  test('Edge Function не выдала токен — ошибка, без deep link', async () => {
    const r = await telegramBridgeAuth({ id: 1 }, `?attempt=${id}`, async () => ({ data: null, error: new Error('401') }));
    assert.ok(r.error);
    assert.equal(r.url, undefined);
  });
});

describe('п.3–4: обработчик deep link приложения 1.1.1', async () => {
  const { handleNativeAuthUrl } = await import('../src/lib/native-auth-callback.ts').catch(() => ({}));
  const { t } = await import('../src/lib/i18n/t.ts');

  function deps() {
    const calls = { verifyOtp: 0, exchange: 0, replaced: [] };
    return {
      calls,
      d: {
        auth: {
          verifyOtp: async () => (calls.verifyOtp++, await new Promise((r) => setTimeout(r, 5)), { error: null }),
          exchangeCodeForSession: async () => (calls.exchange++, { error: null }),
        },
        replace: (p) => calls.replaced.push(p),
        closeBrowser: async () => {},
        activeSession: async () => user('T'),
      },
    };
  }
  const tg = (attempt) => `app.splitit.mobile://auth/callback?tg_token_hash=th${attempt === undefined ? '' : `&attempt=${attempt}`}`;

  test('новое приложение + новая страница: своя попытка — вход', async () => {
    const { calls, d } = deps();
    const id = beginAuthAttempt('telegram');
    await handleNativeAuthUrl(tg(id), d);
    assert.equal(calls.verifyOtp, 1);
    assert.deepEqual(calls.replaced, ['/friends']);
  });

  test('новое приложение + старая страница (без attempt): честная ошибка «обновите страницу входа», токен не тратится', async () => {
    const { calls, d } = deps();
    beginAuthAttempt('telegram');
    await handleNativeAuthUrl(tg(undefined), d);
    assert.equal(calls.verifyOtp, 0);
    assert.deepEqual(calls.replaced, [`/auth?oauth_error=${encodeURIComponent(t('auth.telegramBridgeOutdated'))}`]);
    assert.equal(ls.getItem('splitit_auth_attempt'), null, 'попытка погашена');
  });

  test('чужой attempt — отклонено', async () => {
    const { calls, d } = deps();
    beginAuthAttempt('telegram');
    await handleNativeAuthUrl(tg('0f8fad5b-d9cb-469f-a165-70867728950e'), d);
    assert.equal(calls.verifyOtp, 0);
    assert.deepEqual(calls.replaced, [`/auth?oauth_error=${encodeURIComponent(t('auth.callbackRejected'))}`]);
  });

  test('ошибочный callback (error=access_denied) гасит попытку: следующий callback с кодом не принимается', async () => {
    const { calls, d } = deps();
    beginAuthAttempt('google');
    await handleNativeAuthUrl('app.splitit.mobile://auth/callback?error=access_denied', d);
    assert.deepEqual(calls.replaced, ['/auth?oauth_error=access_denied']);
    assert.equal(ls.getItem('splitit_auth_attempt'), null, 'попытка погашена');
    await handleNativeAuthUrl('app.splitit.mobile://auth/callback?code=c1', d);
    assert.equal(calls.exchange, 0, 'код после отменённой попытки не меняется на сессию');
  });

  test('два одновременных Telegram-callback: принят только один', async () => {
    const { calls, d } = deps();
    const id = beginAuthAttempt('telegram');
    await Promise.all([handleNativeAuthUrl(tg(id), d), handleNativeAuthUrl(tg(id), d)]);
    assert.equal(calls.verifyOtp, 1);
    assert.ok(calls.replaced.includes('/friends'));
  });

  test('два одновременных Google-callback: код меняется один раз', async () => {
    const { calls, d } = deps();
    beginAuthAttempt('google');
    await Promise.all([
      handleNativeAuthUrl('app.splitit.mobile://auth/callback?code=c1', d),
      handleNativeAuthUrl('app.splitit.mobile://auth/callback?code=c1', d),
    ]);
    assert.equal(calls.exchange, 1);
  });

  test('чужая схема и userinfo — игнорируются', async () => {
    const { calls, d } = deps();
    await handleNativeAuthUrl('evil://auth/callback?code=c', d);
    await handleNativeAuthUrl('app.splitit.mobile://u@auth/callback?code=c', d);
    assert.equal(calls.exchange, 0);
    assert.deepEqual(calls.replaced, []);
  });
});

describe('п.5: язык, сохранённый автоматически в 1.0.x', async () => {
  const { localeOffer } = await import('../src/lib/i18n/config.ts');

  test('сохранён en, устройство ru, отметки ручного выбора нет — предложить ru (не менять молча)', () => {
    assert.equal(localeOffer('en', null, 'ru'), 'ru');
  });
  test('ручной выбор 1.1.1 (отметка) — не предлагать', () => {
    assert.equal(localeOffer('en', '1', 'ru'), null);
  });
  test('совпадает с устройством или ничего не сохранено — не предлагать', () => {
    assert.equal(localeOffer('ru', null, 'ru'), null);
    assert.equal(localeOffer(null, null, 'ru'), null);
  });
  test('сохранён не en (дефект 1.0.x записывал только запасной en) — это выбор человека, не предлагать', () => {
    assert.equal(localeOffer('ru', null, 'en'), null, 'и при мгновенном en-US навигатора');
    assert.equal(localeOffer('de', null, 'ru'), null);
  });
});
