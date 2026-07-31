/**
 * Живая проверка изоляции данных между пользователями.
 *
 * Запуск: node --test test/rls.test.mjs
 *
 * Это то, чего не хватало два круга подряд. Статический разбор SQL ловил форму
 * дефекта, но не отвечал на единственный важный вопрос: увидит ли один
 * пользователь финансы другого. Здесь на этот вопрос отвечает сам PostgreSQL.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser, attempt } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CAROL = '33333333-3333-3333-3333-333333333333';

let db;
let aliceGroup;
let aliceExpense;

before(async () => {
  db = await createTestDatabase();

  // Сид выполняется владельцем схемы: так же, как это делает service_role
  // при регистрации пользователя через триггер.
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Алиса', 'alice@example.com'),
       ($2, 'Боб', 'bob@example.com'),
       ($3, 'Кэрол', 'carol@example.com')`,
    [ALICE, BOB, CAROL],
  );

  const g = await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Поездка Алисы', $1) RETURNING id`,
    [ALICE],
  );
  aliceGroup = g.rows[0].id;

  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [aliceGroup, ALICE],
  );

  const e = await db.query(
    `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
     VALUES ($1, $2, 'Аренда дома', 9000, 9000) RETURNING id`,
    [aliceGroup, ALICE],
  );
  aliceExpense = e.rows[0].id;

  await db.query(
    `INSERT INTO public.group_invites (group_id, invite_code, created_by) VALUES ($1, 'SECRET-CODE', $2)`,
    [aliceGroup, ALICE],
  );
});

after(async () => {
  await db?.close();
});

describe('Изоляция групп', () => {
  test('владелец видит свою группу', async () => {
    const rows = await asUser(db, ALICE, async () => {
      const r = await db.query('SELECT id, name FROM public.groups');
      return r.rows;
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Поездка Алисы');
  });

  test('посторонний не видит чужую группу', async () => {
    const rows = await asUser(db, BOB, async () => {
      const r = await db.query('SELECT id FROM public.groups');
      return r.rows;
    });
    assert.deepEqual(rows, [], 'Боб видит группу Алисы');
  });

  test('посторонний не может переименовать чужую группу', async () => {
    await asUser(db, BOB, async () => {
      await db.query(`UPDATE public.groups SET name = 'Захвачено' WHERE id = $1`, [aliceGroup]);
    });

    const r = await db.query('SELECT name FROM public.groups WHERE id = $1', [aliceGroup]);
    assert.equal(r.rows[0].name, 'Поездка Алисы', 'чужой UPDATE прошёл');
  });

  test('посторонний не может удалить чужую группу', async () => {
    await asUser(db, BOB, async () => {
      await db.query('DELETE FROM public.groups WHERE id = $1', [aliceGroup]);
    });

    const r = await db.query('SELECT count(*)::int AS n FROM public.groups WHERE id = $1', [aliceGroup]);
    assert.equal(r.rows[0].n, 1, 'чужая группа удалена');
  });

  test('нельзя создать группу от чужого имени', async () => {
    const res = await asUser(db, BOB, () =>
      attempt(db, `INSERT INTO public.groups (name, created_by) VALUES ('Подлог', $1)`, [ALICE]),
    );
    assert.equal(res.ok, false, 'INSERT от чужого имени прошёл');
  });
});

describe('Изоляция расходов', () => {
  test('посторонний не видит чужие расходы', async () => {
    const rows = await asUser(db, BOB, async () => {
      const r = await db.query('SELECT id, amount FROM public.expenses');
      return r.rows;
    });
    assert.deepEqual(rows, [], 'Боб видит расходы Алисы');
  });

  test('посторонний не может добавить расход в чужую группу', async () => {
    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
         VALUES ($1, $2, 'Чужой расход', 100, 100)`,
        [aliceGroup, BOB],
      ),
    );
    assert.equal(res.ok, false, 'INSERT в чужую группу прошёл');
  });

  test('посторонний не может изменить сумму чужого расхода', async () => {
    await asUser(db, BOB, async () => {
      await db.query('UPDATE public.expenses SET amount = 1 WHERE id = $1', [aliceExpense]);
    });

    const r = await db.query('SELECT amount FROM public.expenses WHERE id = $1', [aliceExpense]);
    assert.equal(Number(r.rows[0].amount), 9000, 'чужой расход изменён');
  });
});

describe('Профили', () => {
  test('свой профиль виден', async () => {
    const rows = await asUser(db, ALICE, async () => {
      const r = await db.query('SELECT id FROM public.profiles');
      return r.rows;
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, ALICE);
  });

  test('чужие email и телефон не видны без общей группы', async () => {
    const rows = await asUser(db, BOB, async () => {
      const r = await db.query('SELECT email FROM public.profiles');
      return r.rows;
    });
    assert.equal(rows.length, 1, 'видны чужие профили');
    assert.equal(rows[0].email, 'bob@example.com');
  });

  test('чужой профиль нельзя переименовать', async () => {
    await asUser(db, BOB, async () => {
      await db.query(`UPDATE public.profiles SET full_name = 'Взломано' WHERE id = $1`, [ALICE]);
    });

    const r = await db.query('SELECT full_name FROM public.profiles WHERE id = $1', [ALICE]);
    assert.equal(r.rows[0].full_name, 'Алиса');
  });
});

describe('Приглашения', () => {
  test('коды приглашений не видны посторонним', async () => {
    // Если бы SELECT был открыт, любой клиент выкачал бы все коды и вступил
    // в любую группу — вся модель доступа держится на этом.
    const rows = await asUser(db, BOB, async () => {
      const r = await db.query('SELECT invite_code FROM public.group_invites');
      return r.rows;
    });
    assert.deepEqual(rows, [], 'коды приглашений утекают');
  });

  test('нельзя вписать себя в чужую группу напрямую', async () => {
    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`,
        [aliceGroup, BOB],
      ),
    );
    assert.equal(res.ok, false, 'прямая самозапись в чужую группу прошла');
  });

  test('верный код пускает в группу и открывает её данные', async () => {
    await asUser(db, BOB, async () => {
      await db.query(`SELECT public.redeem_group_invite('SECRET-CODE')`);
    });

    const seen = await asUser(db, BOB, async () => {
      const g = await db.query('SELECT name FROM public.groups');
      const e = await db.query('SELECT amount FROM public.expenses');
      return { groups: g.rows, expenses: e.rows };
    });

    assert.equal(seen.groups.length, 1, 'после вступления группа не видна');
    assert.equal(seen.expenses.length, 1, 'после вступления расходы не видны');
  });

  test('после вступления видны профили участников группы', async () => {
    const rows = await asUser(db, BOB, async () => {
      const r = await db.query('SELECT full_name FROM public.profiles ORDER BY full_name');
      return r.rows.map((x) => x.full_name);
    });
    assert.deepEqual(rows, ['Алиса', 'Боб']);
    assert.ok(!rows.includes('Кэрол'), 'виден профиль вне общих групп');
  });

  test('неверный код отклоняется', async () => {
    const res = await asUser(db, CAROL, () =>
      attempt(db, `SELECT public.redeem_group_invite('WRONG-CODE')`),
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /недействительно|истекло/);
  });

  test('истёкшее приглашение не работает', async () => {
    await db.query(
      `INSERT INTO public.group_invites (group_id, invite_code, created_by, expires_at)
       VALUES ($1, 'EXPIRED-CODE', $2, NOW() - INTERVAL '1 day')`,
      [aliceGroup, ALICE],
    );

    const res = await asUser(db, CAROL, () =>
      attempt(db, `SELECT public.redeem_group_invite('EXPIRED-CODE')`),
    );
    assert.equal(res.ok, false, 'истёкшее приглашение сработало');
  });

  test('вступивший не становится владельцем', async () => {
    // Боб уже в группе. Владельческие операции ему по-прежнему недоступны.
    await asUser(db, BOB, async () => {
      await db.query(`UPDATE public.groups SET name = 'Переименовано участником' WHERE id = $1`, [
        aliceGroup,
      ]);
    });

    const r = await db.query('SELECT name FROM public.groups WHERE id = $1', [aliceGroup]);
    assert.equal(r.rows[0].name, 'Поездка Алисы', 'участник переименовал чужую группу');
  });
});

describe('Переводы', () => {
  test('перевод можно записать только от своего имени', async () => {
    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount)
         VALUES ($1, $2, $3, 500)`,
        [aliceGroup, ALICE, BOB],
      ),
    );
    assert.equal(res.ok, false, 'Боб записал перевод от имени Алисы');
  });

  test('свой перевод записывается', async () => {
    const res = await asUser(db, BOB, () =>
      attempt(
        db,
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount)
         VALUES ($1, $2, $3, 500)`,
        [aliceGroup, BOB, ALICE],
      ),
    );
    assert.equal(res.ok, true, `свой перевод отклонён: ${res.error}`);
  });
});

describe('Ограничения на суммы', () => {
  test('отрицательный расход отклоняется базой', async () => {
    const res = await attempt(
      db,
      `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, 'Минус', -1000, -1000)`,
      [aliceGroup, ALICE],
    );
    assert.equal(res.ok, false, 'отрицательный расход записан');
    assert.match(res.error, /expenses_amount_positive|check constraint/i);
  });

  test('нулевой расход отклоняется базой', async () => {
    const res = await attempt(
      db,
      `INSERT INTO public.expenses (group_id, paid_by_id, title, amount, amount_in_group_currency)
       VALUES ($1, $2, 'Ноль', 0, 0)`,
      [aliceGroup, ALICE],
    );
    assert.equal(res.ok, false, 'нулевой расход записан');
  });

  test('перевод самому себе отклоняется базой', async () => {
    const res = await attempt(
      db,
      `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount)
       VALUES ($1, $2, $2, 100)`,
      [aliceGroup, ALICE],
    );
    assert.equal(res.ok, false, 'перевод самому себе записан');
  });
});

describe('Выход из группы', () => {
  test('участник может выйти сам', async () => {
    await asUser(db, BOB, async () => {
      await db.query('DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2', [
        aliceGroup,
        BOB,
      ]);
    });

    const r = await db.query(
      'SELECT count(*)::int AS n FROM public.group_members WHERE group_id = $1 AND user_id = $2',
      [aliceGroup, BOB],
    );
    assert.equal(r.rows[0].n, 0, 'участник не смог выйти');
  });

  test('после выхода данные группы снова недоступны', async () => {
    const rows = await asUser(db, BOB, async () => {
      const r = await db.query('SELECT id FROM public.expenses');
      return r.rows;
    });
    assert.deepEqual(rows, [], 'вышедший участник продолжает видеть расходы');
  });
});
