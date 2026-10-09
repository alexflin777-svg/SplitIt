/**
 * Тип распределения расхода — контракт миграции 20261011000000 на настоящем PostgreSQL.
 *
 * Запуск: npm run test:rls
 *
 * Что доказывается:
 *   1. add с 'items' пишет expenses.split_mode = 'items';
 *   2. вызов с 9 позиционными аргументами работает (split_mode = NULL);
 *   3. update с 'exact', затем update с NULL -> NULL (NULL = «неизвестно», не «оставить»);
 *   4. недопустимое значение отклоняется CHECK (23514);
 *   5. посторонний не добавляет и не правит;
 *   6. anon не исполняет; функции SECURITY DEFINER с search_path;
 *   7. по одной функции на имя (нет неоднозначности перегрузки);
 *   8. закрытое событие отклоняет правку (P0423).
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser, attempt } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111'; // владелец
const BOB = '22222222-2222-2222-2222-222222222222'; // участник
const CAROL = '33333333-3333-3333-3333-333333333333'; // посторонний

let db;
let g1;

const splits = (...pairs) => JSON.stringify(pairs.map(([user_id, amount_owed]) => ({ user_id, amount_owed })));

// Все вызовы — с 10 аргументами; mode = undefined -> передаём SQL NULL.
function addExpense(userId, groupId, mode, splitsJson = splits([ALICE, 600], [BOB, 400])) {
  return asUser(db, userId, () =>
    attempt(
      db,
      `SELECT public.add_expense_with_splits($1, 'Ужин', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW(), $4) AS id`,
      [groupId, ALICE, splitsJson, mode ?? null],
    ),
  );
}

function updateExpense(userId, expenseId, mode, splitsJson = splits([ALICE, 600], [BOB, 400])) {
  return asUser(db, userId, () =>
    attempt(
      db,
      `SELECT public.update_expense_with_splits($1, 'Ужин (правка)', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW(), $4) AS id`,
      [expenseId, ALICE, splitsJson, mode ?? null],
    ),
  );
}

async function modeOf(expenseId) {
  const r = await db.query(`SELECT split_mode FROM public.expenses WHERE id = $1`, [expenseId]);
  return r.rows[0].split_mode;
}

before(async () => {
  db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Алиса', 'alice@example.com'), ($2, 'Боб', 'bob@example.com'), ($3, 'Кэрол', 'carol@example.com')`,
    [ALICE, BOB, CAROL],
  );
  g1 = (await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Дача', $1) RETURNING id`, [ALICE])).rows[0].id;
  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
    [g1, ALICE, BOB],
  );
});

after(async () => {
  await db?.close?.();
});

describe('Добавление', () => {
  test("add с 'items' сохраняет split_mode = 'items'", async () => {
    const res = await addExpense(ALICE, g1, 'items');
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(await modeOf(res.rows[0].id), 'items');
  });

  for (const mode of ['equal', 'exact', 'shares']) {
    test(`допустимое значение '${mode}' принимается`, async () => {
      const res = await addExpense(ALICE, g1, mode);
      assert.equal(res.ok, true, res.error ?? '');
      assert.equal(await modeOf(res.rows[0].id), mode);
    });
  }

  test('вызов с 9 позиционными аргументами (старый клиент) работает, split_mode = NULL', async () => {
    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `SELECT public.add_expense_with_splits($1, 'Старый клиент', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW()) AS id`,
        [g1, ALICE, splits([ALICE, 500], [BOB, 500])],
      ),
    );
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(await modeOf(res.rows[0].id), null);
  });

  test('9 аргументов у update (старый клиент) работает', async () => {
    const created = await addExpense(ALICE, g1, 'items');
    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `SELECT public.update_expense_with_splits($1, 'Старый клиент', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW()) AS id`,
        [created.rows[0].id, ALICE, splits([ALICE, 500], [BOB, 500])],
      ),
    );
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(await modeOf(created.rows[0].id), null, 'старый клиент делит поровну: прежний items стал бы ложью');
  });

  test("недопустимое значение 'bogus' отклоняется CHECK (23514), расход не создан", async () => {
    const before = (await db.query(`SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [g1])).rows[0].n;
    let code = null;
    try {
      await asUser(db, ALICE, () =>
        db.query(
          `SELECT public.add_expense_with_splits($1, 'X', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW(), 'bogus')`,
          [g1, ALICE, splits([ALICE, 1000])],
        ),
      );
    } catch (e) {
      code = e.code;
    }
    assert.equal(code, '23514');
    const after = (await db.query(`SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [g1])).rows[0].n;
    assert.equal(after, before);
  });
});

describe('Правка', () => {
  test("update с 'exact', затем update с NULL -> NULL", async () => {
    const created = await addExpense(ALICE, g1, 'items');
    const id = created.rows[0].id;
    assert.equal(await modeOf(id), 'items');

    const u1 = await updateExpense(BOB, id, 'exact');
    assert.equal(u1.ok, true, u1.error ?? '');
    assert.equal(await modeOf(id), 'exact');

    const u2 = await updateExpense(BOB, id, null);
    assert.equal(u2.ok, true, u2.error ?? '');
    assert.equal(await modeOf(id), null);
  });

  test("update с 'bogus' отклоняется (23514), прежний тип сохраняется", async () => {
    const created = await addExpense(ALICE, g1, 'equal');
    const id = created.rows[0].id;
    let code = null;
    try {
      await asUser(db, ALICE, () =>
        db.query(
          `SELECT public.update_expense_with_splits($1, 'X', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW(), 'bogus')`,
          [id, ALICE, splits([ALICE, 1000])],
        ),
      );
    } catch (e) {
      code = e.code;
    }
    assert.equal(code, '23514');
    assert.equal(await modeOf(id), 'equal');
  });
});

describe('Права', () => {
  test('посторонний не добавляет расход', async () => {
    const res = await addExpense(CAROL, g1, 'items');
    assert.equal(res.ok, false);
    assert.match(res.error, /Событие не найдено или недоступно/);
  });

  test('посторонний не правит расход, split_mode не меняется', async () => {
    const created = await addExpense(ALICE, g1, 'items');
    const id = created.rows[0].id;
    const res = await updateExpense(CAROL, id, 'exact');
    assert.equal(res.ok, false);
    assert.match(res.error, /Расход не найден или недоступен/);
    assert.equal(await modeOf(id), 'items');
  });

  test('anon не исполняет; authenticated исполняет; SECURITY DEFINER с search_path', async () => {
    for (const fn of ['add_expense_with_splits', 'update_expense_with_splits']) {
      const sig = `public.${fn}(uuid, text, numeric, text, numeric, text, uuid, jsonb, timestamptz, text)`;
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
  });

  test('по одной функции на имя: перегрузка не создаёт неоднозначности', async () => {
    const r = await db.query(
      `SELECT p.proname, count(*)::int AS n
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
        WHERE ns.nspname = 'public' AND p.proname IN ('add_expense_with_splits', 'update_expense_with_splits')
        GROUP BY p.proname ORDER BY p.proname`,
    );
    assert.deepEqual(r.rows, [
      { proname: 'add_expense_with_splits', n: 1 },
      { proname: 'update_expense_with_splits', n: 1 },
    ]);
  });
});

describe('Закрытое событие', () => {
  test('правка отклоняется (P0423), тип не меняется; после открытия правка снова работает', async () => {
    const created = await addExpense(ALICE, g1, 'items');
    const id = created.rows[0].id;

    const close = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.groups SET status = 'completed' WHERE id = $1 RETURNING status`, [g1]),
    );
    assert.equal(close.ok, true, close.error ?? '');

    let code = null;
    try {
      await asUser(db, BOB, () =>
        db.query(
          `SELECT public.update_expense_with_splits($1, 'X', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW(), 'exact')`,
          [id, ALICE, splits([ALICE, 1000])],
        ),
      );
    } catch (e) {
      code = e.code;
    }
    assert.equal(code, 'P0423');
    assert.equal(await modeOf(id), 'items');

    const reopen = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.groups SET status = 'active' WHERE id = $1 RETURNING status`, [g1]),
    );
    assert.equal(reopen.ok, true, reopen.error ?? '');
    const again = await updateExpense(BOB, id, 'exact');
    assert.equal(again.ok, true, again.error ?? '');
  });
});
