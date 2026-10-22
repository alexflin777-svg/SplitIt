/**
 * Удалённый аккаунт со старым токеном не получает никакого доступа
 * (миграция 20261022000000_block_deleted_accounts.sql) — на настоящем PostgreSQL.
 *
 * Запуск: npm run test:rls
 *
 * Сценарий: Боб с деньгами в общем событии Алисы и Кэрол удаляет аккаунт.
 * Его group_members и обезличенный профиль остаются (деньги других не должны
 * поменяться), а access JWT живёт ещё до часа. Здесь «старый токен» — это
 * asUser(BOB): роль authenticated и sub = Боб.
 *
 * Что доказывается:
 *   1. Контроль: до удаления те же запросы Боба проходят — проверки ниже не
 *      пустые и падают именно из-за удаления.
 *   2. После удаления Боб не читает и не меняет ни одной таблицы public с RLS
 *      (список берётся из pg_class.relrowsecurity, а не руками).
 *   3. Ни одна функция, которую authenticated может исполнить (список из
 *      has_function_privilege по схемам public и private), не работает для
 *      Боба, кроме delete_my_account → 'already_deleted'.
 *   4. Профиль восстановить нельзя.
 *   5. Содержимое всех таблиц и балансы Алисы и Кэрол не изменились; Алиса и
 *      Кэрол читают и добавляют расходы как раньше.
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111'; // владелец общего события
const BOB = '22222222-2222-2222-2222-222222222222'; // удаляет аккаунт
const CAROL = '33333333-3333-3333-3333-333333333333'; // участница события

/** Как attempt() из харнесса, но с кодом ошибки и числом затронутых строк. */
async function run(db, sql, params = []) {
  try {
    const res = await db.query(sql, params);
    return { ok: true, rows: res.rows, affected: res.affectedRows ?? 0, error: null, code: null };
  } catch (e) {
    return { ok: false, rows: [], affected: 0, error: e.message, code: e.code ?? null };
  }
}

async function one(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}

/** Общее событие Алисы: Алиса (owner), Боб и Кэрол, гость, деньги Боба, приглашение. */
async function buildScenario() {
  const db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Алиса', 'alice@example.com'), ($2, 'Боб', 'bob@example.com'), ($3, 'Кэрол', 'carol@example.com')`,
    [ALICE, BOB, CAROL],
  );
  const g = await one(db, `INSERT INTO public.groups (name, created_by) VALUES ('Дача', $1) RETURNING id`, [ALICE]);
  const pids = {};
  for (const [uid, role, name] of [[ALICE, 'owner', 'Алиса'], [BOB, 'member', 'Боб'], [CAROL, 'member', 'Кэрол']]) {
    await db.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, $3)`, [g.id, uid, role]);
    pids[uid] = (await one(
      db,
      `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
       VALUES ($1, $2, $3, 'account', $2) RETURNING id`,
      [g.id, uid, name],
    )).id;
  }
  const guest = await one(
    db,
    `INSERT INTO public.group_participants (group_id, display_name, kind, created_by)
     VALUES ($1, 'Гость', 'guest', $2) RETURNING id`,
    [g.id, ALICE],
  );

  async function expense(payer, amount, splits) {
    const e = await one(
      db,
      `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, $3, 'Расход', $4, $4) RETURNING id`,
      [g.id, payer, pids[payer], amount],
    );
    for (const [uid, owed] of Object.entries(splits)) {
      await db.query(
        `INSERT INTO public.expense_splits (expense_id, user_id, amount_owed, group_id, participant_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [e.id, uid, owed, g.id, pids[uid]],
      );
    }
    return e.id;
  }

  await expense(ALICE, 3000, { [ALICE]: 1000, [BOB]: 1000, [CAROL]: 1000 });
  const bobExpense = await expense(BOB, 900, { [ALICE]: 300, [BOB]: 300, [CAROL]: 300 });
  const aliceOnly = await expense(ALICE, 500, { [ALICE]: 500 });
  await db.query(
    `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, payer_participant_id, payee_participant_id, created_by)
     VALUES ($1, $2, $3, 200, $4, $5, $2)`,
    [g.id, BOB, ALICE, pids[BOB], pids[ALICE]],
  );
  await db.query(`INSERT INTO public.group_invites (group_id, invite_code, created_by) VALUES ($1, 'DACHA-CODE', $2)`, [
    g.id,
    ALICE,
  ]);
  await db.query(`INSERT INTO public.feedback (category, message, user_id) VALUES ('idea', 'Отзыв Кэрол', $1)`, [CAROL]);
  await db.query(`INSERT INTO public.waitlist (email) VALUES ('someone@example.com')`);

  return { db, group: g.id, pids, guest: guest.id, bobExpense, aliceOnly };
}

/** Таблицы public с RLS — источник истины каталог, а не список в тесте. */
async function rlsTables(db) {
  const r = await db.query(
    `SELECT c.relname,
            has_table_privilege('authenticated', c.oid, 'INSERT') AS can_insert,
            (SELECT a.attname FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 1) AS first_col
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
     ORDER BY c.relname`,
  );
  return r.rows;
}

/** Все функции, которые authenticated может исполнить (кроме триггерных). */
async function callableFunctions(db) {
  const r = await db.query(
    `SELECT n.nspname, p.proname, p.oid::regprocedure::text AS sig,
            array(SELECT format_type(t.typ, NULL) FROM unnest(p.proargtypes) WITH ORDINALITY AS t(typ, i) ORDER BY t.i) AS types
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
       AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     ORDER BY 3`,
  );
  return r.rows;
}

/**
 * Вставки, которые Боб-участник реально может сделать до удаления. Для таблицы
 * с правом INSERT, которой здесь нет, тест падает: новую таблицу нельзя
 * забыть. `member` — проходит ли вставка у живого Боба (контроль).
 */
function insertAttacks(s) {
  return {
    groups: { member: true, sql: `INSERT INTO public.groups (name, created_by) VALUES ('Новое Боба', '${BOB}')` },
    group_members: {
      member: false, // только владелец добавляет участников
      sql: `INSERT INTO public.group_members (group_id, user_id, role) VALUES ('${s.group}', '${BOB}', 'owner')
            ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'owner'`,
    },
    expenses: {
      member: true,
      sql: `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
            VALUES ('${s.group}', '${BOB}', '${s.pids[BOB]}', 'После удаления', 100, 100)`,
    },
    expense_splits: {
      member: true,
      sql: `INSERT INTO public.expense_splits (expense_id, user_id, amount_owed, group_id, participant_id)
            VALUES ('${s.aliceOnly}', '${BOB}', 1, '${s.group}', '${s.pids[BOB]}')`,
    },
    settlements: {
      member: true,
      sql: `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, payer_participant_id, payee_participant_id)
            VALUES ('${s.group}', '${BOB}', '${ALICE}', 1, '${s.pids[BOB]}', '${s.pids[ALICE]}')`,
    },
    profiles: {
      member: true, // восстановление имени через upsert
      sql: `INSERT INTO public.profiles (id, full_name, email) VALUES ('${BOB}', 'Боб', 'bob@example.com')
            ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email`,
    },
    group_invites: {
      member: false, // только владелец создаёт приглашения
      sql: `INSERT INTO public.group_invites (group_id, invite_code, created_by) VALUES ('${s.group}', 'BOB-CODE', '${BOB}')`,
    },
  };
}

/** Осмысленные вызовы RPC, которые у живого Боба проходят. */
function rpcAttacks(s) {
  const splits = JSON.stringify([{ user_id: BOB, amount_owed: 50 }, { user_id: ALICE, amount_owed: 50 }]);
  return [
    ['create_group_with_owner', `SELECT public.create_group_with_owner('Новое Боба', 'other', 'RUB')`],
    ['add_expense_with_splits', `SELECT public.add_expense_with_splits('${s.group}', 'Боб', 100, 'RUB', 100, 'food', '${BOB}', '${splits}'::jsonb, NOW())`],
    ['update_expense_with_splits', `SELECT public.update_expense_with_splits('${s.bobExpense}', 'Боб', 100, 'RUB', 100, 'food', '${BOB}', '${splits}'::jsonb, NOW())`],
    ['record_settlement', `SELECT public.record_settlement('${s.group}', '${BOB}', '${CAROL}', 10)`],
    ['add_virtual_member', `SELECT public.add_virtual_member('${s.group}', 'Гость Боба')`],
    ['remove_guest', `SELECT public.remove_guest('${s.guest}')`],
    ['redeem_group_invite', `SELECT public.redeem_group_invite('DACHA-CODE')`],
    ['submit_feedback', `SELECT public.submit_feedback('idea', 'Боб всё ещё тут')`],
    ['join_waitlist', `SELECT public.join_waitlist('bob2@example.com')`],
    ['is_group_member', `SELECT public.is_group_member('${s.group}') AS v`],
    ['shares_group_with', `SELECT public.shares_group_with('${ALICE}') AS v`],
  ];
}

/** Отпечаток содержимого каждой таблицы под владельцем (RLS не действует). */
async function fingerprint(db, tables) {
  const out = {};
  for (const { relname } of tables) {
    const r = await one(
      db,
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM public.${relname} t`,
    );
    out[relname] = r;
  }
  return out;
}

/** Баланс = заплатил − должен − отправил + получил. */
async function balances(db, groupId) {
  const r = await db.query(
    `SELECT u.id::text AS uid,
       coalesce((SELECT sum(amount_in_group_currency) FROM public.expenses WHERE group_id = $1 AND paid_by_id = u.id), 0)
     - coalesce((SELECT sum(es.amount_owed) FROM public.expense_splits es JOIN public.expenses e ON e.id = es.expense_id
                 WHERE e.group_id = $1 AND es.user_id = u.id), 0)
     - coalesce((SELECT sum(amount) FROM public.settlements WHERE group_id = $1 AND payer_id = u.id), 0)
     + coalesce((SELECT sum(amount) FROM public.settlements WHERE group_id = $1 AND payee_id = u.id), 0) AS bal
     FROM public.profiles u WHERE u.id = ANY($2::uuid[]) ORDER BY u.id`,
    [groupId, [ALICE, BOB, CAROL]],
  );
  return Object.fromEntries(r.rows.map((x) => [x.uid, Number(x.bal)]));
}

describe('Контроль: до удаления те же запросы Боба проходят', () => {
  let s;
  let tables;

  before(async () => {
    s = await buildScenario();
    tables = await rlsTables(s.db);
  });

  test('Боб видит строки общего события', async () => {
    for (const t of ['groups', 'group_members', 'group_participants', 'expenses', 'expense_splits', 'settlements', 'profiles', 'group_invites']) {
      const r = await asUser(s.db, BOB, () => run(s.db, `SELECT count(*)::int AS n FROM public.${t}`));
      assert.equal(r.ok, true, `${t}: ${r.error}`);
      assert.ok(r.rows[0].n > 0, `контроль пуст: Боб не видит ${t}`);
    }
  });

  test('вставки Боба-участника проходят', async () => {
    const attacks = insertAttacks(s);
    for (const [t, a] of Object.entries(attacks)) {
      if (!a.member) continue;
      const r = await asUser(s.db, BOB, () => run(s.db, a.sql));
      assert.equal(r.ok, true, `контроль: вставка в ${t} у живого Боба должна проходить: ${r.error}`);
    }
    assert.ok(tables.length > 0);
  });

  test('RPC Боба-участника проходят', async () => {
    for (const [name, sql] of rpcAttacks(s)) {
      const r = await asUser(s.db, BOB, () => run(s.db, sql));
      assert.equal(r.ok, true, `контроль: ${name} у живого Боба должна проходить: ${r.error}`);
    }
  });

  test('UPDATE и DELETE Боба затрагивают строки', async () => {
    const upd = await asUser(s.db, BOB, () => run(s.db, `UPDATE public.profiles SET full_name = full_name WHERE id = $1`, [BOB]));
    assert.equal(upd.affected, 1, upd.error ?? '');
    const del = await asUser(s.db, BOB, () => run(s.db, `DELETE FROM public.settlements WHERE payer_id = $1`, [BOB]));
    assert.ok(del.affected > 0, del.error ?? 'контроль: Боб не удалил свой перевод');
  });
});

describe('После удаления Боб со старым токеном не имеет доступа', () => {
  let s;
  let db;
  let tables;
  let fpBefore;
  let balBefore;

  before(async () => {
    s = await buildScenario();
    db = s.db;
    tables = await rlsTables(db);
    const res = await asUser(db, BOB, async () => (await db.query('SELECT public.delete_my_account() AS r')).rows[0].r);
    assert.equal(res.status, 'deleted');
    assert.equal(res.anonymized, true, 'фикстура: у Боба есть деньги, профиль и членство остаются');
    const kept = await one(db, `SELECT count(*)::int AS n FROM public.group_members WHERE user_id = $1`, [BOB]);
    assert.equal(kept.n, 1, 'фикстура: членство Боба сохранено — иначе проверка не о дефекте');
    fpBefore = await fingerprint(db, tables);
    balBefore = await balances(db, s.group);
  });

  test('каталог: все таблицы public под RLS и с политикой deny_deleted_account', async () => {
    const noRls = await db.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`,
    );
    assert.deepEqual(noRls.rows, [], 'таблица public без RLS');
    const pol = await db.query(
      `SELECT tablename FROM pg_policies
       WHERE schemaname = 'public' AND policyname = 'deny_deleted_account' AND permissive = 'RESTRICTIVE'
         AND 'authenticated' = ANY (roles) AND cmd = 'ALL'
       ORDER BY tablename`,
    );
    assert.deepEqual(pol.rows.map((r) => r.tablename), tables.map((t) => t.relname));
    for (const t of ['groups', 'group_members', 'group_participants', 'expenses', 'expense_splits', 'settlements', 'profiles', 'group_invites', 'feedback', 'waitlist']) {
      assert.ok(tables.some((x) => x.relname === t), `${t} нет среди таблиц с RLS`);
    }
  });

  test('реестр недоступен клиенту', async () => {
    const p = await one(
      db,
      `SELECT has_table_privilege('authenticated', 'private.deleted_accounts', 'SELECT') AS a,
              has_table_privilege('anon', 'private.deleted_accounts', 'SELECT') AS b`,
    );
    assert.deepEqual(p, { a: false, b: false });
    const r = await asUser(db, BOB, () => run(db, `SELECT * FROM private.deleted_accounts`));
    assert.equal(r.ok, false);
  });

  test('SELECT: ни одной строки ни в одной таблице', async () => {
    for (const { relname } of tables) {
      const r = await asUser(db, BOB, () => run(db, `SELECT * FROM public.${relname}`));
      assert.ok(!r.ok || r.rows.length === 0, `${relname}: Боб видит ${r.rows.length} строк`);
    }
  });

  test('INSERT: отклонён в каждой таблице', async () => {
    const attacks = insertAttacks(s);
    for (const { relname, can_insert } of tables) {
      let sql;
      if (attacks[relname]) sql = attacks[relname].sql;
      else {
        assert.equal(can_insert, false, `${relname}: у authenticated есть INSERT — добавьте атаку в insertAttacks`);
        sql = `INSERT INTO public.${relname} DEFAULT VALUES`;
      }
      const r = await asUser(db, BOB, () => run(db, sql));
      assert.equal(r.ok, false, `${relname}: вставка Боба прошла`);
      // Отказ даёт RESTRICTIVE-политика или раньше неё проверка внутри
      // is_group_member из обычной политики — оба означают «нет доступа».
      assert.match(r.error, /row-level security|permission denied|Аккаунт удалён/i, `${relname}: ${r.error}`);
    }
  });

  test('UPDATE и DELETE: ни одной затронутой строки', async () => {
    for (const { relname, first_col } of tables) {
      const upd = await asUser(db, BOB, () => run(db, `UPDATE public.${relname} SET ${first_col} = ${first_col}`));
      assert.ok(!upd.ok || upd.affected === 0, `${relname}: UPDATE затронул ${upd.affected}`);
      const del = await asUser(db, BOB, () => run(db, `DELETE FROM public.${relname}`));
      assert.ok(!del.ok || del.affected === 0, `${relname}: DELETE затронул ${del.affected}`);
    }
  });

  test('профиль восстановить нельзя', async () => {
    const upd = await asUser(db, BOB, () =>
      run(db, `UPDATE public.profiles SET full_name = 'Боб', email = 'bob@example.com' WHERE id = $1`, [BOB]),
    );
    assert.ok(!upd.ok || upd.affected === 0);
    const ups = await asUser(db, BOB, () => run(db, insertAttacks(s).profiles.sql));
    assert.equal(ups.ok, false);
    const p = await one(db, `SELECT full_name, email FROM public.profiles WHERE id = $1`, [BOB]);
    assert.deepEqual(p, { full_name: 'Удалённый пользователь', email: null });
  });

  test('осмысленные RPC отклонены с «Аккаунт удалён»', async () => {
    for (const [name, sql] of rpcAttacks(s)) {
      const r = await asUser(db, BOB, () => run(db, sql));
      assert.equal(r.ok, false, `${name} сработала для удалённого аккаунта`);
      assert.equal(r.code, '42501', `${name}: ${r.error}`);
      assert.match(r.error, /Аккаунт удалён/, name);
    }
  });

  test('каждая функция, доступная authenticated, отклонена (кроме delete_my_account)', async () => {
    const fns = await callableFunctions(db);
    assert.ok(fns.length >= 15, `подозрительно мало функций: ${fns.length}`);
    const seen = [];
    for (const f of fns) {
      seen.push(f.sig);
      const args = f.types.map((t) => `NULL::${t}`).join(', ');
      const sql = `SELECT ${f.nspname}.${f.proname}(${args}) AS v`;
      const r = await asUser(db, BOB, () => run(db, sql));
      if (f.sig === 'delete_my_account()') {
        assert.equal(r.ok, true, r.error ?? '');
        assert.deepEqual(r.rows[0].v, { status: 'already_deleted' });
      } else if (f.sig === 'private.is_deleted_account()') {
        // Сама проверка: отвечает только «удалён ли я».
        assert.equal(r.ok, true, r.error ?? '');
        assert.equal(r.rows[0].v, true);
      } else {
        assert.equal(r.ok, false, `${f.sig} выполнилась для удалённого аккаунта`);
        assert.equal(r.code, '42501', `${f.sig}: ${r.error}`);
        assert.match(r.error, /Аккаунт удалён/, f.sig);
      }
    }
    for (const must of ['delete_my_account()', 'add_expense_with_splits', 'record_settlement', 'is_group_member', 'submit_feedback']) {
      assert.ok(seen.some((x) => x.startsWith(must)), `${must} не попала в перечень`);
    }
  });

  test('повторный delete_my_account → already_deleted, ничего не меняется', async () => {
    const r = await asUser(db, BOB, async () => (await db.query('SELECT public.delete_my_account() AS r')).rows[0].r);
    assert.deepEqual(r, { status: 'already_deleted' });
  });

  test('содержимое всех таблиц и балансы Алисы и Кэрол не изменились', async () => {
    assert.deepEqual(await fingerprint(db, tables), fpBefore);
    const after = await balances(db, s.group);
    assert.deepEqual(after, balBefore);
    assert.notEqual(after[ALICE], 0, 'проверка не пустая');
    assert.notEqual(after[CAROL], 0, 'проверка не пустая');
  });

  test('Алиса и Кэрол работают как раньше', async () => {
    const aliceSees = await asUser(db, ALICE, () => run(db, `SELECT id FROM public.expenses WHERE group_id = $1`, [s.group]));
    assert.equal(aliceSees.ok, true, aliceSees.error ?? '');
    assert.equal(aliceSees.rows.length, 3);
    const bobName = await asUser(db, ALICE, () => run(db, `SELECT full_name FROM public.profiles WHERE id = $1`, [BOB]));
    assert.deepEqual(bobName.rows, [{ full_name: 'Удалённый пользователь' }]);

    const aliceAdds = await asUser(db, ALICE, () =>
      run(
        db,
        `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
         VALUES ($1, $2, $3, 'Алиса после', 100, 100) RETURNING id`,
        [s.group, ALICE, s.pids[ALICE]],
      ),
    );
    assert.equal(aliceAdds.ok, true, aliceAdds.error ?? '');

    const carolSees = await asUser(db, CAROL, () => run(db, `SELECT id FROM public.expenses WHERE group_id = $1`, [s.group]));
    assert.equal(carolSees.rows.length, 4);
    const carolAdds = await asUser(db, CAROL, () =>
      run(
        db,
        `SELECT public.add_expense_with_splits($1, 'Кэрол после', 200, 'RUB', 200, 'food', $2, $3::jsonb, NOW()) AS id`,
        [s.group, CAROL, JSON.stringify([{ user_id: ALICE, amount_owed: 100 }, { user_id: CAROL, amount_owed: 100 }])],
      ),
    );
    assert.equal(carolAdds.ok, true, carolAdds.error ?? '');
    const total = await one(db, `SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [s.group]);
    assert.equal(total.n, 5);
  });
});
