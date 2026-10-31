/**
 * «Проект»: гонки на настоящем сервере PostgreSQL с несколькими соединениями
 * (миграция 20261101000000_projects.sql). PGlite здесь не годится: у него одно
 * соединение.
 *
 * Запуск: npm run test:rls
 *
 * Что доказывается (§5 «Одновременная запись и закрытие»):
 *   1. Итог держит транзакцию — запись ждёт и после фиксации попадает в новый
 *      период, а не в закрытый мимо снимка.
 *   2. Запись держит транзакцию — итог ждёт и затем отклоняется «пока ты
 *      смотрел» (ревизия изменилась), операция остаётся в открытом периоде.
 *   3. Двойное «Зафиксировать» с одной ревизией закрывает ровно один период.
 *   4. Удаление аккаунта во время записи в проект: запись отклонена.
 * Порядок детерминирован, как в deleted-account-race.test.mjs: вторая сторона
 * запускается, пока первая держит транзакцию, коммит — когда вторая ждёт.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServerDatabase, becomeUser } from './pg-harness.mjs';

async function one(client, sql, params = []) {
  return (await client.query(sql, params)).rows[0];
}

function start(client, sql, params = []) {
  const p = { done: false };
  p.result = client.query(sql, params).then(
    (r) => ({ ok: true, rows: r.rows, error: null }),
    (e) => ({ ok: false, rows: [], error: e.message }),
  );
  p.result.finally(() => {
    p.done = true;
  });
  return p;
}

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

const ADD_OP = `SELECT public.add_operation(p_project_id => $1::uuid, p_op_type => 'income', p_amount => $2::bigint, p_member_id => $3::uuid) AS v`;
const CLOSE = `SELECT public.close_period($1::uuid, $2::bigint) AS v`;

/** Проект Ани с Борей; условия «поровну» на обоих, приняты. */
async function buildProject(srv) {
  const anya = randomUUID();
  const borya = randomUUID();
  await srv.admin.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES ($1, 'Аня', $3), ($2, 'Боря', $4)`,
    [anya, borya, `a-${anya}@example.com`, `b-${borya}@example.com`],
  );
  const c = await srv.connect();
  await becomeUser(c, anya);
  const pid = (await one(c, `SELECT public.create_project('Ярмарка', 'RUB', ARRAY[]::text[], '{"lines":[{"position":1}]}'::jsonb) AS v`)).v;
  const code = (await one(c, `SELECT public.create_project_invite($1) AS v`, [pid])).v;
  await becomeUser(c, borya);
  const mB = (await one(c, `SELECT public.join_project_by_invite($1) AS v`, [code])).v;
  const mA = (await one(srv.admin, `SELECT id FROM public.project_members WHERE project_id = $1 AND user_id = $2`, [pid, anya])).id;
  await becomeUser(c, anya);
  const terms = JSON.stringify({ remainder_method: 'equal', lines: [{ member_id: mA }, { member_id: mB }] });
  const tid = (await one(c, `SELECT public.propose_terms($1, $2::jsonb) AS v`, [pid, terms])).v;
  await becomeUser(c, borya);
  await c.query(`SELECT public.accept_terms($1)`, [tid]);
  await c.end();
  return { anya, borya, pid, mA, mB };
}

async function openPeriod(admin, pid) {
  return one(admin, `SELECT * FROM public.project_periods WHERE project_id = $1 AND status = 'open'`, [pid]);
}

describe('Проект: гонки итога и записи', () => {
  let srv;
  before(async () => {
    srv = await createServerDatabase();
  });
  after(async () => {
    await srv?.stop();
  });

  test('итог держит транзакцию → операция ждёт и попадает в новый период', async () => {
    const p = await buildProject(srv);
    const a = await srv.connect();
    const b = await srv.connect();
    await becomeUser(a, p.anya);
    const bPid = await becomeUser(b, p.borya);
    const before = await openPeriod(srv.admin, p.pid);

    await a.query('BEGIN');
    const snap = (await one(a, CLOSE, [p.pid, before.revision])).v;
    const pending = start(b, ADD_OP, [p.pid, 777, p.mB]);
    const state = await blockedOrDone(srv.admin, bPid, pending);
    await a.query('COMMIT');
    const res = await pending.result;
    assert.ok(res.ok, res.error);
    assert.equal(state, 'blocked', 'запись должна была ждать итог');

    const op = await one(
      srv.admin,
      `SELECT pp.seq, pp.status FROM public.project_operations o JOIN public.project_periods pp ON pp.id = o.period_id WHERE o.id = $1`,
      [res.rows[0].v],
    );
    assert.deepEqual([op.seq, op.status], [2, 'open'], 'операция в новом периоде');
    assert.equal(Number(snap.net_income), 0, 'в снимок закрытого периода она не вошла');
  });

  test('запись держит транзакцию → итог ждёт и отклоняется «пока ты смотрел»', async () => {
    const p = await buildProject(srv);
    const a = await srv.connect();
    const b = await srv.connect();
    const aPid = await becomeUser(a, p.anya);
    await becomeUser(b, p.borya);
    const before = await openPeriod(srv.admin, p.pid);

    await b.query('BEGIN');
    await b.query(ADD_OP, [p.pid, 555, p.mB]);
    const pending = start(a, CLOSE, [p.pid, before.revision]);
    const state = await blockedOrDone(srv.admin, aPid, pending);
    await b.query('COMMIT');
    const res = await pending.result;
    assert.equal(state, 'blocked', 'итог должен был ждать запись');
    assert.equal(res.ok, false);
    assert.match(res.error, /Пока ты смотрел/);
    assert.equal((await openPeriod(srv.admin, p.pid)).id, before.id, 'период не закрыт');
    const n = await one(srv.admin, `SELECT count(*)::int AS n FROM public.project_operations WHERE period_id = $1`, [before.id]);
    assert.equal(n.n, 1, 'операция в открытом периоде');
  });

  test('двойное «Зафиксировать» с одной ревизией закрывает ровно один период', async () => {
    const p = await buildProject(srv);
    const a1 = await srv.connect();
    const a2 = await srv.connect();
    await becomeUser(a1, p.anya);
    const a2Pid = await becomeUser(a2, p.anya);
    const rev = (await openPeriod(srv.admin, p.pid)).revision;

    await a1.query('BEGIN');
    await a1.query(CLOSE, [p.pid, rev]);
    const pending = start(a2, CLOSE, [p.pid, rev]);
    const state = await blockedOrDone(srv.admin, a2Pid, pending);
    await a1.query('COMMIT');
    const res = await pending.result;
    assert.equal(state, 'blocked');
    assert.equal(res.ok, false, 'второй итог прошёл');
    assert.match(res.error, /Пока ты смотрел/);
    const periods = (await srv.admin.query(`SELECT seq, status FROM public.project_periods WHERE project_id = $1 ORDER BY seq`, [p.pid])).rows;
    assert.deepEqual(periods, [{ seq: 1, status: 'closed' }, { seq: 2, status: 'open' }]);
  });

  test('удаление аккаунта во время записи в проект: запись отклонена', async () => {
    const p = await buildProject(srv);
    const a = await srv.connect();
    const b = await srv.connect();
    await becomeUser(a, p.borya);
    const bPid = await becomeUser(b, p.borya);

    await a.query('BEGIN');
    await a.query('SELECT public.delete_my_account()');
    const pending = start(b, ADD_OP, [p.pid, 999, p.mB]);
    const state = await blockedOrDone(srv.admin, bPid, pending);
    await a.query('COMMIT');
    const res = await pending.result;
    assert.equal(state, 'blocked', 'запись должна была ждать удаление');
    assert.equal(res.ok, false);
    assert.match(res.error, /Аккаунт удалён/);
    const n = await one(srv.admin, `SELECT count(*)::int AS n FROM public.project_operations WHERE project_id = $1`, [p.pid]);
    assert.equal(n.n, 0);
    const m = await one(srv.admin, `SELECT display_name FROM public.project_members WHERE id = $1`, [p.mB]);
    assert.equal(m.display_name, 'Удалённый пользователь');
  });
});
