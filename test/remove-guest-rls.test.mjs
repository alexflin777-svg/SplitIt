/**
 * Удаление гостя — контракт миграции 20261013000000 (remove_guest) на настоящем PostgreSQL.
 *
 * Запуск: npm run test:rls
 *
 * Что доказывается:
 *   1. участник события (не создатель) удаляет гостя без денег — строка исчезает;
 *   2. гость, который платил / имеет только долю / только в переводе, не удаляется:
 *      P0409 с понятным текстом, строка на месте;
 *   3. после удаления расхода гостя удалить можно;
 *   4. посторонний, неизвестный id и id участника-аккаунта — P0002, строка на месте;
 *   5. anon не исполняет, authenticated исполняет; SECURITY DEFINER, search_path закреплён;
 *   6. прямой DELETE из group_participants у authenticated удаляет 0 строк (нет политики).
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111'; // владелец группы 1
const BOB = '22222222-2222-2222-2222-222222222222'; // участник группы 1 (не создатель)
const CAROL = '33333333-3333-3333-3333-333333333333'; // посторонний

let db;
let g1;

/** Как attempt из харнесса, но с кодом ошибки PostgreSQL (SQLSTATE). */
async function run(sql, params = []) {
  try {
    const res = await db.query(sql, params);
    return { ok: true, rows: res.rows, code: null, error: null };
  } catch (e) {
    return { ok: false, rows: [], code: e.code ?? null, error: e.message };
  }
}

const removeGuest = (userId, id) =>
  asUser(db, userId, () => run(`SELECT public.remove_guest($1) AS r`, [id]));

async function addGuest(name) {
  const r = await asUser(db, ALICE, () => run(`SELECT public.add_virtual_member($1, $2) AS m`, [g1, name]));
  assert.equal(r.ok, true, r.error ?? '');
  return r.rows[0].m.id;
}

async function exists(id) {
  const r = await db.query(`SELECT count(*)::int AS n FROM public.group_participants WHERE id = $1`, [id]);
  return r.rows[0].n === 1;
}

async function addExpense(payer, owed) {
  const splits = JSON.stringify(owed.map(([user_id, amount_owed]) => ({ user_id, amount_owed })));
  const r = await asUser(db, ALICE, () =>
    run(`SELECT public.add_expense_with_splits($1, 'Ужин', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW()) AS id`, [
      g1, payer, splits,
    ]),
  );
  assert.equal(r.ok, true, r.error ?? '');
  return r.rows[0].id;
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

describe('Гость без денег', () => {
  test('участник (не создатель) удаляет гостя — строки нет', async () => {
    const guest = await addGuest('Пустой');
    assert.equal(await exists(guest), true);
    const res = await removeGuest(BOB, guest);
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(await exists(guest), false);
  });
});

describe('Гость с деньгами не удаляется', () => {
  test('гость платил расход — P0409, строка остаётся; после удаления расхода удаляется', async () => {
    const guest = await addGuest('Плательщик');
    const exp = await addExpense(guest, [[ALICE, 500], [guest, 500]]);

    const res = await removeGuest(BOB, guest);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'P0409');
    assert.match(res.error, /У гостя есть расходы/);
    assert.equal(await exists(guest), true);

    await db.query(`DELETE FROM public.expenses WHERE id = $1`, [exp]);
    const again = await removeGuest(BOB, guest);
    assert.equal(again.ok, true, again.error ?? '');
    assert.equal(await exists(guest), false);
  });

  test('гость только с долей — P0409, строка остаётся', async () => {
    const guest = await addGuest('Должник');
    await addExpense(ALICE, [[ALICE, 600], [guest, 400]]);
    const res = await removeGuest(BOB, guest);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'P0409');
    assert.match(res.error, /У гостя есть расходы/);
    assert.equal(await exists(guest), true);
  });

  test('гость только в переводе (плательщик и получатель) — P0409, строка остаётся', async () => {
    const asPayer = await addGuest('Перевод-от');
    const asPayee = await addGuest('Перевод-кому');
    const rec1 = await asUser(db, BOB, () => run(`SELECT public.record_settlement($1, $2, $3, 100) AS id`, [g1, asPayer, ALICE]));
    assert.equal(rec1.ok, true, rec1.error ?? '');
    const rec2 = await asUser(db, BOB, () => run(`SELECT public.record_settlement($1, $2, $3, 100) AS id`, [g1, ALICE, asPayee]));
    assert.equal(rec2.ok, true, rec2.error ?? '');

    for (const id of [asPayer, asPayee]) {
      const res = await removeGuest(BOB, id);
      assert.equal(res.ok, false);
      assert.equal(res.code, 'P0409');
      assert.match(res.error, /У гостя есть расходы/);
      assert.equal(await exists(id), true);
    }
  });
});

describe('Границы доступа', () => {
  test('посторонний — P0002, строка остаётся', async () => {
    const guest = await addGuest('Чужому не отдам');
    const res = await removeGuest(CAROL, guest);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'P0002');
    assert.equal(await exists(guest), true);
  });

  test('неизвестный uuid — P0002', async () => {
    const res = await removeGuest(BOB, '99999999-9999-9999-9999-999999999999');
    assert.equal(res.ok, false);
    assert.equal(res.code, 'P0002');
  });

  test('NULL вместо id — P0002', async () => {
    const res = await removeGuest(BOB, null);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'P0002');
  });

  test('id участника-аккаунта — P0002, строка остаётся', async () => {
    // account-participant создаётся лениво: делаем запись, где Алиса — сторона перевода.
    const guest = await addGuest('Для ленивого создания');
    const rec = await asUser(db, BOB, () => run(`SELECT public.record_settlement($1, $2, $3, 10) AS id`, [g1, guest, ALICE]));
    assert.equal(rec.ok, true, rec.error ?? '');
    const acc = (
      await db.query(
        `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2 AND kind = 'account'`,
        [g1, ALICE],
      )
    ).rows[0]?.id;
    assert.ok(acc, 'account-participant Алисы не создан');

    const res = await removeGuest(BOB, acc);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'P0002');
    assert.equal(await exists(acc), true);
  });

  test('anon не исполняет; authenticated исполняет; SECURITY DEFINER с закреплённым search_path', async () => {
    const sig = 'public.remove_guest(uuid)';
    const r = await db.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon_ok,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_ok,
              has_function_privilege('public', $1, 'EXECUTE') AS public_ok,
              p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS cfg
         FROM pg_proc p WHERE p.oid = $1::regprocedure`,
      [sig],
    );
    assert.equal(r.rows[0].anon_ok, false, 'anon может исполнять');
    assert.equal(r.rows[0].public_ok, false, 'PUBLIC может исполнять');
    assert.equal(r.rows[0].auth_ok, true, 'authenticated не может исполнять');
    assert.equal(r.rows[0].prosecdef, true, 'не SECURITY DEFINER');
    assert.match(r.rows[0].cfg, /search_path=/, 'search_path не закреплён');
  });

  test('прямой DELETE из group_participants у authenticated удаляет 0 строк', async () => {
    const guest = await addGuest('Прямой DELETE');
    const res = await asUser(db, BOB, () =>
      run(`DELETE FROM public.group_participants WHERE id = $1 RETURNING id`, [guest]),
    );
    // Нет политики DELETE: либо 0 строк, либо отказ по правам — но не удаление.
    if (res.ok) assert.equal(res.rows.length, 0, 'прямой DELETE удалил строку');
    else assert.equal(res.code, '42501');
    assert.equal(await exists(guest), true);
  });
});
