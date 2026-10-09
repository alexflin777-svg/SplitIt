// G2 (P1-15): балансы и итоги считались только по первым 50 расходам.
// Часть 1 — fetchAllPages в изоляции. Часть 2 — сетевой адаптер: настоящий
// supabase-js ходит в подменённый fetch, который честно соблюдает offset/limit
// и порядок, как PostgREST. Модуль supabase создаётся один раз на процесс,
// поэтому это отдельный файл.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const { fetchAllPages } = await import('../src/lib/paging.ts');
const { computeEventSummary } = await import('../src/lib/event-summary.ts');

// ---------------------------------------------------------------------------
// fetchAllPages
// ---------------------------------------------------------------------------

const items = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `i${from + i}` }));

// Источник из массива: честно отдаёт срез и hasMore.
const sourceOf = (all, log = []) => async (offset, limit) => {
  log.push([offset, limit]);
  return { data: { items: all.slice(offset, offset + limit), hasMore: offset + limit < all.length }, error: null };
};

test('fetchAllPages: 250 элементов страницами по 100 приходят все и по порядку', async () => {
  const all = items(250);
  const log = [];
  const res = await fetchAllPages(sourceOf(all, log));
  assert.equal(res.error, null);
  assert.deepEqual(res.data.map((x) => x.id), all.map((x) => x.id));
  assert.deepEqual(log, [[0, 100], [100, 100], [200, 100]]);
});

test('fetchAllPages: пустой источник даёт пустой список без ошибки', async () => {
  const res = await fetchAllPages(sourceOf([]));
  assert.deepEqual(res, { data: [], error: null });
});

test('fetchAllPages: дубль на стыке страниц отбрасывается', async () => {
  const pages = [
    { items: items(100), hasMore: true },
    // новый расход сдвинул смещение: последний элемент первой страницы пришёл снова
    { items: [{ id: 'i99' }, ...items(50, 100)], hasMore: false },
  ];
  let n = 0;
  const res = await fetchAllPages(async () => ({ data: pages[n++], error: null }));
  assert.equal(res.error, null);
  assert.equal(res.data.length, 150);
  assert.equal(new Set(res.data.map((x) => x.id)).size, 150);
});

test('fetchAllPages: ошибка любой страницы — ошибка целиком, без частичных данных', async () => {
  let n = 0;
  const res = await fetchAllPages(async (offset, limit) => {
    n++;
    if (n === 2) return { data: null, error: 'сеть пропала' };
    return { data: { items: items(limit, offset), hasMore: true }, error: null };
  });
  assert.deepEqual(res, { data: null, error: 'сеть пропала' });
});

test('fetchAllPages: пустая страница при hasMore=true останавливает цикл', async () => {
  let calls = 0;
  const res = await fetchAllPages(async () => {
    calls++;
    return { data: { items: [], hasMore: true }, error: null };
  });
  assert.equal(calls, 1, 'бесконечный цикл на пустой странице');
  assert.deepEqual(res, { data: [], error: null });
});

test('fetchAllPages: превышение maxItems — overflow, а не усечённый список', async () => {
  const all = items(1000);
  const res = await fetchAllPages(sourceOf(all), { pageSize: 10, maxItems: 25 });
  assert.equal(res.overflow, true);
  assert.equal(res.data, null);
  assert.equal(res.error, null);
});

test('fetchAllPages: уважает pageSize', async () => {
  const log = [];
  const res = await fetchAllPages(sourceOf(items(25), log), { pageSize: 10 });
  assert.equal(res.data.length, 25);
  assert.deepEqual(log.map(([, l]) => l), [10, 10, 10]);
});

// ---------------------------------------------------------------------------
// Сетевой адаптер
// ---------------------------------------------------------------------------

const ME = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP = '99999999-9999-4999-8999-999999999999';
const GROUP_2 = '88888888-8888-4888-8888-888888888888';
const realFetch = globalThis.fetch;

let calls = [];
let handlers = {};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const user = { id: ME, aud: 'authenticated', email: 'me@example.com', user_metadata: { full_name: 'Я' }, app_metadata: {} };

let remote;
before(async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, search: url.search, method: init.method ?? 'GET', body });
    if (url.pathname === '/auth/v1/token') {
      const now = Math.floor(Date.now() / 1000);
      return json({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user });
    }
    if (url.pathname === '/auth/v1/user') return json(user);
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (url.pathname.startsWith(prefix)) return handler({ url, body });
    }
    return json([]);
  };
  remote = await import('../src/lib/remote-store.ts');
  const { signInUser } = await import('../src/lib/supabase.ts');
  const res = await signInUser('me@example.com', 'whatever');
  assert.equal(res.error, null, res.error ?? '');
});

after(() => {
  globalThis.fetch = realFetch;
});

const expenseCalls = () => calls.filter((c) => c.path === '/rest/v1/expenses');

const groupRow = (id = GROUP) => ({
  id,
  name: 'Поездка',
  category: 'trip',
  default_currency: 'RUB',
  status: 'active',
  created_by: ME,
  created_at: '2026-10-09T10:00:00Z',
  group_members: [
    { user_id: ME, role: 'owner', profiles: { id: ME, full_name: 'Я', avatar_url: '👤' } },
    { user_id: BOB, role: 'member', profiles: { id: BOB, full_name: 'Боб', avatar_url: '👤' } },
  ],
  group_participants: [{ id: GUEST, display_name: 'Петя', kind: 'guest', profile_id: null, created_by: ME }],
  settlements: [],
});

// 120 расходов с разными плательщиками, неравными долями и суммами. Всё в копейках.
const PEOPLE = [ME, BOB, GUEST];
function seedExpenses(groupId = GROUP, count = 120) {
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const cents = 1000 + ((i * 7919) % 90000) + (i % 100); // разные суммы с копейками
    const payer = PEOPLE[i % 3];
    // неравные доли: первая 1/2 (с округлением вниз), вторая 1/3, остаток — третьей
    const a = Math.floor(cents / 2);
    const b = Math.floor(cents / 3);
    const shares = [a, b, cents - a - b];
    const order = [PEOPLE[(i + 1) % 3], PEOPLE[(i + 2) % 3], PEOPLE[i % 3]];
    // №1 — самый старый, №count — самый новый; каждые 10 расходов делят created_at,
    // чтобы порядок решал второй ключ (id)
    const ts = new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + Math.floor(i / 10) * 60_000).toISOString();
    rows.push({
      id: `${groupId.slice(0, 2)}-e${String(i).padStart(3, '0')}`,
      group_id: groupId,
      title: `Расход ${i}`,
      amount: cents / 100,
      currency: 'RUB',
      amount_in_group_currency: cents / 100,
      category: 'food',
      paid_by_id: payer === GUEST ? null : payer,
      paid_by_participant_id: payer === GUEST ? GUEST : null,
      created_at: ts,
      split_mode: 'exact',
      expense_splits: order.map((p, k) => ({
        user_id: p === GUEST ? null : p,
        participant_id: p === GUEST ? GUEST : 'acc-' + p,
        amount_owed: shares[k] / 100,
      })),
      _cents: cents,
      _payer: payer,
      _shares: order.map((p, k) => [p, shares[k]]),
    });
  }
  return rows;
}

// Имитация PostgREST: фильтр group_id, order created_at desc + id desc, offset/limit.
function expensesHandler(rows, { failFromOffset = null } = {}) {
  return ({ url }) => {
    const gid = (url.searchParams.get('group_id') ?? '').replace(/^eq\./, '');
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? rows.length);
    assert.equal(url.searchParams.get('order'), 'created_at.desc,id.desc', 'порядок страниц не детерминирован');
    if (failFromOffset !== null && offset >= failFromOffset) {
      return json({ message: 'boom', code: 'XX000' }, 500);
    }
    const sorted = rows
      .filter((r) => !gid || r.group_id === gid)
      .sort((x, y) => (x.created_at === y.created_at ? (x.id < y.id ? 1 : -1) : x.created_at < y.created_at ? 1 : -1));
    return json(sorted.slice(offset, offset + limit).map(({ _cents, _payer, _shares, group_id, ...row }) => row));
  };
}

beforeEach(() => {
  calls = [];
  handlers = { '/rest/v1/profiles': () => json(null) };
});

test('fetchGroup: все 120 расходов загружены, итог и балансы сходятся с эталоном по seed', async () => {
  const rows = seedExpenses();
  handlers['/rest/v1/groups'] = () => json(groupRow());
  handlers['/rest/v1/expenses'] = expensesHandler(rows);

  const { data, error } = await remote.fetchGroup(GROUP);
  assert.equal(error, null);
  assert.equal(data.expenses.length, 120);
  assert.equal(new Set(data.expenses.map((e) => e.id)).size, 120, 'дубли в списке');
  assert.ok(expenseCalls().length >= 2, 'расходы запрошены одной страницей');
  assert.ok(data.expenses.some((e) => e.id === rows[0].id), 'самый старый расход №1 потерян');
  assert.ok(data.expenses.some((e) => e.id === rows[119].id), 'расход №120 потерян');
  assert.ok(data.expenses.some((e) => e.title === 'Расход 1'), 'старый расход не найдётся на странице правки');

  // Эталон считаем прямо из seed, в копейках.
  const refTotal = rows.reduce((s, r) => s + r._cents, 0);
  const ref = { [ME]: 0, [BOB]: 0, [GUEST]: 0 };
  for (const r of rows) {
    ref[r._payer] += r._cents;
    for (const [p, c] of r._shares) ref[p] -= c;
  }

  const summary = computeEventSummary(data);
  assert.equal(Math.round(summary.total * 100), refTotal);
  let sum = 0;
  for (const id of PEOPLE) {
    const net = Math.round(summary.balances[id].netAmount * 100);
    assert.equal(net, ref[id], `баланс ${id}`);
    sum += net;
  }
  assert.equal(sum, 0, 'сумма балансов не ноль');
});

test('fetchGroup: страницы запрашиваются с offset/limit и не пересекаются', async () => {
  const rows = seedExpenses();
  handlers['/rest/v1/groups'] = () => json(groupRow());
  handlers['/rest/v1/expenses'] = expensesHandler(rows);

  await remote.fetchGroup(GROUP);
  const offsets = expenseCalls().map((c) => Number(new URL('http://x' + c.search).searchParams.get('offset')));
  assert.deepEqual(offsets, [0, 100]);
});

test('fetchGroup: вторая страница отвечает 500 — ошибка и data=null, без частичных денег', async () => {
  const rows = seedExpenses();
  handlers['/rest/v1/groups'] = () => json(groupRow());
  handlers['/rest/v1/expenses'] = expensesHandler(rows, { failFromOffset: 100 });

  const res = await remote.fetchGroup(GROUP);
  assert.equal(res.data, null);
  assert.ok(res.error, 'ошибка замаскирована под успех');
});

test('fetchGroups: событие со 120 расходами приходит со всеми расходами', async () => {
  const rows = [...seedExpenses(GROUP, 120), ...seedExpenses(GROUP_2, 3)];
  handlers['/rest/v1/groups'] = () => json([groupRow(GROUP), groupRow(GROUP_2)]);
  handlers['/rest/v1/expenses'] = expensesHandler(rows);

  const { data, error } = await remote.fetchGroups();
  assert.equal(error, null);
  assert.equal(data.find((g) => g.id === GROUP).expenses.length, 120);
  assert.equal(data.find((g) => g.id === GROUP_2).expenses.length, 3);
});

test('fetchGroups: сбой расходов одного события — ошибка всего списка', async () => {
  const rows = seedExpenses(GROUP, 120);
  handlers['/rest/v1/groups'] = () => json([groupRow(GROUP)]);
  handlers['/rest/v1/expenses'] = expensesHandler(rows, { failFromOffset: 100 });

  const res = await remote.fetchGroups();
  assert.equal(res.data, null);
  assert.ok(res.error);
});
