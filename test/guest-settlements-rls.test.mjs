/**
 * Переводы с гостями — контракт миграции 20261012000000 на настоящем PostgreSQL.
 *
 * Запуск: npm run test:rls
 *
 * Дефект G3 (P1-15): долг гостя нельзя было погасить — settlements принимал
 * только пары аккаунтов, а клиент отклонял перевод с гостем.
 *
 * Что доказывается:
 *   1. участник события записывает перевод гость→аккаунт и аккаунт→гость, даже
 *      если сам в нём не участвует; created_by = вызывающий;
 *   2. посторонний получает 42501, строка не создаётся;
 *   3. закрытое событие — P0423, после открытия снова можно;
 *   4. участник/гость другого события — 22023;
 *   5. плательщик = получатель и сумма <= 0 — 22023;
 *   6. аккаунт↔аккаунт: третий участник — 42501, сам плательщик — можно;
 *   7. anon не исполняет; SECURITY DEFINER с закреплённым search_path;
 *   8. удаление только автором записи; прямой INSERT плательщика работает,
 *      чужой created_by отклоняется RLS;
 *   9. лимит 30 записей за 10 минут на пользователя — P0429;
 *  10. DO-блок публикации realtime безвреден без публикации;
 *  11. перевод гостя меняет его баланс ровно на сумму перевода.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser } from './pg-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111'; // владелец группы 1
const BOB = '22222222-2222-2222-2222-222222222222'; // участник группы 1
const CAROL = '33333333-3333-3333-3333-333333333333'; // посторонний
const DAVE = '44444444-4444-4444-4444-444444444444'; // владелец группы 2
const EVE = '55555555-5555-5555-5555-555555555555'; // владелец группы 3 (лимит частоты)
const FRANK = '66666666-6666-6666-6666-666666666666'; // третий участник группы 1

let db;
let g1;
let g2;
let g3;
let guest1; // гость группы 1
let guest1b; // второй гость группы 1
let guest2; // гость группы 2
let guest3; // гость группы 3

/** Как attempt из харнесса, но с кодом ошибки PostgreSQL (SQLSTATE). */
async function run(sql, params = []) {
  try {
    const res = await db.query(sql, params);
    return { ok: true, rows: res.rows, code: null, error: null };
  } catch (e) {
    return { ok: false, rows: [], code: e.code ?? null, error: e.message };
  }
}

function record(userId, groupId, payer, payee, amount = 100, currency = null, method = null) {
  return asUser(db, userId, () =>
    run(`SELECT public.record_settlement($1, $2, $3, $4, $5, $6) AS id`, [
      groupId, payer, payee, amount, currency, method,
    ]),
  );
}

async function addGuest(userId, groupId, name) {
  const r = await asUser(db, userId, () => run(`SELECT public.add_virtual_member($1, $2) AS m`, [groupId, name]));
  assert.equal(r.ok, true, r.error ?? '');
  return r.rows[0].m.id;
}

async function settlementCount(groupId) {
  const r = await db.query(`SELECT count(*)::int AS n FROM public.settlements WHERE group_id = $1`, [groupId]);
  return r.rows[0].n;
}

async function accountParticipant(groupId, profileId) {
  const r = await db.query(
    `SELECT id::text FROM public.group_participants WHERE group_id = $1 AND profile_id = $2 AND kind = 'account'`,
    [groupId, profileId],
  );
  return r.rows[0]?.id ?? null;
}

async function setStatus(userId, groupId, status) {
  const r = await asUser(db, userId, () =>
    run(`UPDATE public.groups SET status = $2 WHERE id = $1 RETURNING status`, [groupId, status]),
  );
  assert.equal(r.ok, true, r.error ?? '');
}

before(async () => {
  db = await createTestDatabase();
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email) VALUES
       ($1, 'Алиса', 'alice@example.com'), ($2, 'Боб', 'bob@example.com'),
       ($3, 'Кэрол', 'carol@example.com'), ($4, 'Дэйв', 'dave@example.com'),
       ($5, 'Ева', 'eve@example.com'), ($6, 'Фрэнк', 'frank@example.com')`,
    [ALICE, BOB, CAROL, DAVE, EVE, FRANK],
  );
  const mk = async (name, owner) =>
    (await db.query(`INSERT INTO public.groups (name, created_by) VALUES ($1, $2) RETURNING id`, [name, owner])).rows[0].id;
  g1 = await mk('Дача', ALICE);
  g2 = await mk('Чужая', DAVE);
  g3 = await mk('Лимит', EVE);
  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES
       ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member'), ($5, $6, 'owner'), ($7, $8, 'owner')`,
    [g1, ALICE, BOB, FRANK, g2, DAVE, g3, EVE],
  );
  guest1 = await addGuest(ALICE, g1, 'Петя');
  guest1b = await addGuest(ALICE, g1, 'Вася');
  guest2 = await addGuest(DAVE, g2, 'Чужой гость');
  guest3 = await addGuest(EVE, g3, 'Гость лимита');
});

after(async () => {
  await db?.close?.();
});

describe('Участник записывает перевод с гостем', () => {
  test('гость→аккаунт: Боб не сторона перевода, created_by = Боб', async () => {
    const res = await record(BOB, g1, guest1, ALICE, 250);
    assert.equal(res.ok, true, res.error ?? '');
    const aliceP = await accountParticipant(g1, ALICE);
    assert.ok(aliceP, 'account-participant Алисы не создан');
    const s = await db.query(
      `SELECT payer_id::text, payer_participant_id::text, payee_id::text, payee_participant_id::text,
              created_by::text, amount::numeric AS amount, status
         FROM public.settlements WHERE id = $1`,
      [res.rows[0].id],
    );
    assert.deepEqual(s.rows[0], {
      payer_id: null,
      payer_participant_id: guest1,
      payee_id: ALICE,
      payee_participant_id: aliceP,
      created_by: BOB,
      amount: '250.00',
      status: 'completed',
    });
  });

  test('аккаунт→гость: Боб записывает за Алису; payee_id = NULL', async () => {
    const res = await record(BOB, g1, ALICE, guest1, 100);
    assert.equal(res.ok, true, res.error ?? '');
    const s = await db.query(
      `SELECT payer_id::text, payee_id::text, payee_participant_id::text, created_by::text
         FROM public.settlements WHERE id = $1`,
      [res.rows[0].id],
    );
    assert.deepEqual(s.rows[0], { payer_id: ALICE, payee_id: null, payee_participant_id: guest1, created_by: BOB });
  });

  test('гость→гость тоже записывается', async () => {
    const res = await record(BOB, g1, guest1, guest1b, 50);
    assert.equal(res.ok, true, res.error ?? '');
  });

  test('валюта по умолчанию — из события, способ по умолчанию — sbp; явные значения сохраняются', async () => {
    const a = await record(BOB, g1, guest1, ALICE, 10);
    const b = await record(BOB, g1, guest1, ALICE, 10, 'EUR', 'cash');
    assert.equal(a.ok, true, a.error ?? '');
    assert.equal(b.ok, true, b.error ?? '');
    const def = (await db.query(`SELECT default_currency FROM public.groups WHERE id = $1`, [g1])).rows[0].default_currency ?? 'RUB';
    const get = async (id) =>
      (await db.query(`SELECT currency, payment_method FROM public.settlements WHERE id = $1`, [id])).rows[0];
    assert.deepEqual(await get(a.rows[0].id), { currency: def, payment_method: 'sbp' });
    assert.deepEqual(await get(b.rows[0].id), { currency: 'EUR', payment_method: 'cash' });
  });
});

describe('Права и границы', () => {
  test('посторонний получает 42501, ничего не записано', async () => {
    const before = await settlementCount(g1);
    const res = await record(CAROL, g1, guest1, ALICE);
    assert.equal(res.ok, false);
    assert.equal(res.code, '42501');
    assert.equal(await settlementCount(g1), before);
  });

  test('NULL вместо события — 42501', async () => {
    const res = await record(BOB, null, guest1, ALICE);
    assert.equal(res.ok, false);
    assert.equal(res.code, '42501');
  });

  test('участник и гость ДРУГОГО события — 22023, строки нет', async () => {
    const before = await settlementCount(g1);
    const cases = [
      [guest2, ALICE], // гость чужого события — плательщик
      [ALICE, guest2], // гость чужого события — получатель
      [guest1, DAVE], // аккаунт, не состоящий в событии
      [DAVE, guest1],
    ];
    for (const [payer, payee] of cases) {
      const res = await record(ALICE, g1, payer, payee);
      assert.equal(res.ok, false, `принят перевод ${payer} → ${payee}`);
      assert.equal(res.code, '22023');
    }
    assert.equal(await settlementCount(g1), before);
  });

  test('плательщик = получатель — 22023 (и гость, и аккаунт)', async () => {
    for (const id of [guest1, ALICE]) {
      const res = await record(ALICE, g1, id, id);
      assert.equal(res.ok, false);
      assert.equal(res.code, '22023');
    }
  });

  test('сумма 0, отрицательная и NULL — 22023', async () => {
    const before = await settlementCount(g1);
    for (const amount of [0, -5, null]) {
      const res = await record(BOB, g1, guest1, ALICE, amount);
      assert.equal(res.ok, false, `принята сумма ${amount}`);
      assert.equal(res.code, '22023');
    }
    assert.equal(await settlementCount(g1), before);
  });

  test('аккаунт↔аккаунт: третий участник и получатель — 42501, сам плательщик — можно', async () => {
    const before = await settlementCount(g1);
    const third = await record(FRANK, g1, ALICE, BOB, 100);
    assert.equal(third.ok, false);
    assert.equal(third.code, '42501');

    const payee = await record(BOB, g1, ALICE, BOB, 100); // получатель за плательщика — тоже нельзя
    assert.equal(payee.ok, false);
    assert.equal(payee.code, '42501');
    assert.equal(await settlementCount(g1), before);

    const own = await record(ALICE, g1, ALICE, BOB, 100);
    assert.equal(own.ok, true, own.error ?? '');
    const s = await db.query(
      `SELECT created_by::text, payer_id::text, payee_id::text FROM public.settlements WHERE id = $1`,
      [own.rows[0].id],
    );
    assert.deepEqual(s.rows[0], { created_by: ALICE, payer_id: ALICE, payee_id: BOB });
  });

  test('anon не исполняет; SECURITY DEFINER, search_path закреплён, EXECUTE только у authenticated', async () => {
    const sig = 'public.record_settlement(uuid, uuid, uuid, numeric, text, text)';
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
});

describe('Закрытое событие', () => {
  test('P0423 пока событие закрыто; после открытия запись возможна', async () => {
    await setStatus(ALICE, g1, 'completed');
    const before = await settlementCount(g1);
    const closed = await record(BOB, g1, guest1, ALICE, 70);
    assert.equal(closed.ok, false);
    assert.equal(closed.code, 'P0423');
    assert.equal(await settlementCount(g1), before);

    await setStatus(ALICE, g1, 'active');
    const reopened = await record(BOB, g1, guest1, ALICE, 70);
    assert.equal(reopened.ok, true, reopened.error ?? '');
  });
});

describe('Удаление и прямой INSERT', () => {
  test('удалить может только автор записи', async () => {
    const res = await record(BOB, g1, guest1, ALICE, 33);
    assert.equal(res.ok, true, res.error ?? '');
    const id = res.rows[0].id;
    const exists = async () =>
      (await db.query(`SELECT count(*)::int AS n FROM public.settlements WHERE id = $1`, [id])).rows[0].n;

    const other = await asUser(db, ALICE, () => run(`DELETE FROM public.settlements WHERE id = $1 RETURNING id`, [id]));
    assert.equal(other.ok, true, other.error ?? '');
    assert.equal(other.rows.length, 0, 'чужой участник удалил запись');
    assert.equal(await exists(), 1);

    const own = await asUser(db, BOB, () => run(`DELETE FROM public.settlements WHERE id = $1 RETURNING id`, [id]));
    assert.equal(own.ok, true, own.error ?? '');
    assert.equal(own.rows.length, 1);
    assert.equal(await exists(), 0);
  });

  test('прежний прямой INSERT плательщика работает, created_by по умолчанию = плательщик', async () => {
    const res = await asUser(db, BOB, () =>
      run(
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, currency, payment_method, status)
         VALUES ($1, $2, $3, 15, 'RUB', 'sbp', 'completed') RETURNING id, created_by::text AS created_by`,
        [g1, BOB, ALICE],
      ),
    );
    assert.equal(res.ok, true, res.error ?? '');
    assert.equal(res.rows[0].created_by, BOB);
  });

  test('прямой INSERT с чужим created_by отклоняется RLS', async () => {
    const before = await settlementCount(g1);
    const res = await asUser(db, BOB, () =>
      run(
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, currency, payment_method, status, created_by)
         VALUES ($1, $2, $3, 15, 'RUB', 'sbp', 'completed', $4)`,
        [g1, BOB, ALICE, ALICE],
      ),
    );
    assert.equal(res.ok, false);
    assert.equal(res.code, '42501');
    assert.equal(await settlementCount(g1), before);
  });

  test('сторона перевода не может переписать created_by (ревью G3: «подарить» записи чужому счётчику)', async () => {
    const ins = await asUser(db, BOB, () =>
      run(
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, currency, payment_method, status)
         VALUES ($1, $2, $3, 16, 'RUB', 'sbp', 'completed') RETURNING id`,
        [g1, BOB, ALICE],
      ),
    );
    assert.equal(ins.ok, true, ins.error ?? '');
    const id = ins.rows[0].id;
    const upd = await asUser(db, BOB, () =>
      run(`UPDATE public.settlements SET created_by = $2 WHERE id = $1`, [id, ALICE]),
    );
    assert.equal(upd.ok, false);
    assert.equal(upd.code, '42501');
    const row = await db.query(`SELECT created_by::text AS c FROM public.settlements WHERE id = $1`, [id]);
    assert.equal(row.rows[0].c, BOB);
    // Остальные поля сторона по-прежнему правит (settlements_update_party).
    const amt = await asUser(db, BOB, () => run(`UPDATE public.settlements SET amount = 17 WHERE id = $1`, [id]));
    assert.equal(amt.ok, true, amt.error ?? '');
  });

  test('прямой INSERT плательщика-гостя (payer_id = NULL) отклоняется', async () => {
    const res = await asUser(db, BOB, () =>
      run(
        `INSERT INTO public.settlements (group_id, payer_id, payee_id, amount, currency, payment_method, status)
         VALUES ($1, NULL, $2, 15, 'RUB', 'sbp', 'completed')`,
        [g1, ALICE],
      ),
    );
    assert.equal(res.ok, false);
  });
});

describe('Лимит частоты', () => {
  test('31-я запись за 10 минут — P0429; другой пользователь не затронут', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await record(EVE, g3, guest3, EVE, 1);
      assert.equal(res.ok, true, `запись ${i + 1}: ${res.error ?? ''}`);
    }
    const over = await record(EVE, g3, guest3, EVE, 1);
    assert.equal(over.ok, false);
    assert.equal(over.code, 'P0429');
    assert.equal(await settlementCount(g3), 30);

    // Счёт идёт по автору: другой пользователь в другом событии пишет свободно.
    const dave = await record(DAVE, g2, guest2, DAVE, 1);
    assert.equal(dave.ok, true, dave.error ?? '');
  });

  test('записи старше 10 минут не считаются', async () => {
    await db.query(`UPDATE public.settlements SET created_at = now() - interval '11 minutes' WHERE group_id = $1`, [g3]);
    const res = await record(EVE, g3, guest3, EVE, 1);
    assert.equal(res.ok, true, res.error ?? '');
  });
});

describe('Публикация realtime', () => {
  test('DO-блок без публикации supabase_realtime — no-op: миграции применены, ограничения на месте', async () => {
    const pub = await db.query(`SELECT count(*)::int AS n FROM pg_publication WHERE pubname = 'supabase_realtime'`);
    assert.equal(pub.rows[0].n, 0, 'в харнессе появилась публикация — пересмотрите тест');
    const c = await db.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.settlements'::regclass
          AND conname IN ('settlements_payer_identified', 'settlements_payee_identified', 'settlements_participants_differ')`,
    );
    assert.equal(c.rows.length, 3);
  });
});

describe('Баланс', () => {
  test('перевод гость→Алиса на X меняет чистый баланс гостя ровно на X', async () => {
    // Отдельное событие, чтобы не зависеть от остальных переводов.
    const g4 = (await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Баланс', $1) RETURNING id`, [ALICE])).rows[0].id;
    await db.query(`INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [g4, ALICE]);
    const gu = await addGuest(ALICE, g4, 'Должник');
    const exp = await asUser(db, ALICE, () =>
      run(
        `SELECT public.add_expense_with_splits($1, 'Ужин', 1000, 'RUB', 1000, 'food', $2, $3::jsonb, NOW()) AS id`,
        [g4, ALICE, JSON.stringify([{ user_id: ALICE, amount_owed: 500 }, { user_id: gu, amount_owed: 500 }])],
      ),
    );
    assert.equal(exp.ok, true, exp.error ?? '');

    // net участника = оплачено - доли - отправлено переводов + получено переводов
    const net = async () => {
      const r = await db.query(
        `SELECT
           coalesce((SELECT sum(amount) FROM public.expenses WHERE group_id = $1 AND paid_by_participant_id = $2), 0)
         - coalesce((SELECT sum(es.amount_owed) FROM public.expense_splits es WHERE es.group_id = $1 AND es.participant_id = $2), 0)
         + coalesce((SELECT sum(amount) FROM public.settlements WHERE group_id = $1 AND payer_participant_id = $2), 0)
         - coalesce((SELECT sum(amount) FROM public.settlements WHERE group_id = $1 AND payee_participant_id = $2), 0)
           AS net`,
        [g4, gu],
      );
      return Number(r.rows[0].net);
    };

    assert.equal(await net(), -500);
    const rec = await asUser(db, ALICE, () => run(`SELECT public.record_settlement($1, $2, $3, 300) AS id`, [g4, gu, ALICE]));
    assert.equal(rec.ok, true, rec.error ?? '');
    assert.equal(await net(), -200, 'баланс гостя изменился не на сумму перевода');
  });
});
