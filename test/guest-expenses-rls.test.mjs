/**
 * Гости в расходах — контракт миграции 20261010000000 на настоящем PostgreSQL.
 *
 * Запуск: npm run test:rls
 *
 * Дефект F5 (прод, 2026-10-09): гость, добавленный add_virtual_member, виден
 * участником события, но add_expense_with_splits проверял id только по
 * group_members — расход с гостем не сохранялся никогда.
 *
 * Что доказывается:
 *   1. расход с долей гостя сохраняется; у аккаунта заполнены обе пары
 *      колонок (user_id + participant_id), у гостя — только participant_id;
 *   2. гость может быть плательщиком (paid_by_id = NULL);
 *   3. гость ЧУЖОЙ группы отклоняется — и как доля, и как плательщик;
 *   4. id account-participant (не гостя) клиенту не принимается;
 *   5. один и тот же участник дважды в долях отклоняется;
 *   6. редактирование: смена плательщика на гостя обнуляет paid_by_id;
 *   7. посторонний не добавляет и не правит (правка — тот же P0002, что «нет такого»);
 *   8. anon не исполняет функции; они SECURITY DEFINER с закреплённым search_path;
 *   9. закрытое событие отклоняет и добавление, и правку (P0423);
 *  10. участник события читает доли гостя (RLS SELECT);
 *  11. событие с деньгами гостя удаляется целиком;
 *  12. delete_my_account после ленивого создания account-participant не
 *      меняет итоги остальных.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser, attempt } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111'; // владелец группы 1
const BOB = '22222222-2222-2222-2222-222222222222'; // участник группы 1
const CAROL = '33333333-3333-3333-3333-333333333333'; // посторонний
const DAVE = '44444444-4444-4444-4444-444444444444'; // владелец группы 2

let db;
let g1;
let g2;
let guest1; // гость группы 1
let guest2; // гость группы 2
let expenseWithGuest;

const splits = (...pairs) => JSON.stringify(pairs.map(([user_id, amount_owed]) => ({ user_id, amount_owed })));

function addExpense(userId, groupId, payer, splitsJson, amount = 1000) {
  return asUser(db, userId, () =>
    attempt(
      db,
      `SELECT public.add_expense_with_splits($1, 'Ужин', $4, 'RUB', $4, 'food', $2, $3::jsonb, NOW()) AS id`,
      [groupId, payer, splitsJson, amount],
    ),
  );
}

function updateExpense(userId, expenseId, payer, splitsJson, amount = 1000) {
  return asUser(db, userId, () =>
    attempt(
      db,
      `SELECT public.update_expense_with_splits($1, 'Ужин (правка)', $4, 'RUB', $4, 'food', $2, $3::jsonb, NOW()) AS id`,
      [expenseId, payer, splitsJson, amount],
    ),
  );
}

async function addGuest(userId, groupId, name) {
  const r = await asUser(db, userId, () =>
    attempt(db, `SELECT public.add_virtual_member($1, $2) AS m`, [groupId, name]),
  );
  assert.equal(r.ok, true, r.error ?? '');
  return r.rows[0].m.id;
}

async function expenseCount(groupId) {
  const r = await db.query(`SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [groupId]);
  return r.rows[0].n;
}

async function splitRows(expenseId) {
  const r = await db.query(
    `SELECT user_id::text, participant_id::text, group_id::text, amount_owed::numeric AS amount
       FROM public.expense_splits WHERE expense_id = $1 ORDER BY amount_owed, participant_id`,
    [expenseId],
  );
  return r.rows;
}

async function accountParticipant(groupId, profileId) {
  const r = await db.query(
    `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2 AND kind = 'account'`,
    [groupId, profileId],
  );
  return r.rows[0]?.id ?? null;
}

before(async () => {
  db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Алиса', 'alice@example.com'), ($2, 'Боб', 'bob@example.com'),
       ($3, 'Кэрол', 'carol@example.com'), ($4, 'Дэйв', 'dave@example.com')`,
    [ALICE, BOB, CAROL, DAVE],
  );
  g1 = (await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Дача', $1) RETURNING id`, [ALICE])).rows[0].id;
  g2 = (await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Чужая', $1) RETURNING id`, [DAVE])).rows[0].id;
  // Участники вставлены напрямую, без group_participants — как у событий,
  // созданных до 20260802000000. Account-participant создаётся лениво.
  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')`,
    [g1, ALICE, BOB, g2, DAVE],
  );
  guest1 = await addGuest(ALICE, g1, 'Петя');
  guest2 = await addGuest(DAVE, g2, 'Чужой гость');
});

after(async () => {
  await db?.close?.();
});

describe('Расход с гостем сохраняется', () => {
  test('доля гостя: у аккаунта обе пары колонок, у гостя только participant_id', async () => {
    const res = await addExpense(ALICE, g1, ALICE, splits([ALICE, 500], [guest1, 500]));
    assert.equal(res.ok, true, res.error ?? '');
    expenseWithGuest = res.rows[0].id;

    const aliceP = await accountParticipant(g1, ALICE);
    assert.ok(aliceP, 'account-participant Алисы не создан');

    const e = await db.query(
      `SELECT paid_by_id::text, paid_by_participant_id::text FROM public.expenses WHERE id = $1`,
      [expenseWithGuest],
    );
    assert.deepEqual(e.rows[0], { paid_by_id: ALICE, paid_by_participant_id: aliceP });

    const rows = await splitRows(expenseWithGuest);
    assert.equal(rows.length, 2);
    const byParticipant = Object.fromEntries(rows.map((r) => [r.participant_id, r]));
    assert.equal(byParticipant[aliceP].user_id, ALICE);
    assert.equal(byParticipant[guest1].user_id, null);
    for (const r of rows) assert.equal(r.group_id, g1, 'expense_splits.group_id не заполнен');
  });

  test('гость-плательщик: paid_by_id = NULL, paid_by_participant_id = гость', async () => {
    const res = await addExpense(BOB, g1, guest1, splits([ALICE, 300], [BOB, 300], [guest1, 400]));
    assert.equal(res.ok, true, res.error ?? '');
    const e = await db.query(
      `SELECT paid_by_id::text, paid_by_participant_id::text FROM public.expenses WHERE id = $1`,
      [res.rows[0].id],
    );
    assert.deepEqual(e.rows[0], { paid_by_id: null, paid_by_participant_id: guest1 });
    assert.ok(await accountParticipant(g1, BOB), 'account-participant Боба не создан');
  });

  test('account-participant создаётся лениво один раз, без дублей на повторных расходах', async () => {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM public.group_participants WHERE group_id = $1 AND profile_id = $2`,
      [g1, ALICE],
    );
    assert.equal(r.rows[0].n, 1);
  });

  test('created_at = NULL не затирает дату: подставляется текущее время', async () => {
    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `SELECT public.add_expense_with_splits($1, 'Без даты', 100, 'RUB', 100, 'food', $2, $3::jsonb, NULL) AS id`,
        [g1, ALICE, splits([guest1, 100])],
      ),
    );
    assert.equal(res.ok, true, res.error ?? '');
    const e = await db.query(`SELECT created_at FROM public.expenses WHERE id = $1`, [res.rows[0].id]);
    assert.ok(e.rows[0].created_at, 'created_at = NULL');
  });

  test('участник события видит доли гостя (RLS SELECT)', async () => {
    const r = await asUser(db, BOB, () =>
      attempt(db, `SELECT participant_id::text FROM public.expense_splits WHERE expense_id = $1`, [expenseWithGuest]),
    );
    assert.equal(r.ok, true, r.error ?? '');
    assert.ok(r.rows.some((row) => row.participant_id === guest1));
  });
});

describe('Чужие и неверные id отклоняются', () => {
  test('гость чужой группы в долях — отказ, расход не создан', async () => {
    const before = await expenseCount(g1);
    const res = await addExpense(ALICE, g1, ALICE, splits([ALICE, 500], [guest2, 500]));
    assert.equal(res.ok, false, 'гость чужой группы принят');
    assert.match(res.error, /вне группы/);
    assert.equal(await expenseCount(g1), before, 'остался частично созданный расход');
  });

  test('гость чужой группы как плательщик — отказ', async () => {
    const res = await addExpense(ALICE, g1, guest2, splits([ALICE, 1000]));
    assert.equal(res.ok, false);
    assert.match(res.error, /Плательщик не состоит в группе/);
  });

  test('id account-participant (не гостя) клиенту не принимается', async () => {
    const aliceP = await accountParticipant(g1, ALICE);
    const res = await addExpense(ALICE, g1, ALICE, splits([aliceP, 1000]));
    assert.equal(res.ok, false, 'принят id account-participant');
  });

  test('один участник дважды в долях — отказ', async () => {
    const res = await addExpense(ALICE, g1, ALICE, splits([guest1, 500], [guest1, 500]));
    assert.equal(res.ok, false);
    assert.match(res.error, /дважды/);
  });

  test('отрицательная доля гостя — отказ', async () => {
    const res = await addExpense(ALICE, g1, ALICE, splits([ALICE, 1100], [guest1, -100]));
    assert.equal(res.ok, false);
  });
});

describe('Редактирование', () => {
  test('смена плательщика на гостя обнуляет paid_by_id и переписывает доли', async () => {
    const res = await updateExpense(BOB, expenseWithGuest, guest1, splits([BOB, 400], [guest1, 600]));
    assert.equal(res.ok, true, res.error ?? '');
    const e = await db.query(
      `SELECT paid_by_id::text, paid_by_participant_id::text, title FROM public.expenses WHERE id = $1`,
      [expenseWithGuest],
    );
    assert.deepEqual(e.rows[0], { paid_by_id: null, paid_by_participant_id: guest1, title: 'Ужин (правка)' });
    const rows = await splitRows(expenseWithGuest);
    assert.deepEqual(
      rows.map((r) => [r.user_id, r.participant_id, Number(r.amount)]),
      [
        [BOB, await accountParticipant(g1, BOB), 400],
        [null, guest1, 600],
      ],
    );
  });

  test('гость чужой группы при правке — отказ, доли не тронуты', async () => {
    const before = await splitRows(expenseWithGuest);
    const res = await updateExpense(ALICE, expenseWithGuest, ALICE, splits([ALICE, 500], [guest2, 500]));
    assert.equal(res.ok, false);
    assert.deepEqual(await splitRows(expenseWithGuest), before);
  });
});

describe('Права', () => {
  test('посторонний не добавляет расход в чужую группу', async () => {
    const before = await expenseCount(g1);
    const res = await addExpense(CAROL, g1, guest1, splits([guest1, 1000]));
    assert.equal(res.ok, false);
    assert.equal(await expenseCount(g1), before);
  });

  test('посторонний при правке получает «не найден» (P0002), а не подсказку про доли', async () => {
    const res = await updateExpense(CAROL, expenseWithGuest, guest2, splits([guest2, 1000]));
    assert.equal(res.ok, false);
    assert.match(res.error, /Расход не найден или недоступен/);
  });

  test('anon не исполняет; обе функции SECURITY DEFINER с закреплённым search_path', async () => {
    for (const fn of ['add_expense_with_splits', 'update_expense_with_splits']) {
      const sig = `public.${fn}(uuid, text, numeric, text, numeric, text, uuid, jsonb, timestamptz)`;
      const r = await db.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon_ok,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_ok,
                p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS cfg
           FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [sig],
      );
      assert.equal(r.rows[0].anon_ok, false, `${fn}: anon может исполнять`);
      assert.equal(r.rows[0].auth_ok, true, `${fn}: authenticated не может исполнять`);
      assert.equal(r.rows[0].prosecdef, true, `${fn}: не SECURITY DEFINER`);
      assert.match(r.rows[0].cfg, /search_path=/, `${fn}: search_path не закреплён`);
    }
    for (const helper of [
      'private.resolve_money_party(uuid, uuid)',
      'private.resolve_expense_splits(uuid, jsonb)',
      'private.lock_group_for_money_write(uuid)',
    ]) {
      const r = await db.query(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS ok`, [helper]);
      assert.equal(r.rows[0].ok, false, `${helper} доступна клиенту напрямую`);
    }
  });
});

describe('Закрытое событие', () => {
  test('добавление и правка с гостем отклоняются (P0423), после открытия — снова можно', async () => {
    const close = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.groups SET status = 'completed' WHERE id = $1 RETURNING status`, [g1]),
    );
    assert.equal(close.ok, true, close.error ?? '');

    const add = await addExpense(BOB, g1, guest1, splits([guest1, 1000]));
    assert.equal(add.ok, false);
    assert.match(add.error, /Событие закрыто/);

    const upd = await updateExpense(BOB, expenseWithGuest, BOB, splits([BOB, 1000]));
    assert.equal(upd.ok, false);
    assert.match(upd.error, /Событие закрыто/);

    const reopen = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.groups SET status = 'active' WHERE id = $1 RETURNING status`, [g1]),
    );
    assert.equal(reopen.ok, true, reopen.error ?? '');
    const again = await addExpense(BOB, g1, guest1, splits([guest1, 1000]));
    assert.equal(again.ok, true, again.error ?? '');
  });
});

describe('Жизненный цикл', () => {
  test('событие с деньгами гостя удаляется владельцем целиком', async () => {
    const g3 = (await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Временное', $1) RETURNING id`, [ALICE])).rows[0].id;
    await db.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [g3, ALICE]);
    const g3guest = await addGuest(ALICE, g3, 'Вася');
    const res = await addExpense(ALICE, g3, g3guest, splits([ALICE, 600], [g3guest, 400]));
    assert.equal(res.ok, true, res.error ?? '');

    const del = await asUser(db, ALICE, () =>
      attempt(db, `DELETE FROM public.groups WHERE id = $1 RETURNING id`, [g3]),
    );
    assert.equal(del.ok, true, del.error ?? '');
    assert.equal(del.rows.length, 1);
    const left = await db.query(
      `SELECT (SELECT count(*) FROM public.expenses WHERE group_id = $1)::int AS e,
              (SELECT count(*) FROM public.group_participants WHERE group_id = $1)::int AS p`,
      [g3],
    );
    assert.deepEqual(left.rows[0], { e: 0, p: 0 });
  });

  test('удаление аккаунта Боба не меняет итоги остальных в событии с гостем', async () => {
    const totals = async () =>
      (
        await db.query(
          `SELECT coalesce(sum(es.amount_owed), 0)::numeric AS owed, count(*)::int AS n
             FROM public.expense_splits es JOIN public.expenses e ON e.id = es.expense_id
            WHERE e.group_id = $1`,
          [g1],
        )
      ).rows[0];
    const before = await totals();
    const res = await asUser(db, BOB, () => attempt(db, 'SELECT public.delete_my_account() AS res'));
    assert.equal(res.ok, true, res.error ?? '');
    assert.deepEqual(await totals(), before, 'итоги события изменились после удаления аккаунта');
    const guestStill = await db.query(`SELECT count(*)::int AS n FROM public.group_participants WHERE id = $1`, [guest1]);
    assert.equal(guestStill.rows[0].n, 1, 'гость пропал вместе с аккаунтом Боба');
  });
});
