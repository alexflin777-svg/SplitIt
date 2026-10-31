/**
 * Приглашения событий (миграция 20261101000100_event_invites.sql).
 *
 * Запуск: npm run test:rls
 *
 * Что доказывается:
 *   1. preview_group_invite без входа: название, имя пригласившего, число
 *      участников, действует ли и до какого момента — ни сумм, ни списка.
 *   2. Удалённый аккаунт preview не вызывает; неизвестный код — отказ.
 *   3. Срок считает база: клиентский expires_at (клиент 1.0.x, «+14 дней»)
 *      перезаписывается, вставка не падает; пока событие открыто — бессрочно.
 *   4. Закрытие события → срок completed_at + 30 дней; через 30 дней ссылка не
 *      впускает; повторное открытие → снова бессрочно и впускает.
 *   5. Отключённая (удалённая владельцем) ссылка не впускает.
 *   6. Клиент не меняет срок напрямую.
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestDatabase, asUser } from './pg-harness.mjs';

const ANYA = 'a1000000-0000-4000-8000-000000000001'; // владелец события
const BORYA = 'b1000000-0000-4000-8000-000000000002'; // участник
const VIKA = 'c1000000-0000-4000-8000-000000000003'; // входит по ссылке
const GENA = 'd1000000-0000-4000-8000-000000000004'; // удаляет аккаунт
const DAY = 86_400_000;

async function run(db, sql, params = []) {
  try {
    const res = await db.query(sql, params);
    return { ok: true, rows: res.rows, affected: res.affectedRows ?? 0, error: null };
  } catch (e) {
    return { ok: false, rows: [], affected: 0, error: e.message };
  }
}

async function asAnon(db, fn) {
  await db.exec('SET ROLE anon;');
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
  }
}

const as = (db, uid, sql, params = []) => asUser(db, uid, () => run(db, sql, params));
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const PREVIEW = `SELECT public.preview_group_invite($1) AS v`;
const REDEEM = `SELECT public.redeem_group_invite($1) AS v`;

/** Событие Ани: Аня (owner), Боря, гость Саша; расход 12 345,67 ₽; ссылка, созданная «клиентом 1.0.x». */
async function scenario() {
  const db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Аня', 'anya@example.com'), ($2, 'Боря', 'b@example.com'), ($3, 'Вика', 'v@example.com'), ($4, 'Гена', 'g@example.com')`,
    [ANYA, BORYA, VIKA, GENA],
  );
  const g = await one(db, `INSERT INTO public.groups (name, created_by) VALUES ('Поездка в Казань', $1) RETURNING id`, [ANYA]);
  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
    [g.id, ANYA, BORYA],
  );
  const pa = await one(
    db,
    `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
     VALUES ($1, $2, 'Аня', 'account', $2) RETURNING id`,
    [g.id, ANYA],
  );
  await db.query(
    `INSERT INTO public.group_participants (group_id, display_name, kind, created_by) VALUES ($1, 'Саша', 'guest', $2)`,
    [g.id, ANYA],
  );
  await db.query(
    `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
     VALUES ($1, $2, $3, 'Отель', 12345.67, 12345.67)`,
    [g.id, ANYA, pa.id],
  );
  // Так вставляет ссылку клиент 1.0.x (remote-store.createInvite): со своим сроком 14 дней.
  const ins = await as(
    db,
    ANYA,
    `INSERT INTO public.group_invites (group_id, invite_code, created_by, expires_at)
     VALUES ($1, 'KZN7Q2CODE01', $2, now() + interval '14 days')`,
    [g.id, ANYA],
  );
  assert.ok(ins.ok, `вставка ссылки клиентом 1.0.x: ${ins.error}`);
  return { db, gid: g.id, code: 'KZN7Q2CODE01' };
}

const expiresAt = async (db, code) => (await one(db, `SELECT expires_at FROM public.group_invites WHERE invite_code = $1`, [code]))?.expires_at ?? null;
const setStatus = (db, gid, status) => as(db, ANYA, `UPDATE public.groups SET status = $2 WHERE id = $1`, [gid, status]);

/** «Прошло n дней после закрытия»: сдвигаем completed_at мимо триггера-штампа (он не даёт менять метку). */
async function closedDaysAgo(db, gid, days) {
  await db.exec('ALTER TABLE public.groups DISABLE TRIGGER groups_stamp_completion;');
  try {
    await db.query(`UPDATE public.groups SET completed_at = now() - make_interval(days => $2) WHERE id = $1`, [gid, days]);
  } finally {
    await db.exec('ALTER TABLE public.groups ENABLE TRIGGER groups_stamp_completion;');
  }
}

describe('preview_group_invite', () => {
  let s;
  before(async () => {
    s = await scenario();
  });

  test('без входа: только название, имя, число участников, действует ли, срок — без сумм и списка', async () => {
    const r = await asAnon(s.db, () => run(s.db, PREVIEW, [s.code]));
    assert.ok(r.ok, r.error);
    const v = r.rows[0].v;
    assert.deepEqual(Object.keys(v).sort(), ['event_name', 'expires_at', 'inviter_name', 'is_active', 'member_count']);
    assert.deepEqual(v, { event_name: 'Поездка в Казань', inviter_name: 'Аня', member_count: 3, is_active: true, expires_at: null });
    const raw = JSON.stringify(v);
    assert.ok(!raw.includes('12345') && !raw.includes('Отель'), 'в превью нет сумм и расходов');
    assert.ok(!raw.includes('Боря') && !raw.includes('Саша'), 'в превью нет списка участников');
  });

  test('с входом — то же самое; неизвестный код — отказ', async () => {
    const r = await as(s.db, VIKA, PREVIEW, [s.code]);
    assert.ok(r.ok, r.error);
    assert.equal(r.rows[0].v.event_name, 'Поездка в Казань');
    const bad = await asAnon(s.db, () => run(s.db, PREVIEW, ['NOPE-NOPE']));
    assert.equal(bad.ok, false);
    assert.match(bad.error, /недействительно/);
  });

  test('удалённый аккаунт не вызывает preview', async () => {
    const ctrl = await as(s.db, GENA, PREVIEW, [s.code]);
    assert.ok(ctrl.ok, `контроль до удаления: ${ctrl.error}`);
    const del = await as(s.db, GENA, `SELECT public.delete_my_account() AS v`);
    assert.ok(del.ok, del.error);
    const r = await as(s.db, GENA, PREVIEW, [s.code]);
    assert.equal(r.ok, false, 'удалённый вызвал preview');
    assert.match(r.error, /Аккаунт удалён/);
  });

  test('права: anon и authenticated исполняют обёртку, private-реализацию — никто', async () => {
    const p = await one(
      s.db,
      `SELECT has_function_privilege('anon', 'public.preview_group_invite(text)', 'EXECUTE') AS anon_pub,
              has_function_privilege('authenticated', 'public.preview_group_invite(text)', 'EXECUTE') AS auth_pub,
              has_function_privilege('anon', 'private.preview_group_invite(text)', 'EXECUTE') AS anon_priv,
              has_function_privilege('authenticated', 'private.preview_group_invite(text)', 'EXECUTE') AS auth_priv`,
    );
    assert.deepEqual(p, { anon_pub: true, auth_pub: true, anon_priv: false, auth_priv: false });
  });
});

describe('срок ссылки события считает база', () => {
  let s;
  before(async () => {
    s = await scenario();
  });

  test('клиентский срок 1.0.x перезаписан: пока событие открыто — бессрочно', async () => {
    assert.equal(await expiresAt(s.db, s.code), null);
  });

  test('клиент не меняет срок напрямую', async () => {
    const r = await as(s.db, ANYA, `UPDATE public.group_invites SET expires_at = now() + interval '999 days' WHERE invite_code = $1`, [s.code]);
    assert.ok(!r.ok || r.affected === 0, 'UPDATE срока прошёл');
    assert.equal(await expiresAt(s.db, s.code), null);
  });

  test('закрытие события → срок = закрытие + 30 дней, ссылка впускает', async () => {
    const r = await setStatus(s.db, s.gid, 'completed');
    assert.ok(r.ok, r.error);
    const { completed_at } = await one(s.db, `SELECT completed_at FROM public.groups WHERE id = $1`, [s.gid]);
    const exp = await expiresAt(s.db, s.code);
    assert.ok(exp, 'после закрытия срок появился');
    assert.equal(exp.getTime() - completed_at.getTime(), 30 * DAY);
    const pv = await asAnon(s.db, () => run(s.db, PREVIEW, [s.code]));
    assert.equal(pv.rows[0].v.is_active, true);
    assert.ok(pv.rows[0].v.expires_at, 'превью отдаёт дату');
    const join = await as(s.db, VIKA, REDEEM, [s.code]);
    assert.ok(join.ok, `в течение 30 дней ссылка впускает: ${join.error}`);
    assert.equal(join.rows[0].v, s.gid);
  });

  test('через 30 дней после закрытия ссылка не впускает', async () => {
    await closedDaysAgo(s.db, s.gid, 31);
    const exp = await expiresAt(s.db, s.code);
    assert.ok(exp.getTime() < Date.now(), 'срок пересчитан от сдвинутого закрытия');
    const pv = await asAnon(s.db, () => run(s.db, PREVIEW, [s.code]));
    assert.equal(pv.rows[0].v.is_active, false);
    await s.db.query(`DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2`, [s.gid, VIKA]);
    const join = await as(s.db, VIKA, REDEEM, [s.code]);
    assert.equal(join.ok, false, 'просроченная ссылка впустила');
    assert.match(join.error, /недействительно или истекло/);
  });

  test('повторное открытие события → снова «пока открыто», ссылка впускает', async () => {
    const r = await setStatus(s.db, s.gid, 'active');
    assert.ok(r.ok, r.error);
    assert.equal(await expiresAt(s.db, s.code), null);
    const join = await as(s.db, VIKA, REDEEM, [s.code]);
    assert.ok(join.ok, join.error);
  });

  test('ссылка, созданная в закрытом событии, получает срок закрытия + 30 дней', async () => {
    await setStatus(s.db, s.gid, 'completed');
    const ins = await as(
      s.db,
      ANYA,
      `INSERT INTO public.group_invites (group_id, invite_code, created_by, expires_at) VALUES ($1, 'LATECODE0001', $2, NULL)`,
      [s.gid, ANYA],
    );
    assert.ok(ins.ok, ins.error);
    const { completed_at } = await one(s.db, `SELECT completed_at FROM public.groups WHERE id = $1`, [s.gid]);
    assert.equal((await expiresAt(s.db, 'LATECODE0001')).getTime() - completed_at.getTime(), 30 * DAY);
    await setStatus(s.db, s.gid, 'active');
  });

  test('отключённая владельцем ссылка не впускает и не показывается', async () => {
    const off = await as(s.db, ANYA, `DELETE FROM public.group_invites WHERE invite_code = $1`, [s.code]);
    assert.ok(off.ok && off.affected === 1, off.error ?? 'не удалилась');
    await s.db.query(`DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2`, [s.gid, VIKA]);
    const join = await as(s.db, VIKA, REDEEM, [s.code]);
    assert.equal(join.ok, false);
    const pv = await asAnon(s.db, () => run(s.db, PREVIEW, [s.code]));
    assert.equal(pv.ok, false);
  });
});

describe('откат', () => {
  test('preview исчезает, бессрочные ссылки получают 14 дней от создания, клиент снова задаёт срок сам', async () => {
    const s = await scenario();
    await s.db.exec(readFileSync(path.join(process.cwd(), 'supabase', 'rollback', '20261101000100_event_invites.down.sql'), 'utf-8'));
    const pv = await asAnon(s.db, () => run(s.db, PREVIEW, [s.code]));
    assert.equal(pv.ok, false);
    const { d } = await one(s.db, `SELECT extract(epoch FROM expires_at - created_at)::int AS d FROM public.group_invites WHERE invite_code = $1`, [s.code]);
    assert.equal(d, 14 * 86_400);
    await as(s.db, ANYA, `INSERT INTO public.group_invites (group_id, invite_code, created_by, expires_at) VALUES ($1, 'AFTERDOWN001', $2, now() + interval '1 day')`, [s.gid, ANYA]);
    assert.ok((await expiresAt(s.db, 'AFTERDOWN001')).getTime() - Date.now() < 2 * DAY);
  });
});
