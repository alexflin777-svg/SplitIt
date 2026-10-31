/**
 * «Проект» (SplitIT 1.1.0, этап 3б): таблицы, RLS и RPC на настоящем PostgreSQL
 * (PGlite, тот же харнесс, что у test/rls.test.mjs).
 *
 * Запуск: npm run test:rls
 *
 * Покрывает пункты RLS/RPC §10 PROJECT-SPEC.md:
 *   - неучастник и удалённый аккаунт не читают ни одной таблицы проекта и не
 *     вызывают ни одной функции (кроме create/preview/join для неучастника);
 *   - preview_project_invite отдаёт только название, имя, число, «действует ли»;
 *   - прямая запись мимо функций отклоняется на каждой таблице;
 *   - принятые условия, журнал долга, закрытый период неизменяемы даже для
 *     владельца схемы (триггеры, как и для SECURITY DEFINER, ролей не различают);
 *   - два открытых периода невозможны, close_period при сбое не меняет ничего;
 *   - set_quantity и mark_transfer_paid — по таблице прав §7.3;
 *   - ссылки на чужой проект отклоняются, join идемпотентен;
 *   - close_period на примерах §3а.4–§3а.6 даёт те же цифры, что calculatePeriod.
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestDatabase, asUser } from './pg-harness.mjs';
import { calculatePeriod, closePeriodDebt } from '../src/lib/project-calc.ts';

const ANYA = 'a0000000-0000-4000-8000-000000000001'; // владелец
const BORYA = 'b0000000-0000-4000-8000-000000000002';
const VIKA = 'c0000000-0000-4000-8000-000000000003';
const STRANGER = 'd0000000-0000-4000-8000-000000000004'; // не участник
const GONE = 'e0000000-0000-4000-8000-000000000005'; // участник, удаляет аккаунт

/** Таблица → столбец, который безопасно «обновить сам на себя». */
const PROJECT_TABLES = {
  projects: 'name',
  project_members: 'status',
  project_invites: 'code',
  project_periods: 'revision',
  project_terms: 'status',
  project_term_lines: 'leaves',
  project_term_approvals: 'decision',
  project_operations: 'title',
  project_quantities: 'hours',
  project_contribution_ledger: 'amount',
  project_transfers: 'amount',
  project_audit: 'action',
};
const TABLES = Object.keys(PROJECT_TABLES);

const PROJECT_FUNCTIONS = [
  'create_project',
  'preview_project_invite',
  'join_project_by_invite',
  'create_project_invite',
  'disable_project_invite',
  'propose_terms',
  'accept_terms',
  'decline_terms',
  'add_operation',
  'edit_operation',
  'delete_operation',
  'set_quantity',
  'close_period',
  'mark_transfer_paid',
];

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

/** Помощники, привязанные к базе. Вызовы функций возвращают столбец v. */
function bind(db) {
  const as = (uid, sql, params = []) => asUser(db, uid, () => run(db, sql, params));
  async function ok(uid, sql, params = []) {
    const r = await as(uid, sql, params);
    assert.ok(r.ok, `${sql}: ${r.error}`);
    return r.rows[0]?.v;
  }
  async function fails(uid, sql, params = [], pattern = undefined) {
    const r = await as(uid, sql, params);
    assert.equal(r.ok, false, `${sql} должен быть отклонён`);
    if (pattern) assert.match(r.error, pattern);
    return r.error;
  }
  const admin = async (sql, params = []) => (await db.query(sql, params)).rows;
  return { as, ok, fails, admin };
}

const ADD_OP = `SELECT public.add_operation(p_project_id => $1::uuid, p_op_type => $2, p_amount => $3::bigint,
                  p_member_id => $4::uuid, p_refund_of => $5::uuid) AS v`;
const PROPOSE = `SELECT public.propose_terms($1::uuid, $2::jsonb) AS v`;
const ACCEPT = `SELECT public.accept_terms($1::uuid) AS v`;
const SET_QTY = `SELECT public.set_quantity($1::uuid, $2::uuid, $3::int, $4::bigint) AS v`;
const CLOSE = `SELECT public.close_period($1::uuid, $2::bigint) AS v`;
const MARK = `SELECT public.mark_transfer_paid($1::uuid, $2::uuid, $3::uuid) AS v`;

async function newDb() {
  const db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Аня', 'anya@example.com'), ($2, 'Боря', 'borya@example.com'), ($3, 'Вика', 'vika@example.com'),
       ($4, 'Чужой', 'x@example.com'), ($5, 'Гена', 'gena@example.com')`,
    [ANYA, BORYA, VIKA, STRANGER, GONE],
  );
  return db;
}

/**
 * Аня создаёт проект (в первоначальных условиях — только она и гости), Боря
 * и Вика входят по ссылке, Аня предлагает условия периода 1 на всех, все
 * принимают.
 */
async function team(db, { terms, guests = [], extraUsers = [] } = {}) {
  const { ok, admin } = bind(db);
  const pid = await ok(
    ANYA,
    `SELECT public.create_project($1, 'RUB', $2::text[], $3::jsonb) AS v`,
    ['Свадьба Ивановых', guests, JSON.stringify({ remainder_method: 'equal', lines: [{ position: 1 }] })],
  );
  const code = await ok(ANYA, `SELECT public.create_project_invite($1::uuid) AS v`, [pid]);
  const m = {};
  m.A = (await admin(`SELECT id FROM public.project_members WHERE project_id = $1 AND user_id = $2`, [pid, ANYA]))[0].id;
  m.B = await ok(BORYA, `SELECT public.join_project_by_invite($1) AS v`, [code]);
  m.V = await ok(VIKA, `SELECT public.join_project_by_invite($1) AS v`, [code]);
  for (const u of extraUsers) m[u] = await ok(u, `SELECT public.join_project_by_invite($1) AS v`, [code]);
  m.guests = (await admin(
    `SELECT id FROM public.project_members WHERE project_id = $1 AND kind = 'guest' ORDER BY position`,
    [pid],
  )).map((r) => r.id);
  let termsId = null;
  if (terms) {
    termsId = await ok(ANYA, PROPOSE, [pid, JSON.stringify(terms(m))]);
    for (const u of [BORYA, VIKA, ...extraUsers]) await ok(u, ACCEPT, [termsId]);
  }
  return { pid, code, m, termsId };
}

/** Условия §3а.4: Аня фикс 20 000, Боря вклад 30 000, Вика 1 500 ₽/ч; по % 40/40/20. */
const MIXED = (m, patch = {}) => ({
  preset: 'custom',
  contrib_enabled: true,
  remainder_method: 'percent',
  lines: [
    { member_id: m.A, rate_type: 'fixed', rate_amount: 2_000_000, in_remainder: true, share_bp: 4000, ...patch[m.A] },
    { member_id: m.B, contrib_new: 3_000_000, in_remainder: true, share_bp: 4000, ...patch[m.B] },
    { member_id: m.V, rate_type: 'hourly', rate_amount: 150_000, in_remainder: true, share_bp: 2000, ...patch[m.V] },
  ],
});

/** Те же условия для calculatePeriod (значения клиента: 'period' = фикс). */
const MIXED_CALC = (m, patch = {}) => ({
  contribEnabled: true,
  remainderMethod: 'percent',
  lines: [
    { memberId: m.A, expensesBack: true, rate: { type: 'period', amount: 2_000_000 }, inRemainder: true, shareBp: 4000, contribNew: 0, debtWriteOff: 0, ...patch[m.A] },
    { memberId: m.B, expensesBack: true, rate: { type: 'none', amount: 0 }, inRemainder: true, shareBp: 4000, contribNew: 3_000_000, debtWriteOff: 0, ...patch[m.B] },
    { memberId: m.V, expensesBack: true, rate: { type: 'hourly', amount: 150_000 }, inRemainder: true, shareBp: 2000, contribNew: 0, debtWriteOff: 0, ...patch[m.V] },
  ],
});

const calcMembers = (m) => [
  { id: m.A, name: 'Аня', position: 1, role: 'user' },
  { id: m.B, name: 'Боря', position: 2, role: 'user' },
  { id: m.V, name: 'Вика', position: 3, role: 'user' },
];

/** Октябрь §3а.5: доход 50 000 Ане, расходы 15 000 / 6 000 / 9 000. */
const OCTOBER = (m) => [
  ['income', ANYA, m.A, 5_000_000],
  ['expense', ANYA, m.A, 1_500_000],
  ['expense', BORYA, m.B, 600_000],
  ['expense', VIKA, m.V, 900_000],
];

/** Общие цифры §3: доходы Аня 120 000 / Боря 60 000, расходы 15 000 / 6 000 / 9 000. */
const BASE = (m) => [
  ['income', ANYA, m.A, 12_000_000],
  ['income', BORYA, m.B, 6_000_000],
  ['expense', ANYA, m.A, 1_500_000],
  ['expense', BORYA, m.B, 600_000],
  ['expense', VIKA, m.V, 900_000],
];

async function addOps(h, pid, ops) {
  for (const [type, who, mem, amt] of ops) await h.ok(who, ADD_OP, [pid, type, amt, mem, null]);
}

async function openPeriod(db, pid) {
  return (await db.query(`SELECT * FROM public.project_periods WHERE project_id = $1 AND status = 'open'`, [pid])).rows[0];
}

async function closeNow(db, uid, pid) {
  const p = await openPeriod(db, pid);
  return bind(db).ok(uid, CLOSE, [pid, p.revision]);
}

async function ledgerBalance(db, pid) {
  const rows = (await db.query(
    `SELECT member_id, sum(CASE kind WHEN 'credit' THEN amount ELSE -amount END)::bigint AS d
     FROM public.project_contribution_ledger WHERE project_id = $1 GROUP BY member_id`,
    [pid],
  )).rows;
  return Object.fromEntries(rows.map((r) => [r.member_id, Number(r.d)]));
}

async function ledgerRows(db, pid, memberId = null) {
  return (await db.query(
    `SELECT kind, amount::bigint AS amount FROM public.project_contribution_ledger
     WHERE project_id = $1 AND ($2::uuid IS NULL OR member_id = $2) ORDER BY id`,
    [pid, memberId],
  )).rows.map((r) => [r.kind, Number(r.amount)]);
}

/** Слепок всех таблиц проекта: для проверок «ничего не изменилось». */
async function fingerprint(db) {
  const out = {};
  for (const t of TABLES) {
    out[t] = (await db.query(
      `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h, count(*)::int AS n FROM public.${t} x`,
    )).rows[0];
  }
  return out;
}

function assertMatchesCalc(snapshot, calc, m) {
  for (const id of [m.A, m.B, m.V]) {
    const s = snapshot.members.find((x) => x.member_id === id);
    const c = calc.perPerson[id];
    assert.ok(s, `нет участника ${id} в снимке`);
    for (const [k, ck] of [
      ['expenses_back', 'expensesBack'],
      ['contribution_back', 'contributionBack'],
      ['rate_accrued', 'rateAccrued'],
      ['rate', 'rate'],
      ['remainder_share', 'remainderShare'],
      ['owed', 'owed'],
      ['on_hand', 'onHand'],
      ['transfer', 'transfer'],
    ]) {
      assert.equal(Number(s[k]), c[ck], `${c.name}: ${k}`);
    }
    if (calc.debtAfter[id] !== undefined) assert.equal(Number(s.debt_after), calc.debtAfter[id], `${c.name}: долг после`);
  }
  assert.deepEqual(
    snapshot.transfers.map((t) => [t.from_member, t.to_member, Number(t.amount)]),
    calc.transfers.map((t) => [t.fromId, t.toId, t.amount]),
  );
  assert.equal(Number(snapshot.profit), calc.profit);
  assert.equal(Number(snapshot.remainder), calc.remainder);
}

// ---------------------------------------------------------------------------

describe('создание, приглашение, вход', () => {
  let db;
  let h;
  before(async () => {
    db = await newDb();
    h = bind(db);
  });

  test('create_project: неучастник с аккаунтом → проект, он владелец и участник №1, период №1 открыт', async () => {
    const pid = await h.ok(
      STRANGER,
      `SELECT public.create_project('Ярмарка', 'RUB', ARRAY['Саша'], $1::jsonb) AS v`,
      [JSON.stringify({ remainder_method: 'equal', lines: [{ position: 1 }, { position: 2 }] })],
    );
    const [p] = await h.admin(`SELECT * FROM public.projects WHERE id = $1`, [pid]);
    assert.equal(p.owner_id, STRANGER);
    const members = await h.admin(
      `SELECT kind, user_id, position, display_name, status FROM public.project_members WHERE project_id = $1 ORDER BY position`,
      [pid],
    );
    assert.deepEqual(members, [
      { kind: 'user', user_id: STRANGER, position: 1, display_name: 'Чужой', status: 'active' },
      { kind: 'guest', user_id: null, position: 2, display_name: 'Саша', status: 'active' },
    ]);
    assert.deepEqual(await h.admin(`SELECT seq, status FROM public.project_periods WHERE project_id = $1`, [pid]), [
      { seq: 1, status: 'open' },
    ]);
    assert.deepEqual(
      await h.admin(`SELECT status, effective_from_seq FROM public.project_terms WHERE project_id = $1`, [pid]),
      [{ status: 'active', effective_from_seq: 1 }],
      'создатель — единственный аккаунт: условия сразу приняты',
    );
  });

  test('create_project: без входа и с неверными условиями — отказ', async () => {
    const r = await asAnon(db, () =>
      run(db, `SELECT public.create_project('X', 'RUB', ARRAY[]::text[], '{"lines":[{"position":1}]}'::jsonb)`),
    );
    assert.equal(r.ok, false);
    const CREATE = `SELECT public.create_project('X', 'RUB', ARRAY[]::text[], $1::jsonb) AS v`;
    await h.fails(ANYA, CREATE, [JSON.stringify({ remainder_method: 'percent', lines: [{ position: 1, share_bp: 9000 }] })], /Сейчас 90 %, нужно 100 %/);
    await h.fails(ANYA, CREATE, [JSON.stringify({ lines: [{ position: 1, rate_type: 'fixed', rate_amount: -1 }] })]);
    await h.fails(ANYA, CREATE, [JSON.stringify({ lines: [{ position: 1, in_remainder: false }] })], /Кто-то должен получать остаток/);
    await h.fails(ANYA, CREATE, [JSON.stringify({ lines: [{ position: 7 }] })], /участник/i);
  });

  test('preview_project_invite без входа: только название, имя, число участников, действует ли', async () => {
    const { pid, code, m } = await team(db, { terms: MIXED });
    await h.ok(ANYA, ADD_OP, [pid, 'income', 12_000_000, m.A, null]);
    const r = await asAnon(db, () => run(db, `SELECT public.preview_project_invite($1) AS v`, [code]));
    assert.ok(r.ok, r.error);
    const v = r.rows[0].v;
    assert.deepEqual(v, { project_name: 'Свадьба Ивановых', inviter_name: 'Аня', member_count: 3, is_active: true });
    assert.ok(!JSON.stringify(v).includes('12000000'), 'в превью нет сумм');
  });

  test('preview: неизвестный код — отказ; отключённый — is_active = false', async () => {
    const r = await asAnon(db, () => run(db, `SELECT public.preview_project_invite('nope-nope-nope-nope') AS v`));
    assert.equal(r.ok, false);
    const { code } = await team(db);
    await h.ok(ANYA, `SELECT public.disable_project_invite($1) AS v`, [code]);
    const r2 = await asAnon(db, () => run(db, `SELECT public.preview_project_invite($1) AS v`, [code]));
    assert.equal(r2.rows[0].v.is_active, false);
  });

  test('join_project_by_invite идемпотентен; по отключённому коду — отказ', async () => {
    const { pid, code, m } = await team(db);
    assert.equal(await h.ok(BORYA, `SELECT public.join_project_by_invite($1) AS v`, [code]), m.B, 'тот же участник');
    const [{ n }] = await h.admin(
      `SELECT count(*)::int AS n FROM public.project_members WHERE project_id = $1 AND user_id = $2`,
      [pid, BORYA],
    );
    assert.equal(n, 1);
    await h.fails(BORYA, `SELECT public.disable_project_invite($1) AS v`, [code], /владелец|автор/);
    await h.ok(ANYA, `SELECT public.disable_project_invite($1) AS v`, [code]);
    await h.fails(STRANGER, `SELECT public.join_project_by_invite($1) AS v`, [code], /недействительно/);
    const r = await asAnon(db, () => run(db, `SELECT public.join_project_by_invite($1)`, [code]));
    assert.equal(r.ok, false, 'аноним не входит');
  });
});

describe('неучастник и удалённый аккаунт', () => {
  let db;
  let h;
  let ctx;
  before(async () => {
    db = await newDb();
    h = bind(db);
    ctx = await team(db, { terms: MIXED, extraUsers: [GONE] });
    const { pid, m } = ctx;
    ctx.op = await h.ok(ANYA, ADD_OP, [pid, 'income', 5_000_000, m.A, null]);
    await h.ok(VIKA, SET_QTY, [pid, m.V, 1000, null]);
    // У Гены деньги проекта: доход на его карту.
    await h.ok(GONE, ADD_OP, [pid, 'income', 100_000, m[GONE], null]);
    ctx.closed = await closeNow(db, ANYA, pid);
    const t = ctx.closed.transfers.find((x) => x.from_member === m.A);
    await h.ok(ANYA, MARK, [ctx.closed.period_id, t.from_member, t.to_member]);
    await h.ok(ANYA, ADD_OP, [pid, 'expense', 10_000, m.A, null]);
    await h.ok(GONE, `SELECT public.delete_my_account() AS v`);
  });

  test('контроль: участник читает каждую таблицу проекта', async () => {
    for (const t of TABLES) {
      const r = await h.as(BORYA, `SELECT * FROM public.${t}`);
      assert.ok(r.ok, `${t}: ${r.error}`);
      assert.ok(r.rows.length > 0, `${t}: участник ничего не видит`);
    }
  });

  test('неучастник не читает ни одной таблицы проекта (в том числе операции)', async () => {
    for (const t of TABLES) {
      const r = await h.as(STRANGER, `SELECT * FROM public.${t}`);
      assert.ok(!r.ok || r.rows.length === 0, `${t}: неучастник видит ${r.rows.length} строк`);
    }
  });

  test('удалённый аккаунт не читает ни одной таблицы проекта', async () => {
    for (const t of TABLES) {
      const r = await h.as(GONE, `SELECT * FROM public.${t}`);
      assert.ok(!r.ok || r.rows.length === 0, `${t}: удалённый видит ${r.rows.length} строк`);
    }
  });

  test('удалённый аккаунт и неучастник не пишут ни в одну таблицу проекта', async () => {
    const before = await fingerprint(db);
    for (const uid of [GONE, STRANGER]) {
      for (const [t, col] of Object.entries(PROJECT_TABLES)) {
        const ins = await h.as(uid, `INSERT INTO public.${t} DEFAULT VALUES`);
        assert.equal(ins.ok, false, `${t}: INSERT прошёл`);
        const upd = await h.as(uid, `UPDATE public.${t} SET ${col} = ${col}`);
        assert.ok(!upd.ok || upd.affected === 0, `${t}: UPDATE прошёл`);
        const del = await h.as(uid, `DELETE FROM public.${t}`);
        assert.ok(!del.ok || del.affected === 0, `${t}: DELETE прошёл`);
      }
    }
    assert.deepEqual(await fingerprint(db), before);
  });

  test('удалённый аккаунт не вызывает ни одну функцию проекта, включая preview', async () => {
    const fns = await h.admin(
      `SELECT p.proname, p.oid::regprocedure::text AS sig,
              array(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) t) AS types
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = ANY ($1)`,
      [PROJECT_FUNCTIONS],
    );
    assert.deepEqual(fns.map((f) => f.proname).sort(), [...PROJECT_FUNCTIONS].sort(), 'все функции §7.3 существуют');
    const real = { uuid: ctx.pid, text: ctx.code, bigint: '1', integer: '1', jsonb: '{"lines":[]}', numeric: '1', date: '2026-10-31', 'text[]': '{}' };
    const before = await fingerprint(db);
    for (const f of fns) {
      const args = f.types.map((t) => (real[t] === undefined ? `NULL::${t}` : `'${real[t]}'::${t}`)).join(', ');
      const r = await h.as(GONE, `SELECT public.${f.proname}(${args})`);
      assert.equal(r.ok, false, `${f.sig}: удалённый аккаунт вызвал функцию`);
      assert.match(r.error, /Аккаунт удалён/, `${f.sig}: ${r.error}`);
    }
    assert.deepEqual(await fingerprint(db), before);
  });

  test('имя удалённого участника обезличено, его операции на месте', async () => {
    const [mem] = await h.admin(`SELECT display_name FROM public.project_members WHERE user_id = $1`, [GONE]);
    assert.equal(mem.display_name, 'Удалённый пользователь');
    const [op] = await h.admin(`SELECT count(*)::int AS n FROM public.project_operations WHERE member_id = $1`, [ctx.m[GONE]]);
    assert.equal(op.n, 1);
  });

  test('неучастник не вызывает функции участника и не меняет данные', async () => {
    const before = await fingerprint(db);
    const { pid, m, termsId, op } = ctx;
    const calls = [
      [PROPOSE, [pid, JSON.stringify({ lines: [{ member_id: m.A }] })]],
      [ACCEPT, [termsId]],
      [`SELECT public.decline_terms($1::uuid) AS v`, [termsId]],
      [ADD_OP, [pid, 'income', 100, m.A, null]],
      [`SELECT public.edit_operation(p_operation_id => $1::uuid, p_amount => 1::bigint) AS v`, [op]],
      [`SELECT public.delete_operation($1::uuid) AS v`, [op]],
      [SET_QTY, [pid, m.V, 100, null]],
      [CLOSE, [pid, 0]],
      [MARK, [ctx.closed.period_id, m.A, m.V]],
      [`SELECT public.create_project_invite($1::uuid) AS v`, [pid]],
      [`SELECT public.disable_project_invite($1) AS v`, [ctx.code]],
    ];
    for (const [sql, params] of calls) {
      const r = await h.as(STRANGER, sql, params);
      assert.equal(r.ok, false, `неучастник выполнил: ${sql}`);
    }
    assert.deepEqual(await fingerprint(db), before);
  });
});

describe('прямая запись мимо функций и неизменяемость', () => {
  let db;
  let h;
  let ctx;
  before(async () => {
    db = await newDb();
    h = bind(db);
    ctx = await team(db, { terms: MIXED });
    const { pid, m } = ctx;
    ctx.op = await h.ok(ANYA, ADD_OP, [pid, 'income', 18_000_000, m.A, null]);
    await h.ok(VIKA, SET_QTY, [pid, m.V, 1000, null]);
    ctx.closed = await closeNow(db, ANYA, pid);
    ctx.openOp = await h.ok(ANYA, ADD_OP, [pid, 'expense', 50_000, m.A, null]);
  });

  test('участник не меняет напрямую долю, ставку, тип ставки, вклад, блок, способ остатка, статус', async () => {
    const { termsId, m, pid } = ctx;
    const before = await fingerprint(db);
    const attacks = [
      [`UPDATE public.project_term_lines SET share_bp = 9000 WHERE member_id = $1`, [m.B]],
      [`UPDATE public.project_term_lines SET rate_amount = 99999999 WHERE member_id = $1`, [m.B]],
      [`UPDATE public.project_term_lines SET rate_type = 'fixed' WHERE member_id = $1`, [m.B]],
      [`UPDATE public.project_term_lines SET contrib_new = 99999999 WHERE member_id = $1`, [m.B]],
      [`UPDATE public.project_term_lines SET expenses_back = false WHERE member_id = $1`, [m.A]],
      [`UPDATE public.project_terms SET remainder_method = 'equal' WHERE id = $1`, [termsId]],
      [`UPDATE public.project_terms SET contrib_enabled = false WHERE id = $1`, [termsId]],
      [`UPDATE public.project_terms SET status = 'rejected' WHERE id = $1`, [termsId]],
      [`INSERT INTO public.project_terms (project_id, proposed_by) VALUES ($1, $2)`, [pid, BORYA]],
      [`INSERT INTO public.project_term_lines (project_id, terms_id, member_id, share_bp) VALUES ($1, $2, $3, 100)`, [pid, termsId, m.B]],
      [`DELETE FROM public.project_term_lines WHERE terms_id = $1`, [termsId]],
      [`INSERT INTO public.project_term_approvals (project_id, terms_id, user_id, decision) VALUES ($1, $2, $3, 'accept')`, [pid, termsId, BORYA]],
      [`INSERT INTO public.project_quantities (project_id, period_id, member_id, hours, entered_by)
        VALUES ($1, (SELECT id FROM public.project_periods WHERE status = 'open' AND project_id = $1), $2, 100, $3)`, [pid, m.B, BORYA]],
      [`UPDATE public.project_quantities SET hours = 99900`, []],
      [`DELETE FROM public.project_quantities`, []],
      [`INSERT INTO public.project_contribution_ledger (project_id, member_id, period_id, terms_id, kind, amount)
        SELECT project_id, member_id, period_id, terms_id, 'credit', 1 FROM public.project_contribution_ledger LIMIT 1`, []],
      [`UPDATE public.project_contribution_ledger SET amount = 1`, []],
      [`DELETE FROM public.project_contribution_ledger`, []],
      [`INSERT INTO public.project_operations (project_id, period_id, op_type, amount, currency, member_id, created_by)
        SELECT project_id, period_id, 'income', 100, 'RUB', member_id, $1 FROM public.project_operations LIMIT 1`, [BORYA]],
      [`UPDATE public.project_operations SET amount = 1`, []],
      [`DELETE FROM public.project_operations`, []],
      [`UPDATE public.project_periods SET status = 'open'`, []],
      [`UPDATE public.project_periods SET revision = 0`, []],
      [`INSERT INTO public.project_periods (project_id, seq, terms_id) VALUES ($1, 99, $2)`, [pid, termsId]],
      [`UPDATE public.projects SET owner_id = $1`, [BORYA]],
      [`INSERT INTO public.project_members (project_id, kind, user_id, display_name, position) VALUES ($1, 'user', $2, 'X', 50)`, [pid, STRANGER]],
      [`UPDATE public.project_members SET status = 'left'`, []],
      [`INSERT INTO public.project_invites (project_id, code, created_by) VALUES ($1, 'aaaaaaaaaaaaaaaaaaaaaaaa', $2)`, [pid, BORYA]],
      [`INSERT INTO public.project_transfers (project_id, period_id, from_member, to_member, amount, marked_by)
        VALUES ($1, $2, $3, $4, 1, $5)`, [pid, ctx.closed.period_id, m.A, m.B, BORYA]],
      [`INSERT INTO public.project_audit (project_id, actor_id, action) VALUES ($1, $2, 'fake')`, [pid, BORYA]],
      [`DELETE FROM public.project_audit`, []],
    ];
    for (const [sql, params] of attacks) {
      for (const uid of [BORYA, ANYA]) {
        const r = await h.as(uid, sql, params);
        assert.ok(!r.ok || r.affected === 0, `прошло от ${uid}: ${sql}`);
      }
    }
    assert.deepEqual(await fingerprint(db), before);
  });

  test('принятая версия условий не меняется даже владельцем схемы (как из SECURITY DEFINER)', async () => {
    const { termsId, m, pid } = ctx;
    for (const sql of [
      `UPDATE public.project_term_lines SET share_bp = 9000 WHERE terms_id = '${termsId}' AND member_id = '${m.B}'`,
      `DELETE FROM public.project_term_lines WHERE terms_id = '${termsId}'`,
      `INSERT INTO public.project_term_lines (project_id, terms_id, member_id) VALUES ('${pid}', '${termsId}', '${m.A}')`,
      `UPDATE public.project_terms SET remainder_method = 'equal' WHERE id = '${termsId}'`,
      `UPDATE public.project_terms SET status = 'proposed' WHERE id = '${termsId}'`,
      `DELETE FROM public.project_terms WHERE id = '${termsId}'`,
    ]) {
      const r = await run(db, sql);
      assert.equal(r.ok, false, `владелец схемы изменил условия: ${sql}`);
      assert.match(r.error, /неизменяем/i);
    }
  });

  test('журнал долга не меняется и не удаляется даже владельцем схемы', async () => {
    assert.ok((await ledgerRows(db, ctx.pid)).length >= 2, 'в журнале есть credit и repay');
    for (const sql of [`UPDATE public.project_contribution_ledger SET amount = 1`, `DELETE FROM public.project_contribution_ledger`]) {
      const r = await run(db, sql);
      assert.equal(r.ok, false, sql);
      assert.match(r.error, /журнал/i);
    }
  });

  test('TRUNCATE любой таблицы проекта отклоняется даже владельцем БД', async () => {
    const before = await fingerprint(db);
    for (const t of TABLES) {
      const r = await run(db, `TRUNCATE public.${t} CASCADE`);
      assert.equal(r.ok, false, `TRUNCATE ${t} прошёл`);
      assert.match(r.error, /неизменяем|не меняется/i, t);
    }
    assert.deepEqual(await fingerprint(db), before);
  });

  test('операция и количества в закрытом периоде: ни RPC, ни владелец схемы', async () => {
    await h.fails(ANYA, `SELECT public.edit_operation(p_operation_id => $1::uuid, p_amount => 1::bigint) AS v`, [ctx.op], /закрыт/);
    await h.fails(ANYA, `SELECT public.delete_operation($1::uuid) AS v`, [ctx.op], /закрыт/);
    const closed = ctx.closed.period_id;
    for (const sql of [
      `UPDATE public.project_operations SET amount = 1 WHERE id = '${ctx.op}'`,
      `DELETE FROM public.project_operations WHERE id = '${ctx.op}'`,
      `UPDATE public.project_quantities SET hours = 1 WHERE period_id = '${closed}'`,
      `DELETE FROM public.project_quantities WHERE period_id = '${closed}'`,
      `INSERT INTO public.project_quantities (project_id, period_id, member_id, hours, entered_by) VALUES ('${ctx.pid}', '${closed}', '${ctx.m.B}', 1, '${ANYA}')`,
      `UPDATE public.project_operations SET period_id = '${closed}' WHERE id = '${ctx.openOp}'`,
      `UPDATE public.project_periods SET snapshot = '{}'::jsonb WHERE id = '${closed}'`,
      `DELETE FROM public.project_periods WHERE id = '${closed}'`,
    ]) {
      const r = await run(db, sql);
      assert.equal(r.ok, false, `прошло: ${sql}`);
    }
    // Вставка с period_id закрытого периода попадает в открытый: период ставит база.
    const [row] = await h.admin(
      `INSERT INTO public.project_operations (project_id, period_id, op_type, amount, currency, member_id, created_by)
       VALUES ($1, $2, 'income', 100, 'RUB', $3, $4) RETURNING period_id`,
      [ctx.pid, closed, ctx.m.A, ANYA],
    );
    assert.equal(row.period_id, (await openPeriod(db, ctx.pid)).id);
  });

  test('два открытых периода невозможны', async () => {
    const r = await run(db, `INSERT INTO public.project_periods (project_id, seq, terms_id) VALUES ($1, 77, $2)`, [ctx.pid, ctx.termsId]);
    assert.equal(r.ok, false);
    assert.match(r.error, /project_periods_one_open/);
  });
});

describe('операции: связи одного проекта и права', () => {
  let db;
  let h;
  let a;
  let b;
  before(async () => {
    db = await newDb();
    h = bind(db);
    a = await team(db, { guests: ['Саша'] });
    b = await team(db);
    a.income = await h.ok(ANYA, ADD_OP, [a.pid, 'income', 1_000_000, a.m.A, null]);
    b.income = await h.ok(ANYA, ADD_OP, [b.pid, 'income', 1_000_000, b.m.A, null]);
  });

  test('автор операции — вызывающий, период — открытый', async () => {
    const id = await h.ok(BORYA, ADD_OP, [a.pid, 'expense', 500, a.m.A, null]);
    const [op] = await h.admin(`SELECT created_by, period_id FROM public.project_operations WHERE id = $1`, [id]);
    assert.equal(op.created_by, BORYA);
    assert.equal(op.period_id, (await openPeriod(db, a.pid)).id);
  });

  test('участник или доход другого проекта — отказ', async () => {
    await h.fails(ANYA, ADD_OP, [a.pid, 'income', 100, b.m.B, null], /участник/i);
    await h.fails(ANYA, ADD_OP, [a.pid, 'income_refund', 100, a.m.A, b.income], /доход/i);
    await h.fails(ANYA, `SELECT public.edit_operation(p_operation_id => $1::uuid, p_member_id => $2::uuid) AS v`, [a.income, b.m.B], /участник/i);
  });

  test('сумма > 0; возвраты по доходу не больше дохода; возврат — только со ссылкой на доход', async () => {
    await h.fails(ANYA, ADD_OP, [a.pid, 'income', 0, a.m.A, null]);
    await h.fails(ANYA, ADD_OP, [a.pid, 'income', -5, a.m.A, null]);
    await h.fails(ANYA, ADD_OP, [a.pid, 'income_refund', 100, a.m.A, null], /доход/i);
    await h.ok(ANYA, ADD_OP, [a.pid, 'income_refund', 600_000, a.m.guests[0], a.income]);
    await h.fails(ANYA, ADD_OP, [a.pid, 'income_refund', 400_001, a.m.A, a.income], /больше дохода/);
    await h.fails(ANYA, `SELECT public.edit_operation(p_operation_id => $1::uuid, p_amount => 500000::bigint) AS v`, [a.income], /больше дохода/);
    await h.fails(ANYA, `SELECT public.delete_operation($1::uuid) AS v`, [a.income], /возврат/i);
  });

  test('править и удалять — автор или владелец', async () => {
    const vOp = await h.ok(VIKA, ADD_OP, [a.pid, 'expense', 700, a.m.V, null]);
    await h.fails(BORYA, `SELECT public.edit_operation(p_operation_id => $1::uuid, p_amount => 1::bigint) AS v`, [vOp], /автор или владелец/);
    await h.fails(BORYA, `SELECT public.delete_operation($1::uuid) AS v`, [vOp], /автор или владелец/);
    await h.ok(VIKA, `SELECT public.edit_operation(p_operation_id => $1::uuid, p_amount => 800::bigint) AS v`, [vOp]);
    await h.ok(ANYA, `SELECT public.delete_operation($1::uuid) AS v`, [vOp]);
  });

  test('курс не округляется; сумму в валюте проекта считает база', async () => {
    const id = await h.ok(
      ANYA,
      `SELECT public.add_operation(p_project_id => $1::uuid, p_op_type => 'income', p_amount => 1001::bigint,
         p_member_id => $2::uuid, p_currency => 'USD', p_exchange_rate => 92.123456789) AS v`,
      [a.pid, a.m.A],
    );
    const [op] = await h.admin(
      `SELECT exchange_rate::text AS r, amount_in_project_currency::bigint AS pc FROM public.project_operations WHERE id = $1`,
      [id],
    );
    assert.equal(op.r, '92.123456789');
    assert.equal(Number(op.pc), Math.round(1001 * 92.123456789));
    await h.fails(
      ANYA,
      `SELECT public.add_operation(p_project_id => $1::uuid, p_op_type => 'income', p_amount => 100::bigint,
         p_member_id => $2::uuid, p_currency => 'RUB', p_exchange_rate => 2) AS v`,
      [a.pid, a.m.A],
      /курс/i,
    );
  });

  test('история: каждая операция, правка и удаление записаны с автором', async () => {
    const rows = await h.admin(`SELECT action, actor_id FROM public.project_audit WHERE project_id = $1 ORDER BY id`, [a.pid]);
    const actions = rows.map((r) => r.action);
    for (const act of ['project_created', 'member_joined', 'invite_created', 'operation_added', 'operation_edited', 'operation_deleted']) {
      assert.ok(actions.includes(act), `нет записи ${act}`);
    }
    assert.ok(rows.filter((r) => r.action === 'operation_added').some((r) => r.actor_id === BORYA));
  });
});

describe('условия: согласие всех, вступление со следующего периода, выход', () => {
  let db;
  let h;
  before(async () => {
    db = await newDb();
    h = bind(db);
  });

  test('пока условия периода 1 не приняли все — операции пишутся, close_period отклоняется', async () => {
    const { pid, m } = await team(db);
    const tid = await h.ok(ANYA, PROPOSE, [pid, JSON.stringify(MIXED(m))]);
    await h.ok(BORYA, ACCEPT, [tid]);
    await h.ok(VIKA, ADD_OP, [pid, 'income', 100_000, m.V, null]);
    const p = await openPeriod(db, pid);
    assert.notEqual(p.terms_id, tid, 'версия ещё не действует');
    await h.fails(ANYA, CLOSE, [pid, p.revision], /Ждём согласия: .*Вика/);
    await h.ok(VIKA, ACCEPT, [tid]);
    const [t] = await h.admin(`SELECT status, effective_from_seq FROM public.project_terms WHERE id = $1`, [tid]);
    assert.deepEqual(t, { status: 'active', effective_from_seq: 1 });
    assert.equal((await openPeriod(db, pid)).terms_id, tid);
    assert.deepEqual(await ledgerBalance(db, pid), {}, 'вклады первоначальной версии пишутся при первом итоге');
    await closeNow(db, ANYA, pid);
    // credit ровно один раз; прибыль 1 000 ₽ сразу возвращается Боре.
    assert.deepEqual(await ledgerRows(db, pid), [['credit', 3_000_000], ['repay', 100_000]]);
  });

  test('вошедший до первого итога принимает действующие условия периода 1; отказаться от них нельзя', async () => {
    const { pid } = await team(db); // условия «только Аня» приняты при создании, Боря и Вика вошли позже
    const p = await openPeriod(db, pid);
    await h.fails(ANYA, CLOSE, [pid, p.revision], /Ждём согласия: Боря, Вика/);
    await h.fails(BORYA, `SELECT public.decline_terms($1::uuid) AS v`, [p.terms_id], /не ждут согласия/);
    await h.ok(BORYA, ACCEPT, [p.terms_id]);
    await h.ok(VIKA, ACCEPT, [p.terms_id]);
    await closeNow(db, ANYA, pid);
    await h.fails(VIKA, ACCEPT, [p.terms_id], /уже/);
  });

  test('отказ одного — версия отклонена; повторно ответить нельзя', async () => {
    const { pid, m, termsId } = await team(db, { terms: MIXED });
    const tid = await h.ok(BORYA, PROPOSE, [pid, JSON.stringify(MIXED(m))]);
    await h.ok(VIKA, `SELECT public.decline_terms($1::uuid) AS v`, [tid]);
    const [t] = await h.admin(`SELECT status FROM public.project_terms WHERE id = $1`, [tid]);
    assert.equal(t.status, 'rejected');
    await h.fails(ANYA, ACCEPT, [tid], /не ждут согласия/);
    await h.fails(BORYA, ACCEPT, [termsId], /уже/);
  });

  test('изменение условий: текущий период не меняется, новая версия — со следующего', async () => {
    const { pid, m, termsId } = await team(db, { terms: MIXED });
    await h.ok(ANYA, ADD_OP, [pid, 'income', 18_000_000, m.A, null]);
    await closeNow(db, ANYA, pid);
    const next = MIXED(m, { [m.A]: { share_bp: 0 }, [m.B]: { share_bp: 0, contrib_new: 0 }, [m.V]: { share_bp: 0 } });
    next.remainder_method = 'equal';
    const tid = await h.ok(VIKA, PROPOSE, [pid, JSON.stringify(next)]);
    await h.ok(ANYA, ACCEPT, [tid]);
    await h.ok(BORYA, ACCEPT, [tid]);
    const p2 = await openPeriod(db, pid);
    assert.equal(p2.seq, 2);
    assert.equal(p2.terms_id, termsId, 'период 2 идёт по прежним условиям');
    const [t] = await h.admin(`SELECT status, effective_from_seq FROM public.project_terms WHERE id = $1`, [tid]);
    assert.deepEqual(t, { status: 'active', effective_from_seq: 3 });
    await closeNow(db, ANYA, pid);
    assert.equal((await openPeriod(db, pid)).terms_id, tid);
    const [old] = await h.admin(`SELECT status FROM public.project_terms WHERE id = $1`, [termsId]);
    assert.equal(old.status, 'superseded');
  });

  test('проверки §3а.7 в propose_terms', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    const bad = [
      [MIXED(m, { [m.A]: { share_bp: 3000 }, [m.B]: { share_bp: 4000 }, [m.V]: { share_bp: 2000 } }), /Сейчас 90 %, нужно 100 %/],
      [{ remainder_method: 'equal', lines: [{ member_id: m.A, in_remainder: false }] }, /Кто-то должен получать остаток/],
      [{ remainder_method: 'equal', lines: [{ member_id: m.A, rate_type: 'none', rate_amount: 100 }] }],
      [{ remainder_method: 'equal', lines: [{ member_id: m.A, contrib_kind: 'item', contrib_new: 100 }] }, /Опиши вещь и укажи оценку/],
      [{ remainder_method: 'equal', lines: [{ member_id: m.A, rate_type: 'fixed', rate_amount: 1.5 }] }],
      [{ remainder_method: 'equal', lines: [{ member_id: m.A }, { member_id: m.A }] }],
      [{ remainder_method: 'equal', lines: [{ member_id: m.A, debt_write_off: 100 }] }, /Можно списать не больше 0 ₽/],
      [{ remainder_method: 'equal', lines: [{ member_id: m.A, share_bp: 100 }] }, /Доля/],
    ];
    for (const [terms, re] of bad) {
      await h.fails(BORYA, PROPOSE, [pid, JSON.stringify(terms)], re);
    }
  });

  test('выход с долгом: без полного списания не принимается; после итога — left и долг 0', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    await addOps(h, pid, OCTOBER(m)); // §3а.5: Боре вернули 20 000, долг 10 000
    await closeNow(db, ANYA, pid);
    assert.equal((await ledgerBalance(db, pid))[m.B], 1_000_000);
    const leaving = (x) => ({
      contrib_enabled: true,
      remainder_method: 'percent',
      lines: [
        { member_id: m.A, rate_type: 'fixed', rate_amount: 2_000_000, share_bp: 5000 },
        { member_id: m.B, leaves: true, in_remainder: false, debt_write_off: x },
        { member_id: m.V, rate_type: 'hourly', rate_amount: 150_000, share_bp: 5000 },
      ],
    });
    await h.fails(BORYA, PROPOSE, [pid, JSON.stringify(leaving(500_000))], /Сначала верните или спишите весь долг: Боря 10 000 ₽/);
    const ownerLeaves = leaving(1_000_000);
    ownerLeaves.lines[0] = { member_id: m.A, leaves: true, in_remainder: false };
    await h.fails(ANYA, PROPOSE, [pid, JSON.stringify(ownerLeaves)], /Владелец не может выйти/);
    const tid = await h.ok(BORYA, PROPOSE, [pid, JSON.stringify(leaving(1_000_000))]);
    await h.ok(ANYA, ACCEPT, [tid]);
    await h.ok(VIKA, ACCEPT, [tid]);
    // Ноябрь: прибыль 5 000 — часть долга возвращается, остаток списывается.
    await h.ok(VIKA, ADD_OP, [pid, 'income', 500_000, m.V, null]);
    const snap = await closeNow(db, ANYA, pid);
    assert.equal(Number(snap.members.find((x) => x.member_id === m.B).contribution_back), 500_000);
    assert.deepEqual(await ledgerRows(db, pid, m.B), [['credit', 3_000_000], ['repay', 2_000_000], ['repay', 500_000], ['write_off', 500_000]]);
    assert.equal((await ledgerBalance(db, pid))[m.B], 0);
    const [mem] = await h.admin(`SELECT status FROM public.project_members WHERE id = $1`, [m.B]);
    assert.equal(mem.status, 'left');
    await h.fails(BORYA, ADD_OP, [pid, 'income', 100, m.B, null]);
    await h.fails(ANYA, ADD_OP, [pid, 'income', 100, m.B, null], /участник/i);

    // Решение 31.10: вышедший читает только периоды до выхода включительно (seq ≤ 2).
    const p2 = snap.period_id;
    const t2 = snap.transfers.find((x) => x.to_member === m.B);
    await h.ok(VIKA, MARK, [p2, t2.from_member, m.B]);
    await h.ok(VIKA, ADD_OP, [pid, 'income', 100_000, m.V, null]); // период 3
    const snap3 = await closeNow(db, ANYA, pid);
    const t3 = snap3.transfers.find((x) => x.from_member === m.V);
    await h.ok(VIKA, MARK, [snap3.period_id, t3.from_member, t3.to_member]);
    await h.ok(ANYA, ADD_OP, [pid, 'expense', 7_000, m.A, null]); // период 4, открыт
    await h.ok(VIKA, SET_QTY, [pid, m.V, 300, null]);
    const future = await h.ok(ANYA, PROPOSE, [pid, JSON.stringify({ remainder_method: 'equal', lines: [{ member_id: m.A }, { member_id: m.V }] })]);

    const seen = async (sql) => {
      const r = await h.as(BORYA, sql, [pid]);
      assert.ok(r.ok, r.error);
      return r.rows;
    };
    assert.deepEqual((await seen(`SELECT seq FROM public.project_periods WHERE project_id = $1 ORDER BY seq`)).map((r) => r.seq), [1, 2]);
    const early = (await h.admin(`SELECT id FROM public.project_periods WHERE project_id = $1 AND seq <= 2`, [pid])).map((r) => r.id);
    for (const t of ['project_operations', 'project_quantities', 'project_contribution_ledger', 'project_transfers']) {
      const rows = await seen(`SELECT period_id FROM public.${t} WHERE project_id = $1`);
      const all = await h.admin(`SELECT period_id FROM public.${t} WHERE project_id = $1 AND period_id = ANY ($2)`, [pid, early]);
      assert.equal(rows.length, all.length, `${t}: вышедший видит не всё из периодов 1–2`);
      assert.ok(rows.every((r) => early.includes(r.period_id)), `${t}: вышедший видит строки после выхода`);
    }
    assert.equal((await seen(`SELECT 1 FROM public.project_transfers WHERE project_id = $1`)).length, 1, 'отметка периода 2 видна, периода 3 — нет');
    const terms = (await seen(`SELECT id FROM public.project_terms WHERE project_id = $1`)).map((r) => r.id);
    assert.deepEqual(terms, [(await h.admin(`SELECT terms_id FROM public.project_periods WHERE id = $1`, [p2]))[0].terms_id]);
    assert.ok(!terms.includes(future) && !terms.includes(tid), 'условия после выхода не видны');
    assert.ok((await seen(`SELECT terms_id FROM public.project_term_lines WHERE project_id = $1`)).every((r) => terms.includes(r.terms_id)));
    assert.ok((await seen(`SELECT terms_id FROM public.project_term_approvals WHERE project_id = $1`)).every((r) => terms.includes(r.terms_id)));
    assert.deepEqual(await seen(`SELECT 1 FROM public.project_invites WHERE project_id = $1`), [], 'ссылки-приглашения не видны');
    const audit = (await seen(`SELECT action FROM public.project_audit WHERE project_id = $1 ORDER BY id`)).map((r) => r.action);
    assert.equal(audit.at(-1), 'period_closed', 'история — до выхода включительно');
    assert.equal(audit.filter((a) => a === 'period_closed').length, 2);
    assert.equal(audit.filter((a) => a === 'transfer_marked').length, 0, 'отметки — уже после выхода');
  });

  test('вердикт r2: доход периода 3 в одной транзакции с итогом выхода — вышедший его не видит, свою историю видит', async () => {
    const equal = (m) => ({ remainder_method: 'equal', lines: [{ member_id: m.A }, { member_id: m.B }, { member_id: m.V }] });
    const { pid, m } = await team(db, { terms: equal });
    const op1 = await h.ok(VIKA, ADD_OP, [pid, 'income', 30_000, m.V, null]);
    await closeNow(db, ANYA, pid);
    const tid = await h.ok(BORYA, PROPOSE, [pid, JSON.stringify({
      remainder_method: 'equal',
      lines: [{ member_id: m.A }, { member_id: m.B, leaves: true, in_remainder: false }, { member_id: m.V }],
    })]);
    await h.ok(ANYA, ACCEPT, [tid]);
    await h.ok(VIKA, ACCEPT, [tid]);
    const op2 = await h.ok(VIKA, ADD_OP, [pid, 'income', 60_000, m.V, null]);

    // now() одинаков во всей транзакции: граница по времени тут не работает.
    await db.exec('BEGIN');
    await closeNow(db, ANYA, pid);
    const op3 = await h.ok(VIKA, ADD_OP, [pid, 'income', 100_000, m.V, null]);
    await db.exec('COMMIT');
    assert.equal((await h.admin(`SELECT status FROM public.project_members WHERE id = $1`, [m.B]))[0].status, 'left');

    const r = await h.as(BORYA, `SELECT action, payload FROM public.project_audit WHERE project_id = $1 ORDER BY id`, [pid]);
    assert.ok(r.ok, r.error);
    const opIds = r.rows.filter((x) => x.action === 'operation_added').map((x) => x.payload.operation_id);
    assert.ok(!opIds.includes(op3), 'вышедший видит доход периода 3');
    assert.ok(!r.rows.some((x) => x.payload.amount === 100_000), 'сумма периода 3 видна вышедшему');
    assert.deepEqual(opIds, [op1, op2], 'операции своих периодов видны');
    assert.deepEqual(r.rows.filter((x) => x.action === 'period_closed').map((x) => x.payload.seq), [1, 2]);
    assert.equal(r.rows.at(-1).action, 'period_closed', 'история — до итога выхода включительно');
  });

  test('последнее согласие отклоняется, если долг вырос выше X', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    await closeNow(db, ANYA, pid); // пустой период 1: долг Бори 30 000
    const tA = await h.ok(ANYA, PROPOSE, [pid, JSON.stringify(MIXED(m, { [m.B]: { contrib_new: 500_000 } }))]);
    await h.ok(BORYA, ACCEPT, [tA]);
    await h.ok(VIKA, ACCEPT, [tA]);
    const off = MIXED(m, { [m.B]: { contrib_new: 0, debt_write_off: 3_000_000 } });
    off.contrib_enabled = false;
    const tB = await h.ok(ANYA, PROPOSE, [pid, JSON.stringify(off)]);
    await h.ok(BORYA, ACCEPT, [tB]);
    await closeNow(db, ANYA, pid); // вступает версия A: долг 30 000 + 5 000
    assert.equal((await ledgerBalance(db, pid))[m.B], 3_500_000);
    await h.fails(VIKA, ACCEPT, [tB], /Боря: долг вырос до 35 000 ₽ — предложите условия заново/);
    const [t] = await h.admin(`SELECT status FROM public.project_terms WHERE id = $1`, [tB]);
    assert.equal(t.status, 'proposed', 'отклонённое согласие ничего не меняет');
  });
});

describe('set_quantity', () => {
  let db;
  let h;
  let ctx;
  before(async () => {
    db = await newDb();
    h = bind(db);
    ctx = await team(db, {
      guests: ['Саша'],
      terms: (m) => ({
        remainder_method: 'equal',
        lines: [
          { member_id: m.A, rate_type: 'fixed', rate_amount: 100 },
          { member_id: m.B, rate_type: 'piece', rate_amount: 400_000 },
          { member_id: m.V, rate_type: 'hourly', rate_amount: 150_000 },
          { member_id: m.guests[0], rate_type: 'hourly', rate_amount: 100_000 },
        ],
      }),
    });
  });

  test('за себя — ок; за другого с аккаунтом — отказ всем, включая владельца', async () => {
    const { pid, m } = ctx;
    await h.ok(VIKA, SET_QTY, [pid, m.V, 1000, null]);
    await h.fails(BORYA, SET_QTY, [pid, m.V, 1000, null], /только за себя/);
    await h.fails(ANYA, SET_QTY, [pid, m.V, 1000, null], /только за себя/);
  });

  test('за гостя — только владелец; в истории — кто и за кого', async () => {
    const { pid, m } = ctx;
    await h.fails(VIKA, SET_QTY, [pid, m.guests[0], 500, null], /только за себя/);
    await h.ok(ANYA, SET_QTY, [pid, m.guests[0], 500, null]);
    const [audit] = await h.admin(
      `SELECT actor_id, payload FROM public.project_audit WHERE project_id = $1 AND action = 'quantity_set' ORDER BY id DESC LIMIT 1`,
      [pid],
    );
    assert.equal(audit.actor_id, ANYA);
    assert.equal(audit.payload.member_id, m.guests[0]);
  });

  test('часы — только при ставке «за час» или остатке «по часам»; штуки — только при «за штуку»', async () => {
    const { pid, m } = ctx;
    await h.fails(ANYA, SET_QTY, [pid, m.A, 100, null], /Часы/);
    await h.fails(BORYA, SET_QTY, [pid, m.B, 100, null], /Часы/);
    await h.ok(BORYA, SET_QTY, [pid, m.B, null, 250]);
    await h.fails(VIKA, SET_QTY, [pid, m.V, null, 100], /Штуки/);
  });

  test('отрицательное количество и больше лимита — отказ', async () => {
    const { pid, m } = ctx;
    await h.fails(VIKA, SET_QTY, [pid, m.V, -1, null]);
    await h.fails(VIKA, SET_QTY, [pid, m.V, 1_000_000, null]);
    await h.fails(BORYA, SET_QTY, [pid, m.B, null, 100_000_001]);
  });

  test('после set_quantity итог по старому предпросмотру отклоняется', async () => {
    const { pid, m } = ctx;
    const rev = (await openPeriod(db, pid)).revision;
    await h.ok(VIKA, SET_QTY, [pid, m.V, 1200, null]);
    await h.fails(ANYA, CLOSE, [pid, rev], /Данные изменились/);
  });

  test('в закрытом периоде количество не меняется; часы при остатке «по часам» и ставке «за штуку» — можно', async () => {
    const { pid } = ctx;
    const closedPeriod = (await openPeriod(db, pid)).id;
    await closeNow(db, ANYA, pid);
    const r = await run(db, `UPDATE public.project_quantities SET hours = 1 WHERE period_id = $1`, [closedPeriod]);
    assert.equal(r.ok, false, 'количество закрытого периода изменилось');
    const byHours = await team(db, {
      terms: (mm) => ({ remainder_method: 'hours', lines: [{ member_id: mm.A }, { member_id: mm.B, rate_type: 'piece', rate_amount: 100 }, { member_id: mm.V }] }),
    });
    await h.ok(BORYA, SET_QTY, [byHours.pid, byHours.m.B, 700, 100]);
  });
});

describe('close_period: атомарность, сверка с ядром, переводы', () => {
  let db;
  let h;
  before(async () => {
    db = await newDb();
    h = bind(db);
  });

  test('§3а.4: снимок совпадает с calculatePeriod; Аня → Вика 41 000, Аня → Боря 10 000', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    await addOps(h, pid, BASE(m));
    await h.ok(VIKA, SET_QTY, [pid, m.V, 1000, null]);
    const snap = await closeNow(db, ANYA, pid);
    const calc = calculatePeriod({
      members: calcMembers(m),
      terms: MIXED_CALC(m),
      operations: BASE(m).map(([type, , memberId, amount]) => ({ type, memberId, amount })),
      quantities: { [m.V]: { hours: 1000 } },
      debtAtStart: { [m.B]: 3_000_000 },
    });
    assertMatchesCalc(snap, calc, m);
    assert.deepEqual(
      snap.transfers.map((t) => [t.from_member, t.to_member, Number(t.amount)]),
      [[m.A, m.V, 4_100_000], [m.A, m.B, 1_000_000]],
    );
    assert.deepEqual(snap.members.map((x) => Number(x.owed)), [6_900_000, 7_000_000, 4_100_000]);
    const [p1] = await h.admin(
      `SELECT status, snapshot IS NOT NULL AS has, closed_by FROM public.project_periods WHERE project_id = $1 AND seq = 1`,
      [pid],
    );
    assert.deepEqual(p1, { status: 'closed', has: true, closed_by: ANYA });
    assert.equal((await openPeriod(db, pid)).seq, 2);
  });

  test('§3а.5: три периода подряд, долг 30 000 → 10 000 → 10 000 → 0 как у ядра', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    const months = [
      { ops: OCTOBER(m), hours: 1000, debt: 1_000_000, owed: [1_500_000, 2_600_000, 900_000] },
      { ops: [['income', VIKA, m.V, 1_200_000], ['expense', BORYA, m.B, 2_000_000]], hours: 400, debt: 1_000_000, owed: [-320_000, 1_680_000, -160_000] },
      { ops: [['income', BORYA, m.B, 10_000_000]], hours: 700, debt: 0, owed: [4_380_000, 3_380_000, 2_240_000] },
    ];
    let debt = { [m.B]: 3_000_000 };
    for (const month of months) {
      await addOps(h, pid, month.ops);
      await h.ok(VIKA, SET_QTY, [pid, m.V, month.hours, null]);
      const snap = await closeNow(db, ANYA, pid);
      const calc = calculatePeriod({
        members: calcMembers(m),
        terms: MIXED_CALC(m),
        operations: month.ops.map(([type, , memberId, amount]) => ({ type, memberId, amount })),
        quantities: { [m.V]: { hours: month.hours } },
        debtAtStart: debt,
      });
      assertMatchesCalc(snap, calc, m);
      assert.deepEqual(snap.members.map((x) => Number(x.owed)), month.owed);
      const repaid = Object.fromEntries(Object.entries(calc.perPerson).map(([id, p]) => [id, p.contributionBack]));
      debt = closePeriodDebt({ members: calcMembers(m), debtAtStart: debt, repaid }).debtAtNextStart;
      assert.equal(debt[m.B], month.debt);
      assert.equal((await ledgerBalance(db, pid))[m.B], month.debt);
    }
    assert.deepEqual(await ledgerRows(db, pid), [['credit', 3_000_000], ['repay', 2_000_000], ['repay', 1_000_000]]);
  });

  test('§3а.6 «списание на границе»: repay 20 000 → write_off 10 000 → credit 5 000, долг 5 000', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    // В периоде 1 журнал ещё пуст: «списать до» больше нуля нельзя.
    const next = MIXED(m, { [m.B]: { contrib_new: 500_000, debt_write_off: 3_000_000 } });
    await h.fails(ANYA, PROPOSE, [pid, JSON.stringify(next)], /Можно списать не больше 0 ₽/);
    await closeNow(db, ANYA, pid); // пустой период 1: credit 30 000, возврата нет
    await addOps(h, pid, OCTOBER(m));
    const tid = await h.ok(ANYA, PROPOSE, [pid, JSON.stringify(next)]);
    await h.ok(BORYA, ACCEPT, [tid]);
    await h.ok(VIKA, ACCEPT, [tid]);
    const snap = await closeNow(db, ANYA, pid);
    assert.deepEqual(await ledgerRows(db, pid), [['credit', 3_000_000], ['repay', 2_000_000], ['write_off', 1_000_000], ['credit', 500_000]]);
    assert.equal((await ledgerBalance(db, pid))[m.B], 500_000);
    const core = closePeriodDebt({
      members: calcMembers(m),
      debtAtStart: { [m.B]: 3_000_000 },
      repaid: { [m.B]: 2_000_000 },
      nextTerms: MIXED_CALC(m, { [m.B]: { contribNew: 500_000, debtWriteOff: 3_000_000 } }),
    });
    assert.deepEqual(snap.ledger.map((e) => [e.kind, Number(e.amount)]), core.entries.map((e) => [e.kind, e.amount]));
    assert.equal(core.debtAtNextStart[m.B], 500_000);
  });

  test('сбой на любом шаге — не меняется ничего', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    await h.ok(ANYA, ADD_OP, [pid, 'income', 18_000_000, m.A, null]);
    const before = await fingerprint(db);
    for (const table of ['project_periods', 'project_contribution_ledger', 'project_audit']) {
      await db.exec(`
        CREATE FUNCTION public.test_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
        CREATE TRIGGER test_boom BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.test_boom();
      `);
      await h.fails(ANYA, CLOSE, [pid, (await openPeriod(db, pid)).revision], /boom/);
      await db.exec(`DROP TRIGGER test_boom ON public.${table}; DROP FUNCTION public.test_boom();`);
      assert.deepEqual(await fingerprint(db), before, `сбой в ${table} оставил следы`);
    }
    await closeNow(db, ANYA, pid);
  });

  test('закрыть может только владелец; по устаревшей ревизии — отказ', async () => {
    const { pid, m } = await team(db, { terms: MIXED });
    const rev = (await openPeriod(db, pid)).revision;
    await h.fails(BORYA, CLOSE, [pid, rev], /владелец/);
    await h.ok(VIKA, ADD_OP, [pid, 'income', 100, m.V, null]);
    await h.fails(ANYA, CLOSE, [pid, rev], /Данные изменились — посмотрите итог ещё раз/);
  });

  test('вердикт п.4: замена условий периода 1 после предпросмотра — закрытие по старой ревизии отклонено, деньги не уходят гостю', async () => {
    const pid = await h.ok(ANYA, `SELECT public.create_project('Ярмарка', 'RUB', ARRAY['Саша'], $1::jsonb) AS v`, [
      JSON.stringify({ remainder_method: 'equal', lines: [{ position: 1 }, { position: 2, in_remainder: false }] }),
    ]);
    const [mA, mG] = (await h.admin(`SELECT id FROM public.project_members WHERE project_id = $1 ORDER BY position`, [pid])).map((r) => r.id);
    await h.ok(ANYA, ADD_OP, [pid, 'income', 10_000, mG, null]);
    const rev = (await openPeriod(db, pid)).revision; // предпросмотр: всё Ане
    const swapped = await h.ok(ANYA, PROPOSE, [pid, JSON.stringify({
      remainder_method: 'equal', lines: [{ member_id: mA, in_remainder: false }, { member_id: mG }],
    })]);
    assert.equal((await openPeriod(db, pid)).terms_id, swapped, 'условия периода 1 заменены');
    const before = await fingerprint(db);
    await h.fails(ANYA, CLOSE, [pid, rev], /Данные изменились — посмотрите итог ещё раз/);
    assert.deepEqual(await fingerprint(db), before, 'ничего не записано');
    assert.equal((await openPeriod(db, pid)).seq, 1);
  });

  test('ревизию меняют вход участника и принятие условий следующего периода', async () => {
    const { pid, m, code } = await team(db, { terms: MIXED });
    await closeNow(db, ANYA, pid);
    // Период 2: согласия на действующие условия не нужны — мешать может только ревизия.
    let rev = (await openPeriod(db, pid)).revision;
    await h.ok(GONE, `SELECT public.join_project_by_invite($1) AS v`, [code]);
    await h.fails(ANYA, CLOSE, [pid, rev], /Данные изменились/);
    const [{ id: mG }] = await h.admin(`SELECT id FROM public.project_members WHERE project_id = $1 AND user_id = $2`, [pid, GONE]);
    rev = (await openPeriod(db, pid)).revision;
    const next = MIXED(m, { [m.B]: { contrib_new: 0 } });
    next.lines.push({ member_id: mG, in_remainder: false });
    const tid = await h.ok(ANYA, PROPOSE, [pid, JSON.stringify(next)]);
    for (const u of [BORYA, VIKA]) await h.ok(u, ACCEPT, [tid]);
    assert.equal((await openPeriod(db, pid)).revision, rev, 'пока не все согласны — расчёт не меняется');
    await h.ok(GONE, ACCEPT, [tid]);
    await h.fails(ANYA, CLOSE, [pid, rev], /Данные изменились/);
  });

  test('mark_transfer_paid: по закрытому периоду и только по снимку', async () => {
    const { pid, m } = await team(db, { terms: MIXED, guests: ['Саша'] });
    await addOps(h, pid, BASE(m));
    await h.ok(VIKA, SET_QTY, [pid, m.V, 1000, null]);
    const snap = await closeNow(db, ANYA, pid);
    await h.fails(VIKA, MARK, [snap.period_id, m.A, m.V], /отправитель/);
    await h.fails(ANYA, MARK, [snap.period_id, m.A, m.guests[0]], /нет в итоге/);
    await h.fails(ANYA, MARK, [(await openPeriod(db, pid)).id, m.A, m.V], /не закрыт/);
    const id = await h.ok(ANYA, MARK, [snap.period_id, m.A, m.V]);
    assert.equal(await h.ok(ANYA, MARK, [snap.period_id, m.A, m.V]), id, 'повторная отметка не создаёт вторую');
    const [t] = await h.admin(`SELECT amount::bigint AS amount, marked_by FROM public.project_transfers WHERE id = $1`, [id]);
    assert.deepEqual([Number(t.amount), t.marked_by], [4_100_000, ANYA]);
  });

  test('гость: доход, возврат, ставка (часы вносит владелец), перевод отмечает любой участник', async () => {
    const { pid, m } = await team(db, {
      guests: ['Саша'],
      terms: (mm) => ({
        remainder_method: 'equal',
        lines: [{ member_id: mm.A }, { member_id: mm.B }, { member_id: mm.V }, { member_id: mm.guests[0], rate_type: 'hourly', rate_amount: 100_000 }],
      }),
    });
    const g = m.guests[0];
    const inc = await h.ok(BORYA, ADD_OP, [pid, 'income', 3_000_000, g, null]);
    await h.ok(BORYA, ADD_OP, [pid, 'income_refund', 600_000, g, inc]);
    await h.ok(ANYA, SET_QTY, [pid, g, 300, null]);
    const snap = await closeNow(db, ANYA, pid);
    const gs = snap.members.find((x) => x.member_id === g);
    assert.equal(Number(gs.rate), 300_000);
    assert.equal(Number(gs.on_hand), 2_400_000);
    const tr = snap.transfers.find((t) => t.from_member === g);
    assert.ok(tr, 'гость отдаёт');
    await h.ok(VIKA, MARK, [snap.period_id, g, tr.to_member]);
  });

  test('история: условия, согласия, количества, итог, отметки', async () => {
    const actions = (await h.admin(`SELECT DISTINCT action FROM public.project_audit`)).map((r) => r.action);
    for (const act of ['terms_proposed', 'terms_accepted', 'terms_activated', 'quantity_set', 'period_closed', 'transfer_marked']) {
      assert.ok(actions.includes(act), `нет записи ${act}`);
    }
  });
});

describe('совместимость и откат', () => {
  test('таблицы событий проекты не содержат: запросы 1.0.4 их не видят', async () => {
    const db = await newDb();
    await team(db, { terms: MIXED });
    const [g] = (await db.query(
      `SELECT (SELECT count(*) FROM public.groups)::int AS groups, (SELECT count(*) FROM public.group_members)::int AS gm,
              (SELECT count(*) FROM public.expenses)::int AS ex, (SELECT count(*) FROM public.settlements)::int AS st`,
    )).rows;
    assert.deepEqual(g, { groups: 0, gm: 0, ex: 0, st: 0 });
  });

  test('откат: функции проекта недоступны, данные целы, удалённый аккаунт по-прежнему без доступа', async () => {
    const db = await newDb();
    const h = bind(db);
    const { pid, m, code } = await team(db, { terms: MIXED, extraUsers: [GONE] });
    await h.ok(ANYA, ADD_OP, [pid, 'income', 100, m.A, null]);
    await h.ok(GONE, `SELECT public.delete_my_account() AS v`);
    const before = await fingerprint(db);
    await db.exec(readFileSync(path.join(process.cwd(), 'supabase', 'rollback', '20261101000000_projects.down.sql'), 'utf-8'));
    assert.deepEqual(await fingerprint(db), before, 'откат не трогает данные');
    for (const uid of [ANYA, GONE]) {
      for (const t of TABLES) {
        const r = await h.as(uid, `SELECT * FROM public.${t}`);
        assert.ok(!r.ok || r.rows.length === 0, `${t}: после отката видно ${uid}`);
      }
      assert.equal((await h.as(uid, ADD_OP, [pid, 'income', 100, m.A, null])).ok, false);
    }
    const r = await asAnon(db, () => run(db, `SELECT public.preview_project_invite($1)`, [code]));
    assert.equal(r.ok, false);
  });
});
