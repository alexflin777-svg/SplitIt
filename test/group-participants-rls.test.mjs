/**
 * Контракт Этапа 1 group_participants: финансовый участник рядом со старой
 * моделью group_members.
 *
 * Запуск: node --test test/group-participants-rls.test.mjs
 *
 * Сценарий: две группы, один и тот же профиль (Алиса) состоит в обеих.
 * Group1 — Алиса владелец, Боб участник. Group2 — Дэйв владелец, Алиса
 * участник. Это единственный способ честно проверить «один profile —
 * разные participant ID в разных группах» и «participant чужой группы
 * нельзя подставить».
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations, asUser, attempt } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CAROL = '33333333-3333-3333-3333-333333333333';
const DAVE = '44444444-4444-4444-4444-444444444444';
// Ева присоединяется к группе 1, платит, делится с Бобом, потом уходит из
// group_members ДО применения миграции — деньги остаются, членство нет.
// Это единственный честный способ проверить "departed participant".
const EVE = '55555555-5555-5555-5555-555555555555';

const TARGET_MIGRATION_FILE = '20260802000000_group_participants.sql';

/**
 * pg-harness.createTestDatabase() applies every migration before any test
 * inserts a row, so it can never exercise a backfill migration against
 * pre-existing data — exactly the situation this migration is written for
 * (production already has group_members rows when it is applied). This
 * harness rebuilds the same auth shim, applies every migration up to but
 * excluding the target, lets the test seed data through the same RPCs real
 * traffic uses, and only then applies the target migration so its backfill
 * runs against real pre-existing rows instead of an empty database.
 */
const SUPABASE_SHIM = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE SQL STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Supabase project provisioning sets these default privileges once, outside
-- any migration: every table created afterwards in "public" — including
-- group_participants, created by the target migration itself — picks up
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE for anon and authenticated the moment
-- CREATE TABLE runs, before any REVOKE in that same migration executes. A
-- harness that never grants these leaves "authenticated only has SELECT"
-- vacuously true even with no REVOKE at all in the migration, which is
-- exactly how the previous candidate's RLS gate passed without one.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon, authenticated, service_role;
`;

async function createDatabaseBeforeTargetMigration() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);

  const migrations = readMigrations();
  const targetIndex = migrations.findIndex((m) => m.file === TARGET_MIGRATION_FILE);
  if (targetIndex === -1) {
    throw new Error(`${TARGET_MIGRATION_FILE} не найдена среди миграций`);
  }

  for (const { file, sql } of migrations.slice(0, targetIndex)) {
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Миграция ${file} не применилась: ${e.message}`);
    }
  }

  return { db, targetMigration: migrations[targetIndex] };
}

let db;
let group1; // Алиса — owner, Боб — member
let group2; // Дэйв — owner, Алиса — member
let group1Expense;
let group1Settlement;
let group2Expense;
let group2Settlement;
let group1DepartedExpense; // Ева платит, потом покидает группу до миграции
let group1OutsiderSettlement; // Кэрол — payee, никогда не была участником group1
let preMigrationSnapshot;

/**
 * Точный slice legacy денежных таблиц: id, стороны и суммы. Используется
 * и до, и после применения миграции — additive backfill не имеет права
 * менять здесь ни одну строку.
 */
async function snapshotMoneyRows(database) {
  const expenses = await database.query(
    `SELECT id::text, group_id::text, paid_by_id::text, amount_in_group_currency::numeric AS amount
     FROM public.expenses ORDER BY id`,
  );
  const splits = await database.query(
    `SELECT id::text, expense_id::text, user_id::text, amount_owed::numeric AS amount
     FROM public.expense_splits ORDER BY id`,
  );
  const settlements = await database.query(
    `SELECT id::text, group_id::text, payer_id::text, payee_id::text, amount::numeric AS amount
     FROM public.settlements ORDER BY id`,
  );
  return { expenses: expenses.rows, splits: splits.rows, settlements: settlements.rows };
}

before(async () => {
  const setup = await createDatabaseBeforeTargetMigration();
  db = setup.db;

  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Алиса', 'alice@example.com'),
       ($2, 'Боб', 'bob@example.com'),
       ($3, 'Кэрол', 'carol@example.com'),
       ($4, 'Дэйв', 'dave@example.com'),
       ($5, 'Ева', 'eve@example.com')`,
    [ALICE, BOB, CAROL, DAVE, EVE],
  );

  group1 = await asUser(db, ALICE, async () => {
    const r = await db.query(
      `SELECT public.create_group_with_owner('Группа 1', 'trip', 'RUB')::text AS id`,
    );
    return r.rows[0].id;
  });
  await asUser(db, ALICE, () =>
    db.query(
      `INSERT INTO public.group_invites (group_id, invite_code, created_by) VALUES ($1, 'G1-BOB', $2)`,
      [group1, ALICE],
    ),
  );
  await asUser(db, BOB, () => db.query(`SELECT public.redeem_group_invite('G1-BOB')`));

  group2 = await asUser(db, DAVE, async () => {
    const r = await db.query(
      `SELECT public.create_group_with_owner('Группа 2', 'trip', 'RUB')::text AS id`,
    );
    return r.rows[0].id;
  });
  await asUser(db, DAVE, () =>
    db.query(
      `INSERT INTO public.group_invites (group_id, invite_code, created_by) VALUES ($1, 'G2-ALICE', $2)`,
      [group2, DAVE],
    ),
  );
  await asUser(db, ALICE, () => db.query(`SELECT public.redeem_group_invite('G2-ALICE')`));

  // Group1: Алиса платит 1000, делится поровну с Бобом.
  const e1 = await asUser(db, ALICE, () =>
    db.query(
      `SELECT public.add_expense_with_splits(
         $1, 'Аренда', 1000, 'RUB', 1000, 'trip', $2,
         '[{"user_id":"11111111-1111-1111-1111-111111111111","amount_owed":500},
           {"user_id":"22222222-2222-2222-2222-222222222222","amount_owed":500}]'::jsonb,
         NOW()
       )::text AS id`,
      [group1, ALICE],
    ),
  );
  group1Expense = e1.rows[0].id;

  group1Settlement = await asUser(db, BOB, async () => {
    const r = await db.query(
      `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount)
       VALUES ($1, $2, $3, 500) RETURNING id::text`,
      [group1, BOB, ALICE],
    );
    return r.rows[0].id;
  });

  // Group2: Дэйв платит 400, делится поровну с Алисой.
  const e2 = await asUser(db, DAVE, () =>
    db.query(
      `SELECT public.add_expense_with_splits(
         $1, 'Такси', 400, 'RUB', 400, 'transport', $2,
         '[{"user_id":"44444444-4444-4444-4444-444444444444","amount_owed":200},
           {"user_id":"11111111-1111-1111-1111-111111111111","amount_owed":200}]'::jsonb,
         NOW()
       )::text AS id`,
      [group2, DAVE],
    ),
  );
  group2Expense = e2.rows[0].id;

  group2Settlement = await asUser(db, ALICE, async () => {
    const r = await db.query(
      `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount)
       VALUES ($1, $2, $3, 200) RETURNING id::text`,
      [group2, ALICE, DAVE],
    );
    return r.rows[0].id;
  });

  // Ева вступает в group1, платит за такси, делится с Бобом — на этот
  // момент она полноправный member, add_expense_with_splits это требует.
  await asUser(db, ALICE, () =>
    db.query(
      `INSERT INTO public.group_invites (group_id, invite_code, created_by) VALUES ($1, 'G1-EVE', $2)`,
      [group1, ALICE],
    ),
  );
  await asUser(db, EVE, () => db.query(`SELECT public.redeem_group_invite('G1-EVE')`));

  const departed = await asUser(db, EVE, () =>
    db.query(
      `SELECT public.add_expense_with_splits(
         $1, 'Такси в аэропорт', 300, 'RUB', 300, 'transport', $2,
         '[{"user_id":"55555555-5555-5555-5555-555555555555","amount_owed":150},
           {"user_id":"22222222-2222-2222-2222-222222222222","amount_owed":150}]'::jsonb,
         NOW()
       )::text AS id`,
      [group1, EVE],
    ),
  );
  group1DepartedExpense = departed.rows[0].id;

  // Аутсайдер: settlements_insert_payer проверяет членство только у payer,
  // не у payee, поэтому Боб может честно записать перевod Кэрол, которая
  // никогда не вступала в group1 через group_members.
  group1OutsiderSettlement = await asUser(db, BOB, async () => {
    const r = await db.query(
      `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount)
       VALUES ($1, $2, $3, 100) RETURNING id::text`,
      [group1, BOB, CAROL],
    );
    return r.rows[0].id;
  });

  // Ева покидает группу до применения миграции: авторизация уходит, деньги
  // остаются — ровно ситуация, из-за которой backfill только по
  // group_members теряет ссылку.
  await db.query(`DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2`, [
    group1,
    EVE,
  ]);

  preMigrationSnapshot = await snapshotMoneyRows(db);

  // Group1 и Group2 с их расходами и переводами уже существуют — ровно та
  // ситуация, для которой писался backfill. Применяем миграцию только теперь.
  try {
    await db.exec(setup.targetMigration.sql);
  } catch (e) {
    throw new Error(`Миграция ${setup.targetMigration.file} не применилась: ${e.message}`);
  }
});

after(async () => {
  await db?.close();
});

describe('Backfill participants из group_members', () => {
  test('на каждого текущего участника group_members создан account participant', async () => {
    // Подмножество, а не точное равенство: group1 после миграции также
    // содержит participant для Евы (ушла из group_members) и Кэрол
    // (payee-аутсайдер) — это отдельно проверяется ниже, в
    // "Backfill покрывает departed participant и outsider legacy money side".
    // Здесь проверяется только то, что ни один ТЕКУЩИЙ member не потерялся.
    const g1Members = await db.query(
      `SELECT user_id::text AS profile_id FROM public.group_members WHERE group_id = $1`,
      [group1],
    );
    const g1Participants = await db.query(
      `SELECT profile_id::text, kind FROM public.group_participants WHERE group_id = $1`,
      [group1],
    );
    const g1ParticipantProfiles = new Set(g1Participants.rows.map((r) => r.profile_id));
    for (const m of g1Members.rows) {
      assert.ok(g1ParticipantProfiles.has(m.profile_id), `нет participant для текущего участника ${m.profile_id}`);
    }
    assert.ok(g1Participants.rows.every((r) => r.kind === 'account'));
    assert.deepEqual(g1Members.rows.map((r) => r.profile_id).sort(), [ALICE, BOB].sort());

    const g2Members = await db.query(
      `SELECT user_id::text AS profile_id FROM public.group_members WHERE group_id = $1`,
      [group2],
    );
    const g2Participants = await db.query(
      `SELECT profile_id::text, kind FROM public.group_participants WHERE group_id = $1`,
      [group2],
    );
    const g2ParticipantProfiles = new Set(g2Participants.rows.map((r) => r.profile_id));
    for (const m of g2Members.rows) {
      assert.ok(g2ParticipantProfiles.has(m.profile_id), `нет participant для текущего участника ${m.profile_id}`);
    }
    assert.deepEqual(g2Members.rows.map((r) => r.profile_id).sort(), [ALICE, DAVE].sort());
  });

  test('один profile в двух группах получает разные participant ID', async () => {
    const rows = await db.query(
      `SELECT id::text, group_id::text FROM public.group_participants WHERE profile_id = $1`,
      [ALICE],
    );
    assert.equal(rows.rows.length, 2, 'у Алисы должно быть ровно два participant');
    assert.notEqual(rows.rows[0].id, rows.rows[1].id);
    assert.deepEqual(
      rows.rows.map((r) => r.group_id).sort(),
      [group1, group2].sort(),
    );
  });

  test('display_name и avatar_url взяты из profiles на момент backfill', async () => {
    const row = await db.query(
      `SELECT display_name FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group1, ALICE],
    );
    assert.equal(row.rows[0].display_name, 'Алиса');
  });
});

describe('Backfill ссылок в expenses/expense_splits/settlements', () => {
  test('expenses.paid_by_participant_id указывает на participant той же группы и профиля', async () => {
    const row = await db.query(
      `SELECT e.paid_by_participant_id::text AS pid, gp.group_id::text AS gp_group, gp.profile_id::text AS gp_profile
       FROM public.expenses e
       JOIN public.group_participants gp ON gp.id = e.paid_by_participant_id
       WHERE e.id = $1`,
      [group1Expense],
    );
    assert.equal(row.rows.length, 1, 'ссылка не проставлена');
    assert.equal(row.rows[0].gp_group, group1);
    assert.equal(row.rows[0].gp_profile, ALICE);
  });

  test('expense_splits.group_id и participant_id backfilled для каждой доли', async () => {
    const rows = await db.query(
      `SELECT es.participant_id::text AS pid, es.group_id::text AS gid, gp.profile_id::text AS profile
       FROM public.expense_splits es
       JOIN public.group_participants gp ON gp.id = es.participant_id
       WHERE es.expense_id = $1
       ORDER BY gp.profile_id`,
      [group1Expense],
    );
    assert.equal(rows.rows.length, 2, 'обе доли должны получить participant_id');
    assert.ok(rows.rows.every((r) => r.gid === group1));
    assert.deepEqual(
      rows.rows.map((r) => r.profile).sort(),
      [ALICE, BOB].sort(),
    );
  });

  test('settlements.payer_participant_id/payee_participant_id backfilled', async () => {
    const row = await db.query(
      `SELECT s.payer_participant_id::text AS payer_pid, s.payee_participant_id::text AS payee_pid,
              payer.profile_id::text AS payer_profile, payee.profile_id::text AS payee_profile
       FROM public.settlements s
       JOIN public.group_participants payer ON payer.id = s.payer_participant_id
       JOIN public.group_participants payee ON payee.id = s.payee_participant_id
       WHERE s.id = $1`,
      [group1Settlement],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].payer_profile, BOB);
    assert.equal(row.rows[0].payee_profile, ALICE);
  });

  test('вторая группа backfilled независимо от первой', async () => {
    const row = await db.query(
      `SELECT gp.group_id::text AS gid FROM public.expenses e
       JOIN public.group_participants gp ON gp.id = e.paid_by_participant_id
       WHERE e.id = $1`,
      [group2Expense],
    );
    assert.equal(row.rows[0].gid, group2);
  });
});

describe('Composite FK отклоняет participant другой группы', () => {
  test('expenses.paid_by_participant_id из чужой группы отклоняется', async () => {
    const aliceInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, ALICE],
    );
    const foreignParticipantId = aliceInGroup2.rows[0].id;

    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `UPDATE public.expenses SET paid_by_participant_id = $1 WHERE id = $2`,
        [foreignParticipantId, group1Expense],
      ),
    );
    assert.equal(res.ok, false, 'участник другой группы подставился в expense');
  });

  test('expense_splits.participant_id из чужой группы отклоняется', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    const foreignParticipantId = daveInGroup2.rows[0].id;

    const split = await db.query(
      `SELECT id::text FROM public.expense_splits WHERE expense_id = $1 LIMIT 1`,
      [group1Expense],
    );

    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `UPDATE public.expense_splits SET participant_id = $1 WHERE id = $2`,
        [foreignParticipantId, split.rows[0].id],
      ),
    );
    assert.equal(res.ok, false, 'участник другой группы подставился в split');
  });

  test('settlements.payer_participant_id из чужой группы отклоняется', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    const foreignParticipantId = daveInGroup2.rows[0].id;

    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `UPDATE public.settlements SET payer_participant_id = $1 WHERE id = $2`,
        [foreignParticipantId, group1Settlement],
      ),
    );
    assert.equal(res.ok, false, 'плательщик другой группы подставился в перевод');
  });

  test('settlements.payee_participant_id из чужой группы отклоняется', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    const foreignParticipantId = daveInGroup2.rows[0].id;

    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `UPDATE public.settlements SET payee_participant_id = $1 WHERE id = $2`,
        [foreignParticipantId, group1Settlement],
      ),
    );
    assert.equal(res.ok, false, 'получатель другой группы подставился в перевод');
  });
});

describe('RLS group_participants: authenticated только SELECT своей группы', () => {
  test('участник видит participants своей группы', async () => {
    const rows = await asUser(db, ALICE, async () => {
      const r = await db.query(
        `SELECT profile_id::text FROM public.group_participants WHERE group_id = $1 ORDER BY profile_id`,
        [group1],
      );
      return r.rows.map((x) => x.profile_id);
    });
    // ALICE и BOB — текущие участники; CAROL (payee-аутсайдер) и EVE
    // (ушла из группы) — participants только по деньгам, но их всё равно
    // видит любой текущий участник группы (participant отвечает за деньги,
    // а не за доступ — доступ к SELECT определяет is_group_member(group_id)
    // самого читающего, не читаемой строки).
    assert.deepEqual(rows.sort(), [ALICE, BOB, CAROL, EVE].sort());
  });

  test('чужие participants невидимы', async () => {
    const rows = await asUser(db, BOB, async () => {
      const r = await db.query(`SELECT id FROM public.group_participants WHERE group_id = $1`, [group2]);
      return r.rows;
    });
    assert.deepEqual(rows, [], 'Боб видит participants чужой группы');
  });

  test('посторонний (не участник ни одной группы) не видит ничего', async () => {
    const rows = await asUser(db, CAROL, async () => {
      const r = await db.query(`SELECT id FROM public.group_participants`);
      return r.rows;
    });
    assert.deepEqual(rows, []);
  });

  test('authenticated не может вставить participant напрямую', async () => {
    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
         VALUES ($1, $2, 'Подлог', 'account', $2)`,
        [group1, CAROL],
      ),
    );
    assert.equal(res.ok, false, 'прямой INSERT participant прошёл');
    assert.match(res.error, /permission denied/i, `отклонено не привилегией: ${res.error}`);
  });

  test('authenticated не может изменить participant напрямую', async () => {
    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `UPDATE public.group_participants SET display_name = 'Взломано' WHERE group_id = $1 AND profile_id = $2`,
        [group1, ALICE],
      ),
    );
    assert.equal(res.ok, false, 'прямой UPDATE participant прошёл');
    assert.match(res.error, /permission denied/i, `отклонено не привилегией: ${res.error}`);

    const row = await db.query(
      `SELECT display_name FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group1, ALICE],
    );
    assert.equal(row.rows[0].display_name, 'Алиса', 'display_name изменился несмотря на отклонённый UPDATE');
  });

  test('authenticated не может удалить participant напрямую', async () => {
    const res = await asUser(db, ALICE, () =>
      attempt(db, `DELETE FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`, [
        group1,
        BOB,
      ]),
    );
    assert.equal(res.ok, false, 'прямой DELETE participant прошёл');
    assert.match(res.error, /permission denied/i, `отклонено не привилегией: ${res.error}`);

    const row = await db.query(
      `SELECT count(*)::int AS n FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group1, BOB],
    );
    assert.equal(row.rows[0].n, 1, 'participant удалён несмотря на отклонённый DELETE');
  });

  test('anon не видит participants и не имеет табличных прав', async () => {
    const exists = await db.query(
      `SELECT 1 AS present FROM pg_class WHERE relname = 'group_participants' AND relnamespace = 'public'::regnamespace`,
    );
    assert.equal(exists.rows.length, 1, 'таблица group_participants отсутствует');

    const grants = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'group_participants' AND grantee = 'anon'`,
    );
    assert.deepEqual(grants.rows, [], 'anon имеет права на group_participants');
  });
});

describe('Удаление профиля с ссылающимся participant запрещено', () => {
  test('DELETE profiles отклоняется при наличии participant', async () => {
    const res = await attempt(db, `DELETE FROM public.profiles WHERE id = $1`, [BOB]);
    assert.equal(res.ok, false, 'профиль с participant удалился');

    const stillThere = await db.query(`SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [BOB]);
    assert.equal(stillThere.rows[0].n, 1);
  });
});

describe('Backfill не меняет количество и суммы денежных строк', () => {
  test('group1: расходы, доли и переводы совпадают с тем, что было записано', async () => {
    const expenses = await db.query(
      `SELECT count(*)::int AS n, sum(amount_in_group_currency)::numeric AS total
       FROM public.expenses WHERE group_id = $1`,
      [group1],
    );
    // Аренда (1000) + такси Евы, оплаченное до её ухода (300).
    assert.equal(expenses.rows[0].n, 2);
    assert.equal(Number(expenses.rows[0].total), 1300);

    const splits = await db.query(
      `SELECT count(*)::int AS n, sum(amount_owed)::numeric AS total
       FROM public.expense_splits WHERE expense_id = $1`,
      [group1Expense],
    );
    assert.equal(splits.rows[0].n, 2);
    assert.equal(Number(splits.rows[0].total), 1000);

    const settlements = await db.query(
      `SELECT count(*)::int AS n, sum(amount)::numeric AS total
       FROM public.settlements WHERE group_id = $1`,
      [group1],
    );
    // Боб → Алиса (500) + Боб → Кэрол-аутсайдер (100).
    assert.equal(settlements.rows[0].n, 2);
    assert.equal(Number(settlements.rows[0].total), 600);
  });

  test('group2: расходы, доли и переводы совпадают с тем, что было записано', async () => {
    const expenses = await db.query(
      `SELECT count(*)::int AS n, sum(amount_in_group_currency)::numeric AS total
       FROM public.expenses WHERE group_id = $1`,
      [group2],
    );
    assert.equal(expenses.rows[0].n, 1);
    assert.equal(Number(expenses.rows[0].total), 400);

    const settlements = await db.query(
      `SELECT count(*)::int AS n, sum(amount)::numeric AS total
       FROM public.settlements WHERE group_id = $1`,
      [group2],
    );
    assert.equal(settlements.rows[0].n, 1);
    assert.equal(Number(settlements.rows[0].total), 200);
  });
});

describe('Catalog: RLS enabled и явные привилегии', () => {
  test('RLS включён на group_participants', async () => {
    const row = await db.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'group_participants' AND relnamespace = 'public'::regnamespace`,
    );
    assert.equal(row.rows[0].relrowsecurity, true);
  });

  test('authenticated имеет только SELECT на group_participants', async () => {
    const grants = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'group_participants' AND grantee = 'authenticated'
       ORDER BY privilege_type`,
    );
    assert.deepEqual(
      grants.rows.map((r) => r.privilege_type),
      ['SELECT'],
    );
  });

  test('на group_participants есть ровно одна SELECT-политика для authenticated', async () => {
    const policies = await db.query(
      `SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'group_participants'`,
    );
    assert.equal(policies.rows.length, 1);
    assert.equal(policies.rows[0].cmd, 'SELECT');
  });

  test('service_role имеет явный грант на group_participants (не полагаемся на BYPASSRLS)', async () => {
    const grants = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'group_participants' AND grantee = 'service_role'
       ORDER BY privilege_type`,
    );
    assert.ok(
      grants.rows.some((r) => r.privilege_type === 'SELECT'),
      'service_role не имеет явного табличного гранта — BYPASSRLS не заменяет GRANT',
    );
  });
});

describe('Backfill покрывает departed participant и outsider legacy money side (S1)', () => {
  test('Ева (ушла из group_members до миграции) всё равно получает account participant в group1', async () => {
    const participant = await db.query(
      `SELECT id::text, kind FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group1, EVE],
    );
    assert.equal(participant.rows.length, 1, 'у ушедшего участника нет participant — backfill смотрел только на group_members');
    assert.equal(participant.rows[0].kind, 'account');

    // Участие в group_members НЕ восстанавливается — participant отвечает за
    // деньги, а не за доступ.
    const membership = await db.query(
      `SELECT count(*)::int AS n FROM public.group_members WHERE group_id = $1 AND user_id = $2`,
      [group1, EVE],
    );
    assert.equal(membership.rows[0].n, 0, 'backfill сделал ушедшего снова участником группы');

    const expenseRef = await db.query(
      `SELECT paid_by_participant_id::text AS pid FROM public.expenses WHERE id = $1`,
      [group1DepartedExpense],
    );
    assert.equal(expenseRef.rows[0].pid, participant.rows[0].id, 'expenses.paid_by_participant_id не заполнен для ушедшего плательщика');

    const splitRef = await db.query(
      `SELECT participant_id::text AS pid FROM public.expense_splits WHERE expense_id = $1 AND user_id = $2`,
      [group1DepartedExpense, EVE],
    );
    assert.equal(splitRef.rows[0].pid, participant.rows[0].id, 'expense_splits.participant_id не заполнен для ушедшего участника доли');
  });

  test('Кэрол (payee перевода, никогда не была участником group1) получает account participant', async () => {
    const participant = await db.query(
      `SELECT id::text, kind FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group1, CAROL],
    );
    assert.equal(participant.rows.length, 1, 'у аутсайдера-получателя перевода нет participant');
    assert.equal(participant.rows[0].kind, 'account');

    const membership = await db.query(
      `SELECT count(*)::int AS n FROM public.group_members WHERE group_id = $1 AND user_id = $2`,
      [group1, CAROL],
    );
    assert.equal(membership.rows[0].n, 0, 'аутсайдер стал участником группы через backfill — этого не должно происходить');

    const settlementRef = await db.query(
      `SELECT payee_participant_id::text AS pid FROM public.settlements WHERE id = $1`,
      [group1OutsiderSettlement],
    );
    assert.equal(settlementRef.rows[0].pid, participant.rows[0].id, 'settlements.payee_participant_id не заполнен для аутсайдера');
  });
});

describe('Backfill: точный snapshot legacy денежных строк до/после миграции (S2)', () => {
  test('id, стороны и суммы каждой строки expenses/expense_splits/settlements не изменились', async () => {
    const after = await snapshotMoneyRows(db);
    assert.deepEqual(after.expenses, preMigrationSnapshot.expenses, 'additive backfill изменил строки expenses');
    assert.deepEqual(after.splits, preMigrationSnapshot.splits, 'additive backfill изменил строки expense_splits');
    assert.deepEqual(after.settlements, preMigrationSnapshot.settlements, 'additive backfill изменил строки settlements');
  });
});

describe('Catalog: ровно одна FK-связь expense_splits → expenses (S1, PostgREST embed)', () => {
  test('второй FK (expense_id, group_id) не должен существовать — иначе embed в GROUP_SELECT неоднозначен', async () => {
    const fks = await db.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.expense_splits'::regclass
         AND confrelid = 'public.expenses'::regclass
         AND contype = 'f'`,
    );
    assert.equal(
      fks.rows.length,
      1,
      `ожидалась ровно одна FK expense_splits→expenses, найдено ${fks.rows.length}: ${fks.rows.map((r) => r.conname).join(', ')}`,
    );
  });

  test('expense_splits.group_id всё равно обязан совпадать с group_id родительского expense', async () => {
    const split = await db.query(
      `SELECT id::text FROM public.expense_splits WHERE expense_id = $1 LIMIT 1`,
      [group1Expense],
    );
    const res = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.expense_splits SET group_id = $1 WHERE id = $2`, [group2, split.rows[0].id]),
    );
    assert.equal(res.ok, false, 'expense_splits.group_id принял значение, не совпадающее с group_id родительского expense');
  });
});

describe('Nullable MATCH FULL: group_id=NULL не должен обходить same-group FK (S1)', () => {
  test('expense_splits: group_id=NULL + participant_id чужой группы отклоняется', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    const split = await db.query(
      `SELECT id::text FROM public.expense_splits WHERE expense_id = $1 LIMIT 1`,
      [group1Expense],
    );
    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `UPDATE public.expense_splits SET group_id = NULL, participant_id = $1 WHERE id = $2`,
        [daveInGroup2.rows[0].id, split.rows[0].id],
      ),
    );
    assert.equal(res.ok, false, 'group_id=NULL с participant_id чужой группы прошёл — MATCH SIMPLE пропускает NULL-строку FK');
  });

  test('settlements: group_id=NULL + payer_participant_id чужой группы отклоняется', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `UPDATE public.settlements SET group_id = NULL, payer_participant_id = $1 WHERE id = $2`,
        [daveInGroup2.rows[0].id, group1Settlement],
      ),
    );
    assert.equal(res.ok, false, 'group_id=NULL с payer_participant_id чужой группы прошёл');
  });
});

describe('anon и service_role: поведенческая проверка, а не только каталог (S2)', () => {
  test('anon получает permission denied на реальном SELECT из group_participants', async () => {
    await db.exec('SET ROLE anon;');
    try {
      const res = await attempt(db, `SELECT * FROM public.group_participants LIMIT 1`);
      assert.equal(res.ok, false, 'anon смог выполнить SELECT из group_participants');
      assert.match(res.error, /permission denied/i, `отклонено не привилегией: ${res.error}`);
    } finally {
      await db.exec('RESET ROLE;');
    }
  });

  test('anon не может вставить participant напрямую', async () => {
    await db.exec('SET ROLE anon;');
    try {
      const res = await attempt(
        db,
        `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
         VALUES ($1, $2, 'Подлог', 'account', $2)`,
        [group1, CAROL],
      );
      assert.equal(res.ok, false, 'anon смог вставить participant');
      assert.match(res.error, /permission denied/i, `отклонено не привилегией: ${res.error}`);
    } finally {
      await db.exec('RESET ROLE;');
    }
  });

  test('service_role реально читает participants обеих групп в обход RLS', async () => {
    await db.exec('SET ROLE service_role;');
    try {
      const rows = await db.query(`SELECT group_id::text AS gid FROM public.group_participants`);
      const groups = new Set(rows.rows.map((r) => r.gid));
      assert.ok(groups.has(group1), 'service_role не видит участников group1');
      assert.ok(groups.has(group2), 'service_role не видит участников group2');
    } finally {
      await db.exec('RESET ROLE;');
    }
  });
});

describe('S1: CHECK запрещает group_id=NULL + participant любой группы даже под service_role', () => {
  // MATCH SIMPLE (expenses/settlements composite FK) пропускает строку без
  // проверки, если хотя бы один столбец пары NULL. RLS не защищает от этого,
  // потому что service_role её не видит вовсе — здесь нужен реальный
  // constraint failure, а не permission denied.
  test('expenses: group_id=NULL с paid_by_participant_id чужой группы отклоняется CHECK-ом', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    await db.exec('SET ROLE service_role;');
    try {
      const res = await attempt(
        db,
        `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
         VALUES (NULL, NULL, $1, 'Атака', 10, 10)`,
        [daveInGroup2.rows[0].id],
      );
      assert.equal(res.ok, false, 'service_role вставил expense с group_id=NULL и чужим paid_by_participant_id');
      assert.match(res.error, /check constraint/i, `отклонено не CHECK-ом: ${res.error}`);
    } finally {
      await db.exec('RESET ROLE;');
    }
  });

  test('settlements: group_id=NULL с payer_participant_id чужой группы отклоняется CHECK-ом', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    await db.exec('SET ROLE service_role;');
    try {
      const res = await attempt(
        db,
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, payer_participant_id)
         VALUES (NULL, NULL, NULL, 10, $1)`,
        [daveInGroup2.rows[0].id],
      );
      assert.equal(res.ok, false, 'service_role вставил settlement с group_id=NULL и чужим payer_participant_id');
      assert.match(res.error, /check constraint/i, `отклонено не CHECK-ом: ${res.error}`);
    } finally {
      await db.exec('RESET ROLE;');
    }
  });

  test('settlements: group_id=NULL с payee_participant_id чужой группы отклоняется CHECK-ом', async () => {
    const daveInGroup2 = await db.query(
      `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [group2, DAVE],
    );
    await db.exec('SET ROLE service_role;');
    try {
      const res = await attempt(
        db,
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, payee_participant_id)
         VALUES (NULL, NULL, NULL, 10, $1)`,
        [daveInGroup2.rows[0].id],
      );
      assert.equal(res.ok, false, 'service_role вставил settlement с group_id=NULL и чужим payee_participant_id');
      assert.match(res.error, /check constraint/i, `отклонено не CHECK-ом: ${res.error}`);
    } finally {
      await db.exec('RESET ROLE;');
    }
  });

  test('транзитное состояние (group_id задан, participant_id NULL) остаётся легальным', async () => {
    await db.exec('SET ROLE service_role;');
    try {
      const res = await attempt(
        db,
        `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
         VALUES ($1, NULL, 'Легаси', 10, 10)`,
        [group1],
      );
      assert.equal(res.ok, true, `легитимная транзитная строка отклонена: ${res.error}`);
    } finally {
      await db.exec('RESET ROLE;');
    }
  });
});

describe('Catalog: private trigger functions — SECURITY DEFINER/search_path/EXECUTE (S2 regression)', () => {
  const PRIVATE_TRIGGER_FUNCTIONS = ['check_expense_splits_group_id', 'forbid_expense_group_id_change'];

  for (const fn of PRIVATE_TRIGGER_FUNCTIONS) {
    test(`private.${fn} — SECURITY DEFINER и закреплённый search_path`, async () => {
      const row = await db.query(
        `SELECT prosecdef, proconfig
         FROM pg_proc
         WHERE proname = $1 AND pronamespace = 'private'::regnamespace`,
        [fn],
      );
      assert.equal(row.rows.length, 1, `private.${fn} не найдена`);
      assert.equal(row.rows[0].prosecdef, true, `private.${fn} не SECURITY DEFINER`);
      const config = row.rows[0].proconfig || [];
      assert.ok(
        config.some((c) => c.startsWith('search_path=')),
        `private.${fn} не закрепляет search_path`,
      );
    });

    test(`private.${fn} — нет EXECUTE у PUBLIC/anon/authenticated`, async () => {
      const grants = await db.query(
        `SELECT grantee::regrole::text AS grantee
         FROM information_schema.routine_privileges
         WHERE routine_schema = 'private' AND routine_name = $1`,
        [fn],
      );
      const grantees = grants.rows.map((r) => r.grantee);
      assert.ok(!grantees.includes('anon'), `private.${fn} даёт EXECUTE anon`);
      assert.ok(!grantees.includes('authenticated'), `private.${fn} даёт EXECUTE authenticated`);
      assert.ok(!grantees.includes('public'), `private.${fn} даёт EXECUTE PUBLIC`);
    });
  }
});

describe('Post-migration: старый клиент продолжает работать (S2 regression)', () => {
  test('add_expense_with_splits после миграции создаёт expense с транзитным NULL participant_id', async () => {
    const before = await db.query(`SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [group1]);

    const newExpense = await asUser(db, ALICE, () =>
      db.query(
        `SELECT public.add_expense_with_splits(
           $1, 'Кофе', 200, 'RUB', 200, 'food', $2,
           '[{"user_id":"11111111-1111-1111-1111-111111111111","amount_owed":100},
             {"user_id":"22222222-2222-2222-2222-222222222222","amount_owed":100}]'::jsonb,
           NOW()
         )::text AS id`,
        [group1, ALICE],
      ),
    );

    const after = await db.query(`SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [group1]);
    assert.equal(after.rows[0].n, before.rows[0].n + 1, 'старый RPC не создал новый expense после миграции');

    const row = await db.query(
      `SELECT paid_by_participant_id FROM public.expenses WHERE id = $1`,
      [newExpense.rows[0].id],
    );
    assert.equal(row.rows[0].paid_by_participant_id, null, 'новый expense не должен получать participant_id без dual-write (Этап 2)');

    const splits = await db.query(
      `SELECT participant_id, group_id FROM public.expense_splits WHERE expense_id = $1`,
      [newExpense.rows[0].id],
    );
    assert.ok(splits.rows.length > 0);
    assert.ok(
      splits.rows.every((r) => r.participant_id === null && r.group_id === null),
      'новые expense_splits не должны получать participant_id/group_id без dual-write (Этап 2)',
    );
  });

  test('прямой INSERT settlement после миграции по-прежнему проходит с транзитным NULL participant_id', async () => {
    const newSettlement = await asUser(db, BOB, () =>
      db.query(
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount)
         VALUES ($1, $2, $3, 50) RETURNING id::text`,
        [group1, BOB, ALICE],
      ),
    );
    const row = await db.query(
      `SELECT payer_participant_id, payee_participant_id FROM public.settlements WHERE id = $1`,
      [newSettlement.rows[0].id],
    );
    assert.equal(row.rows[0].payer_participant_id, null, 'новый settlement получил payer_participant_id без dual-write (Этап 2)');
    assert.equal(row.rows[0].payee_participant_id, null, 'новый settlement получил payee_participant_id без dual-write (Этап 2)');
  });

  test('expenses.group_id нельзя изменить после создания', async () => {
    const res = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.expenses SET group_id = $1 WHERE id = $2`, [group2, group1Expense]),
    );
    assert.equal(res.ok, false, 'expenses.group_id изменился после создания expense');
  });
});

describe('S2 regression: DELETE group каскадно удаляет всё, включая group_participants', () => {
  test('удаление group2 полностью очищает expenses/expense_splits/settlements/group_participants', async () => {
    const res = await attempt(db, `DELETE FROM public.groups WHERE id = $1`, [group2]);
    assert.equal(res.ok, true, `удаление group2 не прошло: ${res.error}`);

    const participants = await db.query(
      `SELECT count(*)::int AS n FROM public.group_participants WHERE group_id = $1`,
      [group2],
    );
    assert.equal(participants.rows[0].n, 0, 'group_participants остались после удаления группы');

    const expenses = await db.query(`SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [group2]);
    assert.equal(expenses.rows[0].n, 0, 'expenses остались после удаления группы');

    const settlements = await db.query(
      `SELECT count(*)::int AS n FROM public.settlements WHERE group_id = $1`,
      [group2],
    );
    assert.equal(settlements.rows[0].n, 0, 'settlements остались после удаления группы');

    const splits = await db.query(
      `SELECT count(*)::int AS n FROM public.expense_splits es
       JOIN public.expenses e ON e.id = es.expense_id
       WHERE e.group_id = $1`,
      [group2],
    );
    assert.equal(splits.rows[0].n, 0, 'expense_splits остались после удаления группы');
  });
});

describe('Catalog: expenses не хранит лишний unused unique index (S2)', () => {
  test('expenses_id_group_id_unique отсутствует — ни один FK на (id, group_id) не ссылается', async () => {
    const rows = await db.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.expenses'::regclass AND conname = 'expenses_id_group_id_unique'`,
    );
    assert.equal(rows.rows.length, 0, 'expenses_id_group_id_unique существует, хотя ни один FK им не пользуется');
  });
});

describe('S2: settlement backfill — payer и payee независимы друг от друга', () => {
  test('легитимный legacy NULL payee_id не мешает backfill payer_participant_id и не ломает миграцию', async () => {
    const setup = await createDatabaseBeforeTargetMigration();
    const localDb = setup.db;
    try {
      await localDb.query(
        `INSERT INTO public.profiles (id, full_name, email) VALUES ($1, 'Алиса', 'alice-np@example.com'), ($2, 'Боб', 'bob-np@example.com')`,
        [ALICE, BOB],
      );

      const g = await asUser(localDb, ALICE, async () => {
        const r = await localDb.query(
          `SELECT public.create_group_with_owner('NULL-payee', 'trip', 'RUB')::text AS id`,
        );
        return r.rows[0].id;
      });
      await asUser(localDb, ALICE, () =>
        localDb.query(
          `INSERT INTO public.group_invites (group_id, invite_code, created_by) VALUES ($1, 'NP-BOB', $2)`,
          [g, ALICE],
        ),
      );
      await asUser(localDb, BOB, () => localDb.query(`SELECT public.redeem_group_invite('NP-BOB')`));

      // Легитимная legacy-строка: payee_id никогда не имел NOT NULL контракта
      // на settlements, и RLS (settlements_insert_payer) проверяет только
      // payer.
      const settlementId = await asUser(localDb, BOB, async () => {
        const r = await localDb.query(
          `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount) VALUES ($1, $2, NULL, 50) RETURNING id::text`,
          [g, BOB],
        );
        return r.rows[0].id;
      });

      await localDb.exec(setup.targetMigration.sql);

      const row = await localDb.query(
        `SELECT payer_participant_id::text AS payer_pid, payee_participant_id::text AS payee_pid
         FROM public.settlements WHERE id = $1`,
        [settlementId],
      );
      assert.notEqual(
        row.rows[0].payer_pid,
        null,
        'payer_participant_id не заполнен, хотя у payer есть валидный participant — payee-сторона не должна была на это влиять',
      );
      assert.equal(
        row.rows[0].payee_pid,
        null,
        'payee_participant_id должен остаться NULL для легитимной legacy NULL-стороны',
      );
    } finally {
      await localDb.close();
    }
  });
});

describe('S2 regression: fail-fast откатывает миграцию целиком (атомарность)', () => {
  test('сломанная legacy-сторона (expenses.group_id=NULL с paid_by_id) откатывает всю миграцию', async () => {
    const FRANK = '66666666-6666-6666-6666-666666666666';
    const setup = await createDatabaseBeforeTargetMigration();
    const localDb = setup.db;
    try {
      await localDb.query(
        `INSERT INTO public.profiles (id, full_name, email) VALUES ($1, 'Фрэнк', 'frank@example.com')`,
        [FRANK],
      );

      // group_id=NULL здесь недостижим через RLS (is_group_member(NULL) всегда
      // false), поэтому только service_role может создать такую сломанную
      // legacy-строку — ровно то состояние, для которого писан fail-fast.
      await localDb.exec('SET ROLE service_role;');
      await localDb.query(
        `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
         VALUES (NULL, $1, 'Битый расход', 10, 10)`,
        [FRANK],
      );
      await localDb.exec('RESET ROLE;');

      await assert.rejects(() => localDb.exec(setup.targetMigration.sql), /backfill incomplete/);

      const tableExists = await localDb.query(
        `SELECT 1 AS present FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'group_participants'`,
      );
      assert.equal(tableExists.rows.length, 0, 'group_participants осталась после отката упавшей миграции');

      const columnExists = await localDb.query(
        `SELECT 1 AS present FROM information_schema.columns
         WHERE table_name = 'expenses' AND column_name = 'paid_by_participant_id'`,
      );
      assert.equal(columnExists.rows.length, 0, 'expenses.paid_by_participant_id осталась после отката упавшей миграции');
    } finally {
      await localDb.close();
    }
  });
});
