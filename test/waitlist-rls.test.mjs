/**
 * Контракт waitlist после 20260815000000_harden_waitlist.sql.
 *
 * Запуск: npm run test:rls
 *
 * Что доказывается на настоящем PostgreSQL, а не чтением SQL:
 *   1. аноним не пишет в таблицу напрямую;
 *   2. аноним не читает таблицу;
 *   3. единственный вход — join_waitlist, он нормализует адрес;
 *   4. повторный вызов с тем же адресом неотличим от первого — оракула
 *      «есть ли этот email в списке» больше нет;
 *   5. мусор вместо адреса отклоняется.
 *
 * Проверка №4 — главная. До миграции клиент делал прямой INSERT и получал
 * 23505 на дубликате, то есть публичная форма отвечала на вопрос, который
 * никому снаружи задавать нельзя.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, attempt } from './pg-harness.mjs';

let db;

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await db?.close?.();
});

/** Запросы от лица анонима: роль anon без claim, как у неавторизованного клиента. */
async function asAnon(fn) {
  await db.exec('SET ROLE anon;');
  const who = await db.query('SELECT current_user AS role');
  if (who.rows[0].role !== 'anon') {
    throw new Error(`Роль не переключилась: current_user = ${who.rows[0].role}`);
  }
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
  }
}

describe('waitlist: запись только через join_waitlist', () => {
  test('аноним не пишет в таблицу напрямую', async () => {
    const res = await asAnon(() =>
      attempt(db, `INSERT INTO public.waitlist (email) VALUES ('direct@example.com')`),
    );

    assert.equal(res.ok, false, 'прямой INSERT от анонима обязан быть отклонён');
    assert.match(res.error, /row-level security|permission denied/i);
  });

  test('аноним не читает таблицу', async () => {
    // Служебной вставкой кладём строку от владельца схемы, чтобы читать было что.
    await db.query(`INSERT INTO public.waitlist (email) VALUES ('seeded@example.com')`);

    const res = await asAnon(() => attempt(db, `SELECT email FROM public.waitlist`));

    // Отказ приходит одним из двух способов, и оба засчитываются:
    //   * нет табличного GRANT SELECT для anon — ошибка прав (так в чистом
    //     PostgreSQL этого харнесса);
    //   * есть GRANT, но политика "Deny client read waitlist" из
    //     20260809000001 отдаёт пустую выборку (так в Supabase, где GRANT
    //     выдаётся при создании проекта).
    // Чего быть не должно — успешного чтения строк.
    if (res.ok) {
      assert.deepEqual(res.rows, [], 'аноним не должен видеть ни одной строки waitlist');
    } else {
      assert.match(res.error, /permission denied|row-level security/i);
    }
  });

  test('join_waitlist принимает адрес и нормализует его', async () => {
    const res = await asAnon(() =>
      attempt(db, `SELECT public.join_waitlist('  User@Example.COM ')`),
    );
    assert.equal(res.ok, true, res.error ?? '');

    const stored = await db.query(
      `SELECT email FROM public.waitlist WHERE email = 'user@example.com'`,
    );
    assert.equal(stored.rows.length, 1, 'адрес должен храниться в нижнем регистре и без пробелов');
  });

  test('повторный вызов не отличается от первого', async () => {
    const first = await asAnon(() => attempt(db, `SELECT public.join_waitlist('twice@example.com')`));
    const second = await asAnon(() => attempt(db, `SELECT public.join_waitlist('TWICE@example.com')`));

    assert.equal(first.ok, true, first.error ?? '');
    assert.equal(second.ok, true, 'дубликат не должен отличаться от вставки — иначе это оракул');

    const rows = await db.query(
      `SELECT count(*)::int AS n FROM public.waitlist WHERE email = 'twice@example.com'`,
    );
    assert.equal(rows.rows[0].n, 1, 'дубликат не должен создавать вторую строку');
  });

  test('мусор вместо адреса отклоняется', async () => {
    for (const bad of ['', 'no-at-sign', 'a@b', 'two words@example.com']) {
      const res = await asAnon(() => attempt(db, `SELECT public.join_waitlist($1)`, [bad]));
      assert.equal(res.ok, false, `адрес «${bad}» обязан быть отклонён`);
    }
  });

  test('ограничения на длину и форму заведены в схеме', async () => {
    const constraints = await db.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.waitlist'::regclass AND contype = 'c'
    `);
    const names = constraints.rows.map((r) => r.conname);
    assert.ok(names.includes('waitlist_email_length'), 'нет ограничения длины');
    assert.ok(names.includes('waitlist_email_format'), 'нет ограничения формы');
  });
});
