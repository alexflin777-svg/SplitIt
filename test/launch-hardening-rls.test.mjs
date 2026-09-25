/**
 * Контракт миграций 20260925000000 и 20260925000001 на настоящем PostgreSQL.
 *
 * Запуск: npm run test:rls
 *
 * Что доказывается:
 *   Закрытое событие
 *     1. в закрытое событие нельзя добавить расход ни через RPC участника,
 *        ни прямым INSERT владельца схемы (триггер, а не только RLS);
 *     2. существующий расход и его доли нельзя изменить или удалить;
 *     3. completed_at / completed_by ставит база, клиент их подделать не может;
 *     4. участник (не владелец) не может переоткрыть событие;
 *     5. владелец переоткрывает — запись снова разрешена, метки сброшены;
 *     6. удаление закрытого события целиком не блокируется.
 *   Функции SECURITY DEFINER
 *     7. anon не исполняет add_virtual_member;
 *     8. add_virtual_member отклоняет пустое и слишком длинное имя;
 *     9. у add_virtual_member закреплён search_path;
 *   Ограничитель частоты
 *    10. join_waitlist после 5 вызовов с одного адреса за час отказывает P0429.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser, attempt } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111'; // владелец
const BOB = '22222222-2222-2222-2222-222222222222'; // участник
const CAROL = '33333333-3333-3333-3333-333333333333'; // чужой

let db;
let group;
let expense;

async function asAnon(fn) {
  await db.exec('SET ROLE anon;');
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
  }
}

async function expenseCount() {
  const r = await db.query(`SELECT count(*)::int AS n FROM public.expenses WHERE group_id = $1`, [group]);
  return r.rows[0].n;
}

async function setStatusAs(userId, status) {
  return asUser(db, userId, () =>
    attempt(db, `UPDATE public.groups SET status = $2 WHERE id = $1 RETURNING status`, [group, status]),
  );
}

before(async () => {
  db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Алиса', 'alice@example.com'), ($2, 'Боб', 'bob@example.com'), ($3, 'Кэрол', 'carol@example.com')`,
    [ALICE, BOB, CAROL],
  );
  const g = await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Дача', $1) RETURNING id`,
    [ALICE],
  );
  group = g.rows[0].id;
  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
    [group, ALICE, BOB],
  );
  const e = await db.query(
    `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
     VALUES ($1, $2, 'Мясо', 3000, 3000) RETURNING id`,
    [group, ALICE],
  );
  expense = e.rows[0].id;
  await db.query(
    `INSERT INTO public.expense_splits (expense_id, user_id, amount_owed) VALUES ($1, $2, 1500), ($1, $3, 1500)`,
    [expense, ALICE, BOB],
  );
});

after(async () => {
  await db?.close?.();
});

describe('Закрытое событие: итог не «плывёт»', () => {
  test('пока событие активно, участник добавляет расход через RPC', async () => {
    const before = await expenseCount();
    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `SELECT public.add_expense_with_splits($1, 'Угли', 600, 'RUB', 600, 'food', $2,
           $3::jsonb, NOW())`,
        [group, BOB, JSON.stringify([{ user_id: ALICE, amount_owed: 300 }, { user_id: BOB, amount_owed: 300 }])],
      ),
    );
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(await expenseCount(), before + 1);
  });

  test('участник не может закрыть событие', async () => {
    const res = await setStatusAs(BOB, 'completed');
    assert.equal(res.ok && res.rows.length > 0, false, 'участник закрыл чужое событие');
  });

  test('владелец закрывает, база сама ставит completed_at / completed_by', async () => {
    const res = await asUser(db, ALICE, () =>
      attempt(
        db,
        `UPDATE public.groups SET status = 'completed', completed_by = $2, completed_at = '2000-01-01'
         WHERE id = $1 RETURNING status, completed_by::text, completed_at`,
        [group, CAROL],
      ),
    );
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(res.rows[0].status, 'completed');
    assert.equal(res.rows[0].completed_by, ALICE, 'completed_by подделан клиентом');
    assert.ok(new Date(res.rows[0].completed_at).getFullYear() >= 2026, 'completed_at подделан клиентом');
  });

  test('после закрытия RPC участника не добавляет расход', async () => {
    const before = await expenseCount();
    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `SELECT public.add_expense_with_splits($1, 'Пиво', 900, 'RUB', 900, 'food', $2,
           $3::jsonb, NOW())`,
        [group, BOB, JSON.stringify([{ user_id: BOB, amount_owed: 900 }])],
      ),
    );
    assert.equal(res.ok, false, 'расход добавлен в закрытое событие');
    assert.match(res.error, /закрыто/i);
    assert.equal(await expenseCount(), before);
  });

  test('даже владелец схемы (в обход RLS) не пишет в закрытое событие', async () => {
    const res = await attempt(
      db,
      `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, 'Обход', 1, 1)`,
      [group, ALICE],
    );
    assert.equal(res.ok, false, 'триггер не сработал для прямого INSERT');
  });

  test('существующий расход и доли нельзя изменить или удалить', async () => {
    const upd = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.expenses SET amount = 1 WHERE id = $1`, [expense]),
    );
    assert.equal(upd.ok, false, 'расход изменён после закрытия');

    const split = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.expense_splits SET amount_owed = 0 WHERE expense_id = $1`, [expense]),
    );
    assert.equal(split.ok, false, 'доля изменена после закрытия');

    const del = await asUser(db, ALICE, () =>
      attempt(db, `DELETE FROM public.expenses WHERE id = $1`, [expense]),
    );
    assert.equal(del.ok, false, 'расход удалён после закрытия');

    const r = await db.query(`SELECT amount::numeric AS a FROM public.expenses WHERE id = $1`, [expense]);
    assert.equal(Number(r.rows[0].a), 3000);
  });

  test('участник не может переоткрыть событие', async () => {
    const res = await setStatusAs(BOB, 'active');
    assert.equal(res.ok && res.rows.length > 0, false);
    const r = await db.query(`SELECT status FROM public.groups WHERE id = $1`, [group]);
    assert.equal(r.rows[0].status, 'completed');
  });

  test('владелец переоткрывает: запись снова разрешена, метки сброшены', async () => {
    const res = await setStatusAs(ALICE, 'active');
    assert.equal(res.ok, true, res.error ?? '');
    const r = await db.query(`SELECT completed_at, completed_by FROM public.groups WHERE id = $1`, [group]);
    assert.equal(r.rows[0].completed_at, null);
    assert.equal(r.rows[0].completed_by, null);

    const upd = await asUser(db, ALICE, () =>
      attempt(db, `UPDATE public.expenses SET title = 'Мясо и овощи' WHERE id = $1 RETURNING id`, [expense]),
    );
    assert.equal(upd.ok, true, upd.error ?? '');
  });

  test('удаление закрытого события целиком не блокируется', async () => {
    await setStatusAs(ALICE, 'completed');
    const res = await asUser(db, ALICE, () =>
      attempt(db, `DELETE FROM public.groups WHERE id = $1 RETURNING id`, [group]),
    );
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(await expenseCount(), 0);
  });
});

describe('SECURITY DEFINER функции закрыты', () => {
  let g2;
  before(async () => {
    const g = await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Поход', $1) RETURNING id`, [ALICE]);
    g2 = g.rows[0].id;
    await db.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [g2, ALICE]);
  });

  test('anon не исполняет add_virtual_member', async () => {
    const res = await asAnon(() => attempt(db, `SELECT public.add_virtual_member($1, 'Гость')`, [g2]));
    assert.equal(res.ok, false);
    assert.match(res.error, /permission denied/i);
  });

  test('участник добавляет гостя; пустое и длинное имя отклоняются', async () => {
    const ok = await asUser(db, ALICE, () => attempt(db, `SELECT public.add_virtual_member($1, '  Вася ')`, [g2]));
    assert.equal(ok.ok, true, ok.error ?? '');
    assert.equal(ok.rows[0].add_virtual_member.name, 'Вася');

    const empty = await asUser(db, ALICE, () => attempt(db, `SELECT public.add_virtual_member($1, '   ')`, [g2]));
    assert.equal(empty.ok, false);

    const long = await asUser(db, ALICE, () =>
      attempt(db, `SELECT public.add_virtual_member($1, $2)`, [g2, 'x'.repeat(81)]),
    );
    assert.equal(long.ok, false);
  });

  test('чужой пользователь не добавляет гостя', async () => {
    const res = await asUser(db, CAROL, () => attempt(db, `SELECT public.add_virtual_member($1, 'Шпион')`, [g2]));
    assert.equal(res.ok, false);
  });

  test('у add_virtual_member закреплён search_path', async () => {
    const r = await db.query(
      `SELECT proconfig FROM pg_proc WHERE oid = 'public.add_virtual_member(uuid, text)'::regprocedure`,
    );
    assert.ok(
      (r.rows[0].proconfig ?? []).some((c) => c.startsWith('search_path=')),
      'search_path не закреплён',
    );
  });
});

describe('Ограничитель частоты публичных форм', () => {
  test('join_waitlist: 5 вызовов проходят, 6-й получает P0429', async () => {
    await db.query(`DELETE FROM private.rate_limit_hits`);
    await db.query(`SELECT set_config('request.headers', '{"x-forwarded-for":"203.0.113.7"}', false)`);
    try {
      for (let i = 0; i < 5; i++) {
        const res = await asAnon(() => attempt(db, `SELECT public.join_waitlist($1)`, [`rl${i}@example.com`]));
        assert.equal(res.ok, true, `вызов ${i + 1}: ${res.error}`);
      }
      const blocked = await asAnon(() => attempt(db, `SELECT public.join_waitlist('rl-over@example.com')`));
      assert.equal(blocked.ok, false, 'шестой вызов за час прошёл');
      assert.match(blocked.error, /слишком много/i);

      // Другой адрес не страдает от чужого лимита.
      await db.query(`SELECT set_config('request.headers', '{"x-forwarded-for":"198.51.100.9"}', false)`);
      const other = await asAnon(() => attempt(db, `SELECT public.join_waitlist('other-ip@example.com')`));
      assert.equal(other.ok, true, other.error ?? '');
    } finally {
      await db.query(`SELECT set_config('request.headers', '', false)`);
    }
  });

  test('сам IP не хранится — только хеш', async () => {
    const r = await db.query(`SELECT subject FROM private.rate_limit_hits`);
    assert.ok(r.rows.length > 0);
    for (const row of r.rows) {
      assert.doesNotMatch(row.subject, /\d+\.\d+\.\d+\.\d+/);
    }
  });
});
