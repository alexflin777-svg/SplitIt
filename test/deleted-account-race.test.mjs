/**
 * Гонка «удаление аккаунта ↔ запись от его имени» и безопасный откат
 * (миграция 20261022000000_block_deleted_accounts.sql) — на настоящем сервере
 * PostgreSQL с несколькими соединениями (PGlite здесь не годится: у него одно).
 *
 * Запуск: npm run test:rls
 *
 * Сценарий ревьюера R2: соединение A (Боб) выполняет delete_my_account() и ещё
 * не сделало COMMIT. Соединение B (тот же Боб, старый токен) пишет. Снимок B не
 * видит незакоммиченный реестр, поэтому без защиты проверка проходит, B ждёт
 * блокировку и после COMMIT A записывает данные удалённого — например,
 * возвращает имя и email в обезличенный профиль.
 *
 * Порядок детерминирован: B запускается, только когда A держит транзакцию
 * открытой, а COMMIT A выполняется, только когда B по pg_stat_activity
 * действительно ждёт блокировку (или уже закончил — тогда это видно в итоге).
 *
 * Сценарии B: UPDATE, INSERT, DELETE, UPSERT (INSERT … ON CONFLICT DO UPDATE)
 * и RPC. Отдельно — откат: удалённый не узнаёт членство, ни своё, ни чужое.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServerDatabase, becomeUser } from './pg-harness.mjs';

const DELETED_NAME = 'Удалённый пользователь';
const DOWN_SQL = path.join(process.cwd(), 'supabase', 'rollback', '20261022000000_block_deleted_accounts.down.sql');

async function one(client, sql, params = []) {
  return (await client.query(sql, params)).rows[0];
}

/** Запрос, который не ждут сразу: можно узнать, завершился ли он. */
function start(client, sql, params = []) {
  const p = { done: false };
  p.result = client.query(sql, params).then(
    (r) => ({ ok: true, rowCount: r.rowCount, rows: r.rows, error: null, code: null }),
    (e) => ({ ok: false, rowCount: 0, rows: [], error: e.message, code: e.code ?? null }),
  );
  p.result.finally(() => {
    p.done = true;
  });
  return p;
}

/** Ждёт, пока соединение pid встанет в очередь на блокировку или запрос закончится. */
async function blockedOrDone(admin, pid, pending, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pending.done) return 'done';
    const r = await one(admin, `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (r?.wait_event_type === 'Lock') return 'blocked';
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error(`соединение ${pid} не ждёт и не закончило за ${timeoutMs} мс`);
}

/**
 * Общее событие Алисы с Бобом; у Боба есть деньги, поэтому после удаления его
 * профиль и членство остаются (обезличенные) — ровно случай из ревью.
 * Отдельное личное событие Алисы — для проверки, что её не задерживает чужое удаление.
 */
async function buildEvent(admin) {
  const alice = randomUUID();
  const bob = randomUUID();
  await admin.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES ($1, 'Алиса', $3), ($2, 'Боб', $4)`,
    [alice, bob, `alice-${alice}@example.com`, `bob-${bob}@example.com`],
  );
  const group = (await one(admin, `INSERT INTO public.groups (name, created_by) VALUES ('Дача', $1) RETURNING id`, [alice])).id;
  const pids = {};
  for (const [uid, role, name] of [[alice, 'owner', 'Алиса'], [bob, 'member', 'Боб']]) {
    await admin.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, $3)`, [group, uid, role]);
    pids[uid] = (await one(
      admin,
      `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
       VALUES ($1, $2, $3, 'account', $2) RETURNING id`,
      [group, uid, name],
    )).id;
  }
  const e = await one(
    admin,
    `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
     VALUES ($1, $2, $3, 'Продукты', 1000, 1000) RETURNING id`,
    [group, bob, pids[bob]],
  );
  for (const uid of [alice, bob]) {
    await admin.query(
      `INSERT INTO public.expense_splits (expense_id, user_id, amount_owed, group_id, participant_id) VALUES ($1, $2, 500, $3, $4)`,
      [e.id, uid, group, pids[uid]],
    );
  }
  const own = (await one(admin, `INSERT INTO public.groups (name, created_by) VALUES ('Личное', $1) RETURNING id`, [alice])).id;
  await admin.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [own, alice]);
  const ownPid = (await one(
    admin,
    `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
     VALUES ($1, $2, 'Алиса', 'account', $2) RETURNING id`,
    [own, alice],
  )).id;
  return { alice, bob, group, pids, own, ownPid };
}

/**
 * A открывает транзакцию и выполняет delete_my_account() Боба без COMMIT;
 * B (второе соединение Боба) запускает sql; затем A коммитит.
 */
async function raceDuringDeletion(srv, ev, sql, params) {
  const a = await srv.connect();
  const b = await srv.connect();
  await becomeUser(a, ev.bob);
  const bPid = await becomeUser(b, ev.bob);

  await a.query('BEGIN');
  const del = (await one(a, 'SELECT public.delete_my_account() AS r')).r;
  assert.equal(del.status, 'deleted');
  assert.equal(del.anonymized, true, 'фикстура: у Боба деньги, профиль остаётся обезличенным');

  const pending = start(b, sql, params);
  const state = await blockedOrDone(srv.admin, bPid, pending);
  await a.query('COMMIT');
  const res = await pending.result;
  await a.end();
  await b.end();
  return { res, state };
}

async function profileOf(admin, uid) {
  return one(admin, `SELECT full_name, email FROM public.profiles WHERE id = $1`, [uid]);
}

describe('Гонка: запись удаляемого аккаунта во время delete_my_account', () => {
  let srv;

  before(async () => {
    srv = await createServerDatabase();
  });
  after(async () => {
    await srv?.stop();
  });

  test('UPDATE профиля не возвращает имя и email после обезличивания', async () => {
    const ev = await buildEvent(srv.admin);
    const { res, state } = await raceDuringDeletion(
      srv,
      ev,
      `UPDATE public.profiles SET full_name = 'Боб', email = 'bob@example.com' WHERE id = $1`,
      [ev.bob],
    );
    assert.deepEqual(await profileOf(srv.admin, ev.bob), { full_name: DELETED_NAME, email: null }, 'профиль восстановлен гонкой');
    assert.ok(!res.ok || res.rowCount === 0, `UPDATE затронул ${res.rowCount} строк`);
    assert.equal(state, 'blocked', 'B должен был ждать A — иначе сценарий не о гонке');
  });

  test('INSERT расхода не проходит после удаления', async () => {
    const ev = await buildEvent(srv.admin);
    const { res, state } = await raceDuringDeletion(
      srv,
      ev,
      `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, $3, 'Гонка', 100, 100)`,
      [ev.group, ev.bob, ev.pids[ev.bob]],
    );
    const n = await one(srv.admin, `SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1 AND title = 'Гонка'`, [ev.group]);
    assert.equal(n.n, 0, 'удалённый аккаунт добавил расход');
    assert.equal(res.ok, false);
    assert.equal(state, 'blocked', 'B должен был ждать A');
  });

  test('RPC add_expense_with_splits не проходит после удаления', async () => {
    const ev = await buildEvent(srv.admin);
    const splits = JSON.stringify([{ user_id: ev.bob, amount_owed: 50 }, { user_id: ev.alice, amount_owed: 50 }]);
    const { res, state } = await raceDuringDeletion(
      srv,
      ev,
      `SELECT public.add_expense_with_splits($1, 'Гонка RPC', 100, 'RUB', 100, 'food', $2, $3::jsonb, NOW())`,
      [ev.group, ev.bob, splits],
    );
    const n = await one(srv.admin, `SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1 AND title = 'Гонка RPC'`, [ev.group]);
    assert.equal(n.n, 0, 'удалённый аккаунт добавил расход через RPC');
    assert.equal(res.ok, false);
    assert.equal(res.code, '42501', res.error);
    assert.equal(state, 'blocked', 'B должен был ждать A');
  });

  test('RPC submit_feedback не оставляет отзыв с uid удалённого', async () => {
    const ev = await buildEvent(srv.admin);
    const { res, state } = await raceDuringDeletion(srv, ev, `SELECT public.submit_feedback('idea', 'Отзыв из гонки')`, []);
    const n = await one(srv.admin, `SELECT count(*)::int AS n FROM public.feedback WHERE user_id = $1`, [ev.bob]);
    assert.equal(n.n, 0, 'после удаления остался отзыв с uid удалённого');
    assert.equal(res.ok, false);
    assert.equal(res.code, '42501', res.error);
    assert.equal(state, 'blocked', 'B должен был ждать A');
  });

  test('DELETE своего членства не проходит после удаления', async () => {
    const ev = await buildEvent(srv.admin);
    // Боб — второй владелец: удаление понижает его роль и держит строку членства.
    await srv.admin.query(`UPDATE public.group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2`, [ev.group, ev.bob]);
    const { res, state } = await raceDuringDeletion(
      srv,
      ev,
      `DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2`,
      [ev.group, ev.bob],
    );
    const m = await one(srv.admin, `SELECT role FROM public.group_members WHERE group_id = $1 AND user_id = $2`, [ev.group, ev.bob]);
    assert.deepEqual(m, { role: 'member' }, 'удалённый аккаунт удалил членство, которое удаление оставило ради денег');
    assert.ok(!res.ok || res.rowCount === 0, `DELETE затронул ${res.rowCount} строк`);
    assert.equal(state, 'blocked', 'B должен был ждать A');
  });

  test('UPSERT профиля (INSERT … ON CONFLICT DO UPDATE) не возвращает имя и email', async () => {
    const ev = await buildEvent(srv.admin);
    const { res, state } = await raceDuringDeletion(
      srv,
      ev,
      `INSERT INTO public.profiles (id, full_name, email) VALUES ($1, 'Боб', 'bob@example.com')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email`,
      [ev.bob],
    );
    assert.deepEqual(await profileOf(srv.admin, ev.bob), { full_name: DELETED_NAME, email: null }, 'профиль восстановлен через UPSERT');
    assert.ok(!res.ok || res.rowCount === 0, `UPSERT затронул ${res.rowCount} строк`);
    assert.equal(state, 'blocked', 'B должен был ждать A');
  });

  test('пишущие SECURITY DEFINER RPC проверяют аккаунт первой строкой, до блокировок', async () => {
    const rows = (await srv.admin.query(`
      SELECT p.proname, p.prosrc
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname IN ('public', 'private')
        AND p.prorettype <> 'trigger'::regtype
        AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
        AND p.prosrc ~* '\\m(insert|update|delete)\\M'
      ORDER BY 1`)).rows;
    assert.deepEqual(
      rows.map((r) => r.proname),
      ['add_expense_with_splits', 'add_virtual_member', 'delete_my_account', 'join_waitlist', 'record_settlement',
        'redeem_group_invite', 'remove_guest', 'submit_feedback', 'update_expense_with_splits'],
      'список пишущих DEFINER RPC изменился — проверьте новую функцию',
    );
    for (const { proname, prosrc } of rows) {
      const body = prosrc.slice(prosrc.search(/\bBEGIN\b/i) + 'BEGIN'.length).trimStart();
      if (proname === 'delete_my_account') {
        // Удаление само берёт блокировку аккаунта эксклюзивно — до блокировок строк.
        const lock = body.indexOf('pg_advisory_xact_lock(');
        assert.ok(lock >= 0 && lock < body.indexOf('FOR UPDATE'), proname);
        continue;
      }
      assert.match(body, /^PERFORM private\.assert_account_active\(\);/, `${proname}: первой строкой не проверка аккаунта`);
    }
  });

  test('обратный порядок: запись начата раньше — удаление ждёт её и обезличивает итог', async () => {
    const ev = await buildEvent(srv.admin);
    const a = await srv.connect();
    const b = await srv.connect();
    const aPid = await becomeUser(a, ev.bob);
    await becomeUser(b, ev.bob);

    await b.query('BEGIN');
    const upd = await b.query(`UPDATE public.profiles SET full_name = 'Боб новый', email = 'new@example.com' WHERE id = $1`, [ev.bob]);
    assert.equal(upd.rowCount, 1, 'контроль: живой Боб меняет свой профиль');

    const pending = start(a, 'SELECT public.delete_my_account() AS r');
    assert.equal(await blockedOrDone(srv.admin, aPid, pending), 'blocked', 'удаление должно ждать открытую запись');
    await b.query('COMMIT');
    const del = await pending.result;
    assert.equal(del.ok, true, del.error ?? '');
    assert.equal(del.rows[0].r.status, 'deleted');
    assert.deepEqual(await profileOf(srv.admin, ev.bob), { full_name: DELETED_NAME, email: null });
    await a.end();
    await b.end();
  });

  test('живой пользователь не задерживается чужим удалением и пишет после него', async () => {
    const ev = await buildEvent(srv.admin);
    const a = await srv.connect();
    const c = await srv.connect();
    await becomeUser(a, ev.bob);
    const cPid = await becomeUser(c, ev.alice);

    await a.query('BEGIN');
    await a.query('SELECT public.delete_my_account()');

    // Личное событие Алисы удаление Боба не трогает — запись не ждёт.
    const ownWrite = start(
      c,
      `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, $3, 'Алиса сама', 100, 100)`,
      [ev.own, ev.alice, ev.ownPid],
    );
    assert.equal(await blockedOrDone(srv.admin, cPid, ownWrite), 'done', 'Алиса ждала удаления Боба в своём событии');
    const ownRes = await ownWrite.result;
    assert.equal(ownRes.ok, true, ownRes.error ?? '');

    // В общем событии Алиса может подождать блокировку строк события, но после COMMIT пишет.
    const sharedWrite = start(
      c,
      `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, $3, 'Алиса в общем', 100, 100)`,
      [ev.group, ev.alice, ev.pids[ev.alice]],
    );
    await blockedOrDone(srv.admin, cPid, sharedWrite);
    await a.query('COMMIT');
    const sharedRes = await sharedWrite.result;
    assert.equal(sharedRes.ok, true, sharedRes.error ?? '');
    await a.end();
    await c.end();
  });
});

describe('Откат: down.sql не возвращает доступ удалённым', () => {
  let srv;
  let ev;

  before(async () => {
    srv = await createServerDatabase();
    // Журнал миграций Supabase CLI: в проекте он есть, а откаты его трогают.
    await srv.admin.query(`
      CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261022000000');
    `);
    ev = await buildEvent(srv.admin);
    const bob = await srv.connect();
    await becomeUser(bob, ev.bob);
    assert.equal((await one(bob, 'SELECT public.delete_my_account() AS r')).r.status, 'deleted');
    await bob.end();
    await srv.admin.query(readFileSync(DOWN_SQL, 'utf-8'));
  });
  after(async () => {
    await srv?.stop();
  });

  test('реестр, политики и триггеры на месте', async () => {
    const tables = (await srv.admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity ORDER BY 1`,
    )).rows.map((r) => r.relname);
    assert.ok(tables.length >= 10);
    const pol = (await srv.admin.query(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'deny_deleted_account' ORDER BY 1`,
    )).rows.map((r) => r.tablename);
    assert.deepEqual(pol, tables);
    const trg = (await srv.admin.query(
      `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = 'deny_deleted_account_write' AND NOT t.tgisinternal ORDER BY 1`,
    )).rows.map((r) => r.relname);
    assert.deepEqual(trg, tables);
    const reg = await one(srv.admin, `SELECT count(*)::int AS n FROM private.deleted_accounts WHERE user_id = $1`, [ev.bob]);
    assert.equal(reg.n, 1);
    const mig = await one(srv.admin, `SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations WHERE version = '20261022000000'`);
    assert.equal(mig.n, 1, 'миграция по сути применена — запись о ней остаётся');
  });

  test('удалённый Боб по-прежнему без доступа', async () => {
    const bob = await srv.connect();
    await becomeUser(bob, ev.bob);
    for (const t of ['groups', 'group_members', 'group_participants', 'expenses', 'expense_splits', 'profiles']) {
      const r = await bob.query(`SELECT count(*)::int AS n FROM public.${t}`);
      assert.equal(r.rows[0].n, 0, `${t}: Боб видит строки после отката`);
    }
    const upd = await bob.query(`UPDATE public.profiles SET full_name = 'Боб' WHERE id = $1`, [ev.bob]);
    assert.equal(upd.rowCount, 0);
    await assert.rejects(
      bob.query(
        `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
         VALUES ($1, $2, $3, 'После отката', 100, 100)`,
        [ev.group, ev.bob, ev.pids[ev.bob]],
      ),
    );
    const splits = JSON.stringify([{ user_id: ev.alice, amount_owed: 100 }]);
    await assert.rejects(
      bob.query(`SELECT public.add_expense_with_splits($1, 'x', 100, 'RUB', 100, 'food', $2, $3::jsonb, NOW())`, [ev.group, ev.alice, splits]),
      /Аккаунт удалён/,
    );
    await assert.rejects(bob.query(`SELECT public.submit_feedback('idea', 'после отката')`), /Аккаунт удалён/);
    await bob.end();
    assert.deepEqual(await profileOf(srv.admin, ev.bob), { full_name: DELETED_NAME, email: null });
  });

  test('удалённый Боб не узнаёт членство — ни своё, ни чужое', async () => {
    const bob = await srv.connect();
    await becomeUser(bob, ev.bob);
    for (const [sql, params] of [
      ['SELECT public.shares_group_with($1) AS v', [ev.alice]],
      ['SELECT private.shares_group_with($1) AS v', [ev.alice]],
      ['SELECT public.is_group_member($1) AS v', [ev.group]],
      ['SELECT private.is_group_member($1) AS v', [ev.group]],
      ['SELECT public.is_group_owner($1) AS v', [ev.group]],
      ['SELECT private.is_group_owner($1) AS v', [ev.group]],
    ]) {
      const answer = await bob.query(sql, params).then((r) => `ответ ${r.rows[0].v}`, (e) => e.message);
      assert.match(answer, /Аккаунт удалён/, `${sql}: ${answer}`);
    }
    await bob.end();

    const alice = await srv.connect();
    await becomeUser(alice, ev.alice);
    assert.equal((await one(alice, 'SELECT public.shares_group_with($1) AS v', [ev.bob])).v, true, 'живая Алиса');
    await alice.end();
  });

  test('гонка закрыта и после отката', async () => {
    const ev2 = await buildEvent(srv.admin);
    const { res, state } = await raceDuringDeletion(
      srv,
      ev2,
      `UPDATE public.profiles SET full_name = 'Боб', email = 'bob@example.com' WHERE id = $1`,
      [ev2.bob],
    );
    assert.deepEqual(await profileOf(srv.admin, ev2.bob), { full_name: DELETED_NAME, email: null });
    assert.ok(!res.ok || res.rowCount === 0);
    assert.equal(state, 'blocked');
  });

  test('живые пользователи работают: чтение, запись, RPC, удаление аккаунта', async () => {
    const alice = await srv.connect();
    await becomeUser(alice, ev.alice);
    const seen = await alice.query(`SELECT id FROM public.expenses WHERE group_id = $1`, [ev.group]);
    assert.equal(seen.rowCount, 1);
    const ins = await alice.query(
      `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, $3, 'Алиса после отката', 100, 100) RETURNING id`,
      [ev.group, ev.alice, ev.pids[ev.alice]],
    );
    assert.equal(ins.rowCount, 1);
    const rpc = await alice.query(
      `SELECT public.add_expense_with_splits($1, 'RPC Алисы', 200, 'RUB', 200, 'food', $2, $3::jsonb, NOW()) AS id`,
      [ev.group, ev.alice, JSON.stringify([{ user_id: ev.alice, amount_owed: 200 }])],
    );
    assert.ok(rpc.rows[0].id);
    assert.equal((await one(alice, `SELECT public.is_group_member($1) AS v`, [ev.group])).v, true);
    // Чтение в READ ONLY-транзакции (так PostgREST выполняет GET).
    await alice.query('BEGIN READ ONLY');
    assert.equal((await alice.query(`SELECT id FROM public.groups`)).rowCount, 2);
    await alice.query('COMMIT');
    const del = (await one(alice, 'SELECT public.delete_my_account() AS r')).r;
    assert.equal(del.status, 'deleted');
    await alice.end();
  });
});
