/**
 * «Проект»: арифметика итога живёт в двух местах — src/lib/project-calc.ts
 * (предпросмотр) и private.project_calc / close_period (итог в базе). Здесь
 * общие сценарии test/fixtures/project-cases.json и 40 случайных (seed
 * фиксирован) прогоняются через обе реализации и сверяются по каждому человеку:
 * все слагаемые «положено», на руках, перевод, долг до/после, итоги периода,
 * переводы и строки журнала долга.
 *
 * Запуск: npm run test:rls
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestDatabase, asUser } from './pg-harness.mjs';
import { calculatePeriod, closePeriodDebt } from '../src/lib/project-calc.ts';

const OWNER = 'a0000000-0000-4000-8000-000000000001';
const CASES = JSON.parse(readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'project-cases.json'), 'utf-8')).cases;
const SEED = 20261031;
const RANDOM_CASES = 40;

const RATE = { none: 'none', fixed: 'period', hourly: 'hourly', piece: 'piece' };
const METHOD = { equal: 'equal', percent: 'percent', contrib: 'contributions', hours: 'hours' };

/** Условия фикстуры → Terms ядра; умолчания — как у базы (project_insert_terms). */
function calcTerms(t, ids) {
  return {
    contribEnabled: t.contrib_enabled ?? false,
    remainderMethod: METHOD[t.remainder_method ?? 'equal'],
    lines: t.lines.map((l) => ({
      memberId: ids[l.m],
      expensesBack: l.expenses_back ?? true,
      rate: { type: RATE[l.rate_type ?? 'none'], amount: l.rate_amount ?? 0 },
      inRemainder: l.in_remainder ?? true,
      shareBp: l.share_bp ?? 0,
      contribNew: l.contrib_new ?? 0,
      debtWriteOff: l.debt_write_off ?? 0,
    })),
  };
}

const sqlTerms = (t, key) => ({ ...t, lines: t.lines.map(({ m, ...rest }) => ({ ...rest, ...key(m) })) });

/** Ядро: период за периодом, долг — через closePeriodDebt, как журнал в базе. */
function runTs(c, ids) {
  const members = ids.map((id, i) => ({ id, name: i ? c.guests[i - 1] : 'Аня', position: i + 1, role: i ? 'guest' : 'user' }));
  let terms = calcTerms(c.periods[0].terms, ids);
  const contrib = {};
  const addContrib = (t) => t.lines.forEach((l) => (contrib[l.memberId] = (contrib[l.memberId] ?? 0) + l.contribNew));
  addContrib(terms);
  // Вклады первоначальной версии входят в долг периода 1 и пишутся в журнал при первом итоге.
  const initial = terms.contribEnabled
    ? ids.flatMap((id) => {
        const n = terms.lines.find((l) => l.memberId === id)?.contribNew ?? 0;
        return n > 0 ? [{ memberId: id, kind: 'credit', amount: n }] : [];
      })
    : [];
  let debt = Object.fromEntries(initial.map((e) => [e.memberId, e.amount]));
  const results = c.periods.map((p, k) => {
    const debtAtStart = { ...debt };
    const calc = calculatePeriod({
      members,
      terms,
      operations: p.ops.map(([type, m, amount]) => ({ type, memberId: ids[m], amount })),
      quantities: Object.fromEntries((p.qty ?? []).map(([m, hours, pieces]) => [ids[m], { hours: hours ?? 0, pieces: pieces ?? 0 }])),
      debtAtStart,
      contributionsTotal: { ...contrib },
    });
    const next = c.periods[k + 1]?.terms && calcTerms(c.periods[k + 1].terms, ids);
    const repaid = Object.fromEntries(ids.map((id) => [id, calc.perPerson[id].contributionBack]));
    const close = closePeriodDebt({ members, debtAtStart, repaid, nextTerms: next });
    debt = close.debtAtNextStart;
    if (next) {
      terms = next;
      addContrib(next);
    }
    return { calc, debtAtStart, ledger: [...(k === 0 ? initial : []), ...close.entries] };
  });
  return { results, debt };
}

/** База: владелец — единственный аккаунт, остальные — гости; условия принимаются сразу. */
async function runSql(db, c) {
  const call = (sql, params) => asUser(db, OWNER, async () => (await db.query(sql, params)).rows[0]?.v);
  const pid = await call(`SELECT public.create_project($1, 'RUB', $2::text[], $3::jsonb) AS v`, [
    c.name.slice(0, 80), c.guests, JSON.stringify(sqlTerms(c.periods[0].terms, (m) => ({ position: m + 1 }))),
  ]);
  const ids = (await db.query(`SELECT id FROM public.project_members WHERE project_id = $1 ORDER BY position`, [pid])).rows.map((r) => r.id);
  const snaps = [];
  for (const [k, p] of c.periods.entries()) {
    const opIds = [];
    for (const [type, m, amount, ref] of p.ops) {
      opIds.push(await call(
        `SELECT public.add_operation(p_project_id => $1::uuid, p_op_type => $2, p_amount => $3::bigint,
           p_member_id => $4::uuid, p_refund_of => $5::uuid) AS v`,
        [pid, type, amount, ids[m], ref === undefined ? null : opIds[ref]],
      ));
    }
    for (const [m, hours, pieces] of p.qty ?? []) {
      await call(`SELECT public.set_quantity($1::uuid, $2::uuid, $3::int, $4::bigint) AS v`, [pid, ids[m], hours, pieces]);
    }
    const next = c.periods[k + 1]?.terms;
    if (next) {
      assert.ok(k >= 1, 'условия периода 2 задать нельзя: до первого итога предложение заменяет условия периода 1');
      await call(`SELECT public.propose_terms($1::uuid, $2::jsonb) AS v`, [pid, JSON.stringify(sqlTerms(next, (m) => ({ member_id: ids[m] })))]);
    }
    const [{ revision }] = (await db.query(`SELECT revision FROM public.project_periods WHERE project_id = $1 AND status = 'open'`, [pid])).rows;
    snaps.push(await call(`SELECT public.close_period($1::uuid, $2::bigint) AS v`, [pid, revision]));
  }
  return { ids, snaps };
}

const PERSON = [
  ['expenses_back', 'expensesBack'], ['contribution_back', 'contributionBack'], ['rate_accrued', 'rateAccrued'],
  ['rate', 'rate'], ['remainder_share', 'remainderShare'], ['owed', 'owed'], ['on_hand', 'onHand'], ['transfer', 'transfer'],
];
const TOTALS = [
  ['net_income', 'netIncome'], ['profit', 'profit'], ['contributions_repaid', 'contributionsRepaid'],
  ['rates_accrued', 'ratesAccrued'], ['rates_paid', 'ratesPaid'], ['remainder', 'remainder'],
];

function views(snap, ts, ids) {
  const { calc } = ts;
  const sql = {
    totals: Object.fromEntries(TOTALS.map(([k]) => [k, Number(snap[k])])),
    people: snap.members.map((s) => ({
      id: s.member_id,
      ...Object.fromEntries(PERSON.map(([k]) => [k, Number(s[k])])),
      debt_before: Number(s.debt_before),
      ...(calc.debtAfter[s.member_id] === undefined ? {} : { debt_after: Number(s.debt_after) }),
    })),
    transfers: snap.transfers.map((t) => [t.from_member, t.to_member, Number(t.amount)]),
    ledger: snap.ledger.map((e) => [e.member_id, e.kind, Number(e.amount)]),
  };
  const core = {
    totals: Object.fromEntries(TOTALS.map(([k, ck]) => [k, calc[ck]])),
    people: ids.map((id) => ({
      id,
      ...Object.fromEntries(PERSON.map(([k, ck]) => [k, calc.perPerson[id][ck]])),
      debt_before: ts.debtAtStart[id] ?? 0,
      ...(calc.debtAfter[id] === undefined ? {} : { debt_after: calc.debtAfter[id] }),
    })),
    transfers: calc.transfers.map((t) => [t.fromId, t.toId, t.amount]),
    ledger: ts.ledger.map((e) => [e.memberId, e.kind, e.amount]),
  };
  return { sql, core };
}

async function assertSame(db, c) {
  const { ids, snaps } = await runSql(db, c);
  const { results } = runTs(c, ids);
  for (const [k, snap] of snaps.entries()) {
    const { sql, core } = views(snap, results[k], ids);
    assert.deepEqual(sql, core, `${c.name}, период ${k + 1}: база ≠ ядро\n${JSON.stringify(c)}`);
    for (const [key, want] of Object.entries(c.periods[k].expect ?? {})) {
      const got = key === 'transfers'
        ? sql.transfers.map(([f, t, a]) => [ids.indexOf(f), ids.indexOf(t), a])
        : sql.people.map((p) => p[key]);
      assert.deepEqual(got, want, `${c.name}, период ${k + 1}: ${key}`);
    }
  }
}

// ---------------------------------------------------------------- случайные сценарии

function rng(seed) {
  // mulberry32: воспроизводимо при том же seed.
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/** Условия, которые база примет: доли = 100 %, кто-то в остатке; debt — долг журнала по m (для изменения). */
function randomTerms(r, n, debt = null) {
  const method = pick(r, ['equal', 'percent', 'contrib', 'hours']);
  const contrib = method === 'contrib' || r() < 0.4;
  const lines = [];
  for (let m = 0; m < n; m++) {
    if (m > 0 && !(debt?.[m] > 0) && r() < 0.15) continue; // участник без строки
    const rateType = pick(r, ['none', 'none', 'fixed', 'hourly', 'piece']);
    lines.push({
      m,
      expenses_back: r() < 0.85,
      rate_type: rateType,
      rate_amount: rateType === 'none' ? 0 : int(r, 1, rateType === 'fixed' ? 3_000_000 : 300_000),
      in_remainder: r() < 0.75,
      contrib_new: contrib && r() < 0.5 ? int(r, 1, 5_000_000) : 0,
    });
  }
  if (!lines.some((l) => l.in_remainder)) lines[0].in_remainder = true;
  if (method === 'percent') {
    const inRem = lines.filter((l) => l.in_remainder);
    let left = 10_000;
    inRem.forEach((l, i) => {
      l.share_bp = i === inRem.length - 1 ? left : int(r, 1, left - (inRem.length - 1 - i));
      left -= l.share_bp;
    });
  }
  // Блок вкладов выключен — долг списывается целиком (§3а.7).
  if (debt) for (const l of lines) l.debt_write_off = !contrib ? debt[l.m] : r() < 0.5 ? int(r, 0, debt[l.m]) : 0;
  return { contrib_enabled: contrib, remainder_method: method, lines };
}

function randomPeriod(r, n, terms) {
  const ops = [];
  for (let i = int(r, 0, 7); i > 0; i--) {
    const kind = r();
    const m = int(r, 0, n - 1);
    const incomes = ops.map((o, idx) => [o, idx]).filter(([o]) => o[0] === 'income');
    if (kind < 0.15 && incomes.length) {
      const [inc, idx] = pick(r, incomes);
      const left = inc[2] - ops.filter((o) => o[3] === idx).reduce((s, o) => s + o[2], 0);
      if (left >= 1) ops.push(['income_refund', m, int(r, 1, left), idx]);
    } else {
      ops.push([kind < 0.6 ? 'income' : 'expense', m, int(r, 1, 3_000_000)]);
    }
  }
  const qty = [];
  for (const l of terms.lines) {
    const hours = l.rate_type === 'hourly' || terms.remainder_method === 'hours';
    const pieces = l.rate_type === 'piece';
    if ((hours || pieces) && r() < 0.85) qty.push([l.m, hours ? int(r, 0, 2000) : null, pieces ? int(r, 0, 1500) : null]);
  }
  return { ops, qty };
}

function randomCase(r, i) {
  const n = int(r, 2, 5);
  const guests = Array.from({ length: n - 1 }, (_, g) => `Гость ${g + 1}`);
  const t0 = randomTerms(r, n);
  const periods = [{ terms: t0, ...randomPeriod(r, n, t0) }];
  const count = int(r, 1, 3);
  if (count >= 2) periods.push(randomPeriod(r, n, t0));
  if (count === 3 && r() < 0.7) {
    // Изменение предлагается в периоде 2: долг журнала — после первого итога.
    const fake = Array.from({ length: n }, (_, m) => `m${m}`);
    const { debt } = runTs({ guests, periods: periods.slice(0, 1) }, fake);
    const t2 = randomTerms(r, n, fake.map((id) => debt[id] ?? 0));
    periods.push({ terms: t2, ...randomPeriod(r, n, t2) });
  } else if (count === 3) {
    periods.push(randomPeriod(r, n, t0));
  }
  return { name: `случайный №${i + 1} (seed ${SEED})`, guests, periods };
}

// ---------------------------------------------------------------------------

describe('close_period ↔ calculatePeriod/closePeriodDebt: одни и те же цифры', () => {
  let db;
  before(async () => {
    db = await createTestDatabase();
    await db.query(`INSERT INTO public.profiles (id, full_name, email) VALUES ($1, 'Аня', 'anya@example.com')`, [OWNER]);
  });

  for (const c of CASES) test(`фикстура: ${c.name}`, () => assertSame(db, c));

  const r = rng(SEED);
  for (let i = 0; i < RANDOM_CASES; i++) {
    const c = randomCase(r, i);
    test(c.name, () => assertSame(db, c));
  }
});
