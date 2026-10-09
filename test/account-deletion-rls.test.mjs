/**
 * Контракт миграции 20261009000000_delete_my_account.sql на настоящем PostgreSQL.
 *
 * Запуск: npm run test:rls
 *
 * Что доказывается:
 *   Доступ
 *     1. anon не исполняет delete_my_account(), authenticated — исполняет;
 *     2. вызов без идентификатора пользователя (пустой sub) — ошибка 28000;
 *     3. чужой аккаунт удалить нельзя: у функции нет параметров, а вызов Боба
 *        не трогает профили, события, членства и расходы Алисы и Кэрол;
 *     4. функция SECURITY DEFINER с закреплённым search_path.
 *   Деньги других людей
 *     5. после удаления Боба баланс Алисы не меняется ни на копейку, сумма по
 *        событию остаётся 0, число расходов/долей/переводов прежнее;
 *     6. профиль Боба обезличен, имя участника в событии обезличено.
 *   Личные и общие события
 *     7. личное событие Боба (в том числе закрытое) удаляется вместе с расходами;
 *     8. владение общим событием без денег Боба переходит к Кэрол;
 *     9. пользователь без денежных следов удаляется полностью, повтор —
 *        'already_deleted' без ошибки.
 *   Личные следы
 *    10. запись waitlist с email удаляется, отзывы теряют user_id и contact.
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser, attempt } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111'; // владелец общего события
const BOB = '22222222-2222-2222-2222-222222222222'; // удаляет аккаунт
const CAROL = '33333333-3333-3333-3333-333333333333'; // посторонняя
const DAVE = '44444444-4444-4444-4444-444444444444'; // без следов

let db;

async function asAnon(fn) {
  await db.exec('SET ROLE anon;');
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
  }
}

/** Вызов от имени пользователя; возвращает json результата. */
async function deleteAs(uid) {
  return asUser(db, uid, async () => {
    const r = await db.query('SELECT public.delete_my_account() AS res');
    return r.rows[0].res;
  });
}

async function one(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0];
}

async function freshDb() {
  db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email, phone, telegram_id, avatar_url) VALUES
       ($1, 'Алиса', 'alice@example.com', '+70000000001', 1001, 'a.png'),
       ($2, 'Боб', 'Bob@Example.com', '+70000000002', 1002, 'b.png'),
       ($3, 'Кэрол', 'carol@example.com', '+70000000003', 1003, 'c.png'),
       ($4, 'Дэйв', 'dave@example.com', '+70000000004', 1004, 'd.png')`,
    [ALICE, BOB, CAROL, DAVE],
  );
}

/** Событие с владельцем и участниками; возвращает id события и карту participant id. */
async function makeGroup(name, owner, others = []) {
  const g = await one(`INSERT INTO public.groups (name, created_by) VALUES ($1, $2) RETURNING id`, [name, owner]);
  const members = [owner, ...others];
  const pids = {};
  for (const [i, uid] of members.entries()) {
    await db.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, $3)`, [
      g.id,
      uid,
      i === 0 ? 'owner' : 'member',
    ]);
    const p = await one(
      `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
       SELECT $1, id, full_name, 'account', id FROM public.profiles WHERE id = $2 RETURNING id`,
      [g.id, uid],
    );
    pids[uid] = p.id;
  }
  return { id: g.id, pids };
}

async function addExpense(group, payer, amount, splits) {
  const e = await one(
    `INSERT INTO public.expenses (group_id, paid_by_id, paid_by_participant_id, title, amount, amount_in_group_currency)
     VALUES ($1, $2, $3, 'Расход', $4, $4) RETURNING id`,
    [group.id, payer, group.pids[payer], amount],
  );
  for (const [uid, owed] of Object.entries(splits)) {
    await db.query(
      `INSERT INTO public.expense_splits (expense_id, user_id, amount_owed, group_id, participant_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.id, uid, owed, group.id, group.pids[uid]],
    );
  }
  return e.id;
}

async function addSettlement(group, payer, payee, amount) {
  await db.query(
    `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, payer_participant_id, payee_participant_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [group.id, payer, payee, amount, group.pids[payer], group.pids[payee]],
  );
}

/** Баланс = заплатил − должен − отправил + получил, по legacy-колонкам профиля. */
async function balances(groupId) {
  const r = await db.query(
    `SELECT u.id::text AS uid,
       coalesce((SELECT sum(amount_in_group_currency) FROM public.expenses WHERE group_id = $1 AND paid_by_id = u.id), 0)
     - coalesce((SELECT sum(es.amount_owed) FROM public.expense_splits es JOIN public.expenses e ON e.id = es.expense_id
                 WHERE e.group_id = $1 AND es.user_id = u.id), 0)
     - coalesce((SELECT sum(amount) FROM public.settlements WHERE group_id = $1 AND payer_id = u.id), 0)
     + coalesce((SELECT sum(amount) FROM public.settlements WHERE group_id = $1 AND payee_id = u.id), 0) AS bal
     FROM public.profiles u WHERE u.id = ANY($2::uuid[]) ORDER BY u.id`,
    [groupId, [ALICE, BOB, CAROL, DAVE]],
  );
  return Object.fromEntries(r.rows.map((x) => [x.uid, Number(x.bal)]));
}

async function counts(groupId) {
  return one(
    `SELECT (SELECT count(*)::int FROM public.expenses WHERE group_id = $1) AS expenses,
            (SELECT count(*)::int FROM public.expense_splits WHERE group_id = $1) AS splits,
            (SELECT count(*)::int FROM public.settlements WHERE group_id = $1) AS settlements,
            (SELECT count(*)::int FROM public.group_members WHERE group_id = $1) AS members,
            (SELECT count(*)::int FROM public.group_participants WHERE group_id = $1) AS participants`,
    [groupId],
  );
}

describe('Доступ к delete_my_account', () => {
  before(freshDb);

  test('anon не может исполнить функцию, authenticated может', async () => {
    const priv = await one(
      `SELECT has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE') AS anon_ok,
              has_function_privilege('authenticated', 'public.delete_my_account()', 'EXECUTE') AS auth_ok`,
    );
    assert.equal(priv.anon_ok, false);
    assert.equal(priv.auth_ok, true);

    const res = await asAnon(() => attempt(db, 'SELECT public.delete_my_account()'));
    assert.equal(res.ok, false);
    assert.match(res.error, /permission denied/i);
  });

  test('пустой sub: ошибка 28000 «Требуется авторизация»', async () => {
    await db.exec('SET ROLE authenticated;');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
    let err;
    try {
      await db.query('SELECT public.delete_my_account()');
    } catch (e) {
      err = e;
    } finally {
      await db.exec('RESET ROLE;');
    }
    assert.ok(err, 'вызов без пользователя должен падать');
    assert.equal(err.code, '28000');
    assert.match(err.message, /Требуется авторизация/);
  });

  test('у функции нет параметров: передать чужой id нельзя', async () => {
    const res = await asUser(db, BOB, () => attempt(db, 'SELECT public.delete_my_account($1::uuid)', [ALICE]));
    assert.equal(res.ok, false);
    assert.match(res.error, /does not exist|function/i);
    const p = await one(`SELECT pronargs FROM pg_proc WHERE proname = 'delete_my_account'`);
    assert.equal(p.pronargs, 0);
  });

  test('SECURITY DEFINER и закреплённый search_path', async () => {
    const p = await one(
      `SELECT prosecdef, coalesce(array_to_string(proconfig, ','), '') AS cfg
       FROM pg_proc WHERE oid = 'public.delete_my_account()'::regprocedure`,
    );
    assert.equal(p.prosecdef, true);
    assert.match(p.cfg, /search_path=/);
  });
});

describe('Вызов Боба не затрагивает чужие данные', () => {
  let aliceGroup;
  let carolGroup;
  let before_;

  async function snapshot() {
    return {
      profiles: (await db.query(`SELECT id::text, full_name, email, phone, telegram_id::text, avatar_url
                                 FROM public.profiles WHERE id IN ($1, $2) ORDER BY id`, [ALICE, CAROL])).rows,
      alice: await counts(aliceGroup.id),
      carol: await counts(carolGroup.id),
      groups: (await db.query(`SELECT id::text, created_by::text, status FROM public.groups
                               WHERE id IN ($1, $2) ORDER BY id`, [aliceGroup.id, carolGroup.id])).rows,
    };
  }

  before(async () => {
    await freshDb();
    aliceGroup = await makeGroup('Алиса и гость', ALICE);
    await addExpense(aliceGroup, ALICE, 500, { [ALICE]: 500 });
    carolGroup = await makeGroup('Кэрол и Алиса', CAROL, [ALICE]);
    await addExpense(carolGroup, CAROL, 900, { [CAROL]: 450, [ALICE]: 450 });
    await makeGroup('Личное Боба', BOB);
    before_ = await snapshot();
  });

  test('профили, события, членства и расходы Алисы и Кэрол остались прежними', async () => {
    const res = await deleteAs(BOB);
    assert.equal(res.status, 'deleted');
    assert.deepEqual(await snapshot(), before_);
    const bob = await db.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [BOB]);
    assert.equal(bob.rows.length, 0, 'у Боба нет денег, профиль удаляется');
  });
});

describe('Итоги других участников сохраняются', () => {
  let group;
  let balancesBefore;
  let countsBefore;

  before(async () => {
    await freshDb();
    group = await makeGroup('Дача', ALICE, [BOB]);
    await addExpense(group, ALICE, 3000, { [ALICE]: 1500, [BOB]: 1500 });
    await addExpense(group, BOB, 1000, { [ALICE]: 400, [BOB]: 600 });
    await addSettlement(group, BOB, ALICE, 700);
    balancesBefore = await balances(group.id);
    countsBefore = await counts(group.id);
    await deleteAs(BOB);
  });

  test('баланс Алисы и Боба неизменны, сумма по событию 0', async () => {
    const after = await balances(group.id);
    assert.equal(after[ALICE], balancesBefore[ALICE]);
    assert.equal(after[BOB], balancesBefore[BOB]);
    assert.deepEqual(after, balancesBefore);
    const total = Object.values(after).reduce((a, b) => a + b, 0);
    assert.equal(total, 0);
    assert.notEqual(after[ALICE], 0, 'проверка не пустая');
  });

  test('число расходов, долей и переводов не изменилось', async () => {
    const after = await counts(group.id);
    assert.equal(after.expenses, 2);
    assert.equal(after.splits, 4);
    assert.equal(after.settlements, 1);
    assert.equal(after.expenses, countsBefore.expenses);
    assert.equal(after.splits, countsBefore.splits);
    assert.equal(after.settlements, countsBefore.settlements);
  });

  test('профиль Боба обезличен, имя участника в событии обезличено', async () => {
    const p = await one(`SELECT full_name, email, phone, telegram_id, avatar_url FROM public.profiles WHERE id = $1`, [BOB]);
    assert.deepEqual(p, {
      full_name: 'Удалённый пользователь',
      email: null,
      phone: null,
      telegram_id: null,
      avatar_url: null,
    });
    const gp = await one(`SELECT display_name, avatar_url FROM public.group_participants WHERE id = $1`, [group.pids[BOB]]);
    assert.equal(gp.display_name, 'Удалённый пользователь');
    assert.equal(gp.avatar_url, null);
    const a = await one(`SELECT display_name FROM public.group_participants WHERE id = $1`, [group.pids[ALICE]]);
    assert.equal(a.display_name, 'Алиса');
  });

  test('владелец события остаётся Алисой', async () => {
    const g = await one(`SELECT created_by::text AS owner FROM public.groups WHERE id = $1`, [group.id]);
    assert.equal(g.owner, ALICE);
  });
});

describe('Личные события удаляются целиком', () => {
  let active;
  let completed;

  before(async () => {
    await freshDb();
    for (const status of ['active', 'completed']) {
      const g = await makeGroup(`Личное ${status}`, BOB);
      const guest = await one(
        `INSERT INTO public.group_participants (group_id, display_name, kind, created_by)
         VALUES ($1, 'Гость', 'guest', $2) RETURNING id`,
        [g.id, BOB],
      );
      g.pids.guest = guest.id;
      await addExpense(g, BOB, 100, { [BOB]: 100 });
      // долю гостя добавляем отдельно: у гостя нет profile id
      const e = await one(`SELECT id FROM public.expenses WHERE group_id = $1`, [g.id]);
      await db.query(
        `INSERT INTO public.expense_splits (expense_id, amount_owed, group_id, participant_id) VALUES ($1, 0.01, $2, $3)`,
        [e.id, g.id, guest.id],
      );
      if (status === 'completed') {
        await db.query(`UPDATE public.groups SET status = 'completed' WHERE id = $1`, [g.id]);
        completed = g;
      } else {
        active = g;
      }
    }
    const st = await one(`SELECT status FROM public.groups WHERE id = $1`, [completed.id]);
    assert.equal(st.status, 'completed', 'фикстура: событие действительно закрыто');
  });

  test('активное и закрытое личные события исчезают вместе с расходами и гостями', async () => {
    const res = await deleteAs(BOB);
    assert.equal(res.status, 'deleted');
    assert.equal(res.deleted_groups, 2);
    for (const g of [active, completed]) {
      const left = await one(
        `SELECT (SELECT count(*)::int FROM public.groups WHERE id = $1) AS g,
                (SELECT count(*)::int FROM public.expenses WHERE group_id = $1) AS e,
                (SELECT count(*)::int FROM public.expense_splits WHERE group_id = $1) AS s,
                (SELECT count(*)::int FROM public.settlements WHERE group_id = $1) AS st,
                (SELECT count(*)::int FROM public.group_participants WHERE group_id = $1) AS p,
                (SELECT count(*)::int FROM public.group_members WHERE group_id = $1) AS m`,
        [g.id],
      );
      assert.deepEqual(left, { g: 0, e: 0, s: 0, st: 0, p: 0, m: 0 });
    }
    const prof = await db.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [BOB]);
    assert.equal(prof.rows.length, 0);
  });
});

describe('Передача владения общим событием', () => {
  let group;

  before(async () => {
    await freshDb();
    group = await makeGroup('Поход', BOB, [CAROL]);
    await deleteAs(BOB);
  });

  test('владельцем становится Кэрол, членство Боба снято', async () => {
    const g = await one(`SELECT created_by::text AS owner FROM public.groups WHERE id = $1`, [group.id]);
    assert.equal(g.owner, CAROL);
    const m = await db.query(
      `SELECT user_id::text, role FROM public.group_members WHERE group_id = $1 ORDER BY user_id`,
      [group.id],
    );
    assert.deepEqual(m.rows, [{ user_id: CAROL, role: 'owner' }]);
    const gp = await db.query(`SELECT profile_id::text FROM public.group_participants WHERE group_id = $1`, [group.id]);
    assert.deepEqual(gp.rows, [{ profile_id: CAROL }]);
  });

  test('профиль Боба удалён полностью, профиль Кэрол цел', async () => {
    const bob = await db.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [BOB]);
    assert.equal(bob.rows.length, 0);
    const carol = await one(`SELECT full_name, email FROM public.profiles WHERE id = $1`, [CAROL]);
    assert.equal(carol.full_name, 'Кэрол');
  });
});

describe('Пользователь без денежных следов и повторный вызов', () => {
  before(async () => {
    await freshDb();
  });

  test('профиль удаляется, повтор возвращает already_deleted без ошибки', async () => {
    const first = await deleteAs(DAVE);
    assert.equal(first.status, 'deleted');
    assert.equal(first.anonymized, false);
    const gone = await db.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [DAVE]);
    assert.equal(gone.rows.length, 0);

    const second = await deleteAs(DAVE);
    assert.deepEqual(second, { status: 'already_deleted' });
  });
});

describe('Личные следы: waitlist и отзывы', () => {
  before(async () => {
    await freshDb();
    await db.query(`INSERT INTO public.waitlist (email) VALUES ('bob@example.com'), ('other@example.com')`);
    await db.query(
      `INSERT INTO public.feedback (category, message, contact, user_id) VALUES
         ('idea', 'Идея от Боба', 'bob@example.com', $1),
         ('bug', 'Баг от Кэрол', 'carol@example.com', $2)`,
      [BOB, CAROL],
    );
    await deleteAs(BOB);
  });

  test('запись waitlist с email Боба (без учёта регистра) удалена, чужая цела', async () => {
    const w = await db.query(`SELECT email FROM public.waitlist ORDER BY email`);
    assert.deepEqual(w.rows, [{ email: 'other@example.com' }]);
  });

  test('отзыв Боба сохранён без user_id и contact, отзыв Кэрол не тронут', async () => {
    const f = await db.query(`SELECT message, user_id::text, contact FROM public.feedback ORDER BY message`);
    assert.deepEqual(f.rows, [
      { message: 'Баг от Кэрол', user_id: CAROL, contact: 'carol@example.com' },
      { message: 'Идея от Боба', user_id: null, contact: null },
    ]);
  });
});

describe('Событие, созданное другим человеком, не принадлежит Бобу', () => {
  let group;

  before(async () => {
    await freshDb();
    // Алиса создала событие и вышла (ни членства, ни участника), остался только Боб.
    const g = await one(`INSERT INTO public.groups (name, created_by) VALUES ('Алисино', $1) RETURNING id`, [ALICE]);
    group = { id: g.id, pids: {} };
    await db.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [g.id, BOB]);
    const p = await one(
      `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
       VALUES ($1, $2, 'Боб', 'account', $2) RETURNING id`,
      [g.id, BOB],
    );
    group.pids[BOB] = p.id;
    await addExpense(group, BOB, 800, { [BOB]: 800 });
    await deleteAs(BOB);
  });

  test('событие и расход переживают удаление Боба, created_by остаётся Алисой', async () => {
    const g = await one(`SELECT created_by::text AS owner FROM public.groups WHERE id = $1`, [group.id]);
    assert.ok(g, 'событие Алисы удалено вместе с Бобом');
    assert.equal(g.owner, ALICE);
    const c = await counts(group.id);
    assert.equal(c.expenses, 1, 'расход не должен пропасть');
    assert.equal(c.splits, 1);
  });
});

describe('Гость, созданный другим аккаунтом, делает событие общим', () => {
  let group;
  let guestId;

  before(async () => {
    await freshDb();
    group = await makeGroup('Бобово с гостем Кэрол', BOB);
    const guest = await one(
      `INSERT INTO public.group_participants (group_id, display_name, kind, created_by)
       VALUES ($1, 'Гость Кэрол', 'guest', $2) RETURNING id`,
      [group.id, CAROL],
    );
    guestId = guest.id;
    await deleteAs(BOB);
  });

  test('событие и гость Кэрол остаются', async () => {
    const g = await db.query(`SELECT id FROM public.groups WHERE id = $1`, [group.id]);
    assert.equal(g.rows.length, 1, 'событие удалено, хотя в нём есть гость Кэрол');
    const gp = await db.query(`SELECT 1 FROM public.group_participants WHERE id = $1`, [guestId]);
    assert.equal(gp.rows.length, 1, 'гость Кэрол удалён');
  });
});

describe('Преемник есть только как участник (без членства)', () => {
  let noMoney;
  let withMoney;
  let balancesBefore;
  let countsBefore;

  async function build(name) {
    const g = await makeGroup(name, BOB);
    const p = await one(
      `INSERT INTO public.group_participants (group_id, profile_id, display_name, kind, created_by)
       VALUES ($1, $2, 'Кэрол', 'account', $2) RETURNING id`,
      [g.id, CAROL],
    );
    g.pids[CAROL] = p.id;
    return g;
  }

  before(async () => {
    await freshDb();
    noMoney = await build('Без денег Боба');
    withMoney = await build('С деньгами Боба');
    await addExpense(withMoney, BOB, 600, { [BOB]: 300, [CAROL]: 300 });
    balancesBefore = await balances(withMoney.id);
    countsBefore = await counts(withMoney.id);
  });

  test('без денег Боба: created_by переходит к преемнику, ошибки нет', async () => {
    const res = await deleteAs(BOB);
    assert.equal(res.status, 'deleted');
    const g = await one(`SELECT created_by::text AS owner FROM public.groups WHERE id = $1`, [noMoney.id]);
    assert.equal(g.owner, CAROL);
  });

  test('с деньгами Боба: created_by у преемника, деньги неизменны', async () => {
    const g = await one(`SELECT created_by::text AS owner FROM public.groups WHERE id = $1`, [withMoney.id]);
    assert.equal(g.owner, CAROL);
    assert.deepEqual(await balances(withMoney.id), balancesBefore);
    const c = await counts(withMoney.id);
    assert.equal(c.expenses, countsBefore.expenses);
    assert.equal(c.splits, countsBefore.splits);
  });
});

describe('Анонимный отзыв с контактом Боба', () => {
  before(async () => {
    await freshDb();
    await db.query(
      `INSERT INTO public.feedback (category, message, contact, user_id) VALUES
         ('idea', 'Аноним с почтой Боба', 'BOB@example.COM', NULL),
         ('bug', 'Аноним с чужой почтой', 'someone@example.com', NULL),
         ('other', 'Отзыв Кэрол', 'carol@example.com', $1)`,
      [CAROL],
    );
    await deleteAs(BOB);
  });

  test('contact с email Боба (любой регистр) обнулён, чужие отзывы не тронуты', async () => {
    const f = await db.query(`SELECT message, contact FROM public.feedback ORDER BY message`);
    assert.deepEqual(f.rows, [
      { message: 'Аноним с почтой Боба', contact: null },
      { message: 'Аноним с чужой почтой', contact: 'someone@example.com' },
      { message: 'Отзыв Кэрол', contact: 'carol@example.com' },
    ]);
  });
});

describe('Закрытое общее событие с деньгами Боба', () => {
  let group;
  let balancesBefore;
  let countsBefore;

  before(async () => {
    await freshDb();
    group = await makeGroup('Закрытая дача', ALICE, [BOB]);
    await addExpense(group, BOB, 1000, { [ALICE]: 400, [BOB]: 600 });
    await addExpense(group, ALICE, 200, { [ALICE]: 100, [BOB]: 100 });
    await addSettlement(group, BOB, ALICE, 150);
    await db.query(`UPDATE public.groups SET status = 'completed' WHERE id = $1`, [group.id]);
    balancesBefore = await balances(group.id);
    countsBefore = await counts(group.id);
  });

  test('удаление проходит, деньги и баланс Алисы те же, событие закрыто', async () => {
    const res = await deleteAs(BOB);
    assert.equal(res.status, 'deleted');
    assert.deepEqual(await balances(group.id), balancesBefore);
    const c = await counts(group.id);
    assert.equal(c.expenses, countsBefore.expenses);
    assert.equal(c.splits, countsBefore.splits);
    assert.equal(c.settlements, countsBefore.settlements);
    const g = await one(`SELECT status FROM public.groups WHERE id = $1`, [group.id]);
    assert.equal(g.status, 'completed');
  });
});
