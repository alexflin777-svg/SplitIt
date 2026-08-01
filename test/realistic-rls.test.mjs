import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser, attempt } from './pg-harness.mjs';
import { GRADUATION_GROUP, REALISTIC_GROUPS, ROAD_TRIP_GROUP } from './fixtures/realistic-groups.ts';

let db;
const groupIds = new Map();

async function createScenario(group) {
  const owner = group.members[0];
  const groupId = await asUser(db, owner.id, async () => {
    const created = await db.query(
      `SELECT public.create_group_with_owner($1, $2, $3)::text AS id`,
      [group.name, group.category, group.currency],
    );
    return created.rows[0].id;
  });

  for (const [index, member] of group.members.slice(1).entries()) {
    const code = `${group.id}-${index + 1}`.toUpperCase();
    await asUser(db, owner.id, () =>
      db.query(
        `INSERT INTO public.group_invites (group_id, invite_code, created_by)
         VALUES ($1, $2, $3)`,
        [groupId, code, owner.id],
      ),
    );
    await asUser(db, member.id, () => db.query(`SELECT public.redeem_group_invite($1)`, [code]));
  }

  for (const expense of group.expenses) {
    const result = await asUser(db, expense.paidById, () =>
      db.query(
        `SELECT public.add_expense_with_splits(
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz
         )::text AS id`,
        [
          groupId,
          expense.title,
          expense.amount,
          expense.currency,
          expense.amountInGroupCurrency,
          expense.category,
          expense.paidById,
          JSON.stringify(
            expense.splits.map((split) => ({ user_id: split.userId, amount_owed: split.amountOwed })),
          ),
          expense.createdAt,
        ],
      ),
    );
    assert.ok(result.rows[0]?.id, `${expense.title}: RPC не вернула id`);
  }

  for (const settlement of group.settlements) {
    await asUser(db, settlement.fromUserId, () =>
      db.query(
        `INSERT INTO public.settlements
           (group_id, payer_id, payee_id, amount, currency, payment_method, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          groupId,
          settlement.fromUserId,
          settlement.toUserId,
          settlement.amount,
          settlement.currency,
          settlement.paymentMethod,
          settlement.status,
          settlement.createdAt,
        ],
      ),
    );
  }

  return groupId;
}

before(async () => {
  db = await createTestDatabase();
  const members = REALISTIC_GROUPS.flatMap((group) => group.members);
  const values = members.map((_, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`).join(',');
  const params = members.flatMap((member) => [member.id, member.name, member.email]);
  await db.query(`INSERT INTO public.profiles (id, full_name, email) VALUES ${values}`, params);

  for (const group of REALISTIC_GROUPS) groupIds.set(group.id, await createScenario(group));
});
after(async () => {
  await db?.close();
});

describe('Две реалистичные группы в PostgreSQL', () => {
  test('созданы 4 участника поездки и 10 участников выпускного', async () => {
    const travelCount = await db.query(
      `SELECT count(*)::int AS n FROM public.group_members WHERE group_id = $1`,
      [groupIds.get(ROAD_TRIP_GROUP.id)],
    );
    const graduationCount = await db.query(
      `SELECT count(*)::int AS n FROM public.group_members WHERE group_id = $1`,
      [groupIds.get(GRADUATION_GROUP.id)],
    );
    assert.equal(travelCount.rows[0].n, 4);
    assert.equal(graduationCount.rows[0].n, 10);
  });

  test('каждый из 14 пользователей видит ровно свою группу', async () => {
    for (const group of REALISTIC_GROUPS) {
      for (const member of group.members) {
        const rows = await asUser(db, member.id, async () => {
          const result = await db.query(`SELECT id::text, name FROM public.groups ORDER BY name`);
          return result.rows;
        });
        assert.deepEqual(rows.map((row) => row.name), [group.name], `${member.name}: нарушена изоляция`);
      }
    }
  });

  test('профили доступны только участникам общей группы', async () => {
    const travelProfiles = await asUser(db, ROAD_TRIP_GROUP.members[1].id, async () => {
      const result = await db.query(`SELECT id::text FROM public.profiles`);
      return result.rows.map((row) => row.id);
    });
    const graduationProfiles = await asUser(db, GRADUATION_GROUP.members[1].id, async () => {
      const result = await db.query(`SELECT id::text FROM public.profiles`);
      return result.rows.map((row) => row.id);
    });

    assert.equal(travelProfiles.length, 4);
    assert.equal(graduationProfiles.length, 10);
    assert.equal(travelProfiles.some((id) => graduationProfiles.includes(id)), false);
  });

  test('расходы и доли сохранены полностью и без потери денег', async () => {
    for (const group of REALISTIC_GROUPS) {
      const expectedTotal = group.expenses.reduce((sum, expense) => sum + expense.amountInGroupCurrency, 0);
      const totals = await asUser(db, group.members[0].id, async () => {
        const expenses = await db.query(
          `SELECT count(*)::int AS n, sum(amount_in_group_currency)::numeric AS total
           FROM public.expenses WHERE group_id = $1`,
          [groupIds.get(group.id)],
        );
        const splits = await db.query(
          `SELECT count(*)::int AS n, sum(es.amount_owed)::numeric AS total
           FROM public.expense_splits es
           JOIN public.expenses e ON e.id = es.expense_id
           WHERE e.group_id = $1`,
          [groupIds.get(group.id)],
        );
        return { expenses: expenses.rows[0], splits: splits.rows[0] };
      });

      assert.equal(totals.expenses.n, group.expenses.length);
      assert.equal(Number(totals.expenses.total), expectedTotal);
      assert.equal(totals.splits.n, group.expenses.length * group.members.length);
      assert.equal(Number(totals.splits.total), expectedTotal);
    }
  });

  test('участник поездки не может записать расход в выпускной и наоборот', async () => {
    const attempts = [
      [ROAD_TRIP_GROUP.members[1], groupIds.get(GRADUATION_GROUP.id)],
      [GRADUATION_GROUP.members[1], groupIds.get(ROAD_TRIP_GROUP.id)],
    ];

    for (const [member, foreignGroupId] of attempts) {
      const result = await asUser(db, member.id, () =>
        attempt(
          db,
          `SELECT public.add_expense_with_splits(
             $1, 'Чужой расход', 100, 'RUB', 100, 'other', $2,
             $3::jsonb, NOW()
           )`,
          [foreignGroupId, member.id, JSON.stringify([{ user_id: member.id, amount_owed: 100 }])],
        ),
      );
      assert.equal(result.ok, false, `${member.name} записал расход в чужую группу`);
    }
  });

  test('погашение поездки видно её участникам и скрыто от выпускного', async () => {
    const travelSettlements = await asUser(db, ROAD_TRIP_GROUP.members[2].id, async () => {
      const result = await db.query(`SELECT amount FROM public.settlements`);
      return result.rows;
    });
    const graduationSettlements = await asUser(db, GRADUATION_GROUP.members[2].id, async () => {
      const result = await db.query(`SELECT amount FROM public.settlements`);
      return result.rows;
    });

    assert.equal(travelSettlements.length, 1);
    assert.equal(Number(travelSettlements[0].amount), 3_400);
    assert.deepEqual(graduationSettlements, []);
  });
});
