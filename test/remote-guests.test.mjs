// F5, клиентская сторона сетевого режима: гости в расходах, создание события
// с гостями и переводы с гостем. Сеть не используется: настоящий supabase-js
// ходит в подменённый fetch с фиктивным адресом (E2E собираются без Supabase).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const ME = '11111111-1111-4111-8111-111111111111';
const GROUP = '99999999-9999-4999-8999-999999999999';
const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const realFetch = globalThis.fetch;

let calls = [];
let handlers = {};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const user = { id: ME, aud: 'authenticated', email: 'me@example.com', user_metadata: { full_name: 'Я' }, app_metadata: {} };

let remote;
let store;
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
  store = await import('../src/lib/store.ts');
  const { signInUser } = await import('../src/lib/supabase.ts');
  const res = await signInUser('me@example.com', 'whatever');
  assert.equal(res.error, null, res.error ?? '');
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  handlers = {
    '/rest/v1/profiles': () => json(null),
  };
});

const groupRow = (guests = []) => ({
  id: GROUP,
  name: 'Дача',
  category: 'trip',
  default_currency: 'RUB',
  status: 'active',
  created_by: ME,
  created_at: '2026-10-09T10:00:00Z',
  group_members: [{ user_id: ME, role: 'owner', profiles: { id: ME, full_name: 'Я', avatar_url: '👤' } }],
  group_participants: guests.map(([id, name]) => ({ id, display_name: name, kind: 'guest', profile_id: null, created_by: ME })),
  settlements: [],
});

test('доля и плательщик-гость читаются по participant_id и совпадают с id гостя в members', async () => {
  handlers['/rest/v1/expenses'] = ({ url }) => {
    assert.match(decodeURIComponent(url.search), /paid_by_participant_id/);
    assert.match(decodeURIComponent(url.search), /participant_id/);
    return json([
      {
        id: 'e1', title: 'Ужин', amount: 1000, currency: 'RUB', amount_in_group_currency: 1000, category: 'food',
        paid_by_id: null, paid_by_participant_id: GUEST, created_at: '2026-10-09T12:00:00Z',
        expense_splits: [
          { user_id: ME, participant_id: 'acc-participant', amount_owed: 400 },
          { user_id: null, participant_id: GUEST, amount_owed: 600 },
        ],
      },
    ]);
  };
  handlers['/rest/v1/groups'] = () => json(groupRow([[GUEST, 'Петя']]));

  const { data, error } = await remote.fetchGroup(GROUP);
  assert.equal(error, null);
  const [expense] = data.expenses;
  assert.equal(expense.paidById, GUEST);
  assert.deepEqual(expense.splits.map((s) => s.userId), [ME, GUEST]);
  const memberIds = new Set(data.members.map((m) => m.id));
  assert.ok(memberIds.has(expense.paidById), 'плательщик-гость не найден среди участников');
  for (const s of expense.splits) assert.ok(memberIds.has(s.userId), `доля ${s.userId} без участника`);
});

test('createGroup в сетевом режиме добавляет введённые имена гостями (кроме себя)', async () => {
  const added = [];
  handlers['/rest/v1/rpc/create_group_with_owner'] = () => json(GROUP);
  handlers['/rest/v1/rpc/add_virtual_member'] = ({ body }) => {
    added.push(body.p_member_name);
    return json({ id: `g-${added.length}`, name: body.p_member_name, avatar: '👤', role: 'member' });
  };
  handlers['/rest/v1/groups'] = () => json(groupRow([['g-1', 'Петя'], ['g-2', 'Маша']]));
  handlers['/rest/v1/expenses'] = () => json([]);

  const res = await store.createGroup({ name: 'Дача', category: 'trip', currency: 'RUB', memberNames: ['Вы', 'Петя', ' Маша ', 'Петя', ''] });
  assert.equal(res.error, null);
  assert.deepEqual(added, ['Петя', 'Маша']);
  assert.deepEqual(res.data.members.map((m) => m.name), ['Я', 'Петя', 'Маша']);
});

test('если гость не добавился — событие возвращается вместе с ошибкой, где названо имя', async () => {
  handlers['/rest/v1/rpc/create_group_with_owner'] = () => json(GROUP);
  handlers['/rest/v1/rpc/add_virtual_member'] = ({ body }) =>
    body.p_member_name === 'Маша'
      ? json({ message: 'Имя участника должно быть от 1 до 80 символов.', code: '22023' }, 400)
      : json({ id: 'g-1', name: body.p_member_name, avatar: '👤', role: 'member' });
  handlers['/rest/v1/groups'] = () => json(groupRow([['g-1', 'Петя']]));
  handlers['/rest/v1/expenses'] = () => json([]);

  const res = await store.createGroup({ name: 'Дача', category: 'trip', currency: 'RUB', memberNames: ['Вы', 'Петя', 'Маша'] });
  assert.equal(res.data?.id, GROUP, 'созданное событие потеряно — экран предложит создать дубль');
  assert.match(res.error ?? '', /Маша/);
  assert.doesNotMatch(res.error ?? '', /Петя/);
});

test('перевод с гостем не уходит в базу и даёт понятную ошибку', async () => {
  handlers['/rest/v1/group_participants'] = () => json([{ id: GUEST }]);
  const res = await remote.addSettlement(GROUP, { fromUserId: ME, toUserId: GUEST, amount: 100, currency: 'RUB', paymentMethod: 'cash' });
  assert.ok(res.error, 'ошибки нет');
  assert.match(res.error, /гост|guest/i);
  assert.equal(calls.filter((c) => c.path === '/rest/v1/settlements').length, 0, 'запись перевода всё равно отправлена');
});

test('отказ RLS при переводе за другого объясняется, а не показывается сырым кодом', async () => {
  handlers['/rest/v1/group_participants'] = () => json([]);
  handlers['/rest/v1/settlements'] = () =>
    json({ message: 'new row violates row-level security policy for table "settlements"', code: '42501' }, 403);
  const other = '22222222-2222-4222-8222-222222222222';
  const res = await remote.addSettlement(GROUP, { fromUserId: other, toUserId: ME, amount: 100, currency: 'RUB', paymentMethod: 'cash' });
  assert.ok(res.error);
  assert.doesNotMatch(res.error, /row-level security/);
});
