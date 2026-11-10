// Клиентский слой «Проекта» (src/lib/projects-store.ts): преобразование строк
// базы во вход ядра и обратно, вызовы RPC и ошибки — на фейковом клиенте, без сети.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPeriodInput,
  contributionsTotal,
  createProjectsStore,
  ledgerBalance,
  mapSnapshot,
  toCalcTerms,
  toRpcTerms,
} from '../src/lib/projects-store.ts';
import { calculatePeriod } from '../src/lib/project-calc.ts';
import { t } from '../src/lib/i18n/t.ts';

const A = 'm-anya';
const B = 'm-borya';
const V = 'm-vika';
const P = 'proj-1';

/** Минимальный клиент: rpc и from().select().eq().order().range().maybeSingle(). */
function fakeClient({ tables = {}, rpc = async () => ({ data: null, error: null }), errors = {} } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(fn, args) {
      calls.push({ fn, args });
      return rpc(fn, args);
    },
    from(table) {
      const q = { filters: [], range: null, single: false };
      const exec = () => {
        calls.push({ table, filters: q.filters, range: q.range });
        if (errors[table]) return { data: null, error: errors[table] };
        let rows = (tables[table] ?? []).filter((r) => q.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)));
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        return { data: q.single ? rows[0] ?? null : rows, error: null };
      };
      const b = {
        select: () => b,
        eq: (c, v) => (q.filters.push([c, v]), b),
        in: (c, vs) => (q.filters.push([c, vs]), b),
        order: () => b,
        range: (from, to) => ((q.range = [from, to]), b),
        maybeSingle: () => ((q.single = true), b),
        then: (res, rej) => Promise.resolve(exec()).then(res, rej),
      };
      return b;
    },
  };
}

const member = (id, position, name, kind = 'user') => ({
  id, project_id: P, kind, user_id: kind === 'user' ? `u-${id}` : null, display_name: name, position, status: 'active',
});
const line = (termsId, memberId, patch = {}) => ({
  terms_id: termsId, member_id: memberId, expenses_back: true, rate_type: 'none', rate_amount: 0, in_remainder: true,
  share_bp: 0, contrib_new: 0, contrib_kind: 'money', contrib_note: null, debt_write_off: 0, leaves: false, ...patch,
});
const op = (id, type, memberId, amount, periodId = 'per-1') => ({
  id, period_id: periodId, op_type: type, amount, currency: 'RUB', exchange_rate: '1', amount_in_project_currency: amount,
  member_id: memberId, refund_of: null, occurred_on: '2026-10-31', title: '', note: null, created_by: 'u', created_at: id,
});

/** Строки базы для §3а.4 (период 1, журнал пуст: вклад Бори запишет итог). */
function mixedData() {
  return {
    project: { id: P, name: 'Свадьба', currency: 'RUB', owner_id: `u-${A}`, created_at: '' },
    // Порядок строк намеренно не по position.
    members: [member(V, 3, 'Вика'), member(A, 1, 'Аня'), member(B, 2, 'Боря')],
    terms: [{ id: 't1', project_id: P, status: 'active', proposed_by: 'u', effective_from_seq: 1, preset: 'custom', contrib_enabled: true, remainder_method: 'percent', created_at: '' }],
    lines: [
      line('t1', A, { rate_type: 'fixed', rate_amount: 2_000_000, share_bp: 4000 }),
      line('t1', B, { contrib_new: 3_000_000, share_bp: 4000 }),
      line('t1', V, { rate_type: 'hourly', rate_amount: 150_000, share_bp: 2000 }),
    ],
    approvals: [],
    periods: [{ id: 'per-1', project_id: P, seq: 1, status: 'open', terms_id: 't1', revision: 7, opened_at: '', closed_at: null, snapshot: null }],
    quantities: [{ period_id: 'per-1', member_id: V, hours: 1000, pieces: 0 }],
    ledger: [],
    transfers: [],
  };
}
const MIXED_OPS = [
  op('o1', 'income', A, 12_000_000),
  op('o2', 'income', B, 6_000_000),
  op('o3', 'expense', A, 1_500_000),
  op('o4', 'expense', B, 600_000),
  op('o5', 'expense', V, 900_000),
  op('o6', 'income', A, 999, 'per-0'), // другой период — не входит
];

describe('преобразования', () => {
  test('условия базы ↔ ядра: fixed ↔ period, contrib ↔ contributions', () => {
    const data = mixedData();
    const terms = toCalcTerms(data.terms[0], data.lines);
    assert.equal(terms.remainderMethod, 'percent');
    assert.deepEqual(terms.lines.map((l) => l.rate.type), ['period', 'none', 'hourly']);
    const body = toRpcTerms({ ...terms, remainderMethod: 'contributions' }, { preset: 'v', leaving: [B] });
    assert.equal(body.preset, 'v');
    assert.equal(body.remainder_method, 'contrib');
    assert.deepEqual(body.lines.map((l) => [l.rate_type, l.leaves]), [['fixed', false], ['none', true], ['hourly', false]]);
    assert.equal(body.lines[1].contrib_new, 3_000_000);
  });

  test('§3а.4 из строк базы: ядро даёт Аня → Вика 41 000, Аня → Боря 10 000', () => {
    const input = buildPeriodInput(mixedData(), 'per-1', MIXED_OPS);
    assert.equal(input.operations.length, 5, 'операция другого периода не вошла');
    assert.deepEqual(input.debtAtStart, { [B]: 3_000_000 }, 'период 1: вклад первоначальной версии уже в долге');
    const r = calculatePeriod(input);
    assert.deepEqual(r.transfers, [{ fromId: A, toId: V, amount: 4_100_000 }, { fromId: A, toId: B, amount: 1_000_000 }]);
    assert.deepEqual(r.order.map((id) => r.perPerson[id].owed), [6_900_000, 7_000_000, 4_100_000]);
  });

  test('долг на начало — баланс журнала; со 2-го периода вклады версии не добавляются второй раз', () => {
    const data = mixedData();
    data.periods = [
      { ...data.periods[0], status: 'closed' },
      { ...data.periods[0], id: 'per-2', seq: 2 },
    ];
    data.ledger = [
      { id: 1, member_id: B, period_id: 'per-1', kind: 'credit', amount: 3_000_000 },
      { id: 2, member_id: B, period_id: 'per-1', kind: 'repay', amount: 2_000_000 },
    ];
    assert.deepEqual(ledgerBalance(data.ledger), { [B]: 1_000_000 });
    assert.deepEqual(buildPeriodInput(data, 'per-2', []).debtAtStart, { [B]: 1_000_000 });
  });

  test('вес «по вкладам»: сумма версий, действовавших к периоду; заменённая до итога версия не считается', () => {
    const data = mixedData();
    data.terms.push({ ...data.terms[0], id: 't0', status: 'superseded' }, { ...data.terms[0], id: 't2', effective_from_seq: 3 });
    data.lines.push(line('t0', A, { contrib_new: 50_000_000 }), line('t2', B, { contrib_new: 500_000 }), line('t2', A, { contrib_new: 100 }));
    data.periods = [
      { ...data.periods[0], status: 'closed' },
      { ...data.periods[0], id: 'per-2', seq: 2, status: 'closed' },
      { ...data.periods[0], id: 'per-3', seq: 3, terms_id: 't2' },
    ];
    assert.deepEqual(contributionsTotal(data, 2), { [A]: 0, [B]: 3_000_000, [V]: 0 });
    assert.deepEqual(contributionsTotal(data, 3), { [A]: 100, [B]: 3_500_000, [V]: 0 });
    assert.deepEqual(buildPeriodInput(data, 'per-3', []).contributionsTotal, { [A]: 100, [B]: 3_500_000, [V]: 0 });
  });

  test('снимок итога: snake_case → camelCase, суммы — целые копейки', () => {
    const s = mapSnapshot({
      period_id: 'per-1', seq: 1, terms_id: 't1', net_income: 18_000_000, profit: 15_000_000, contributions_repaid: 3_000_000,
      rates_accrued: 3_500_000, rates_paid: 3_500_000, remainder: 8_500_000,
      members: [{ member_id: A, name: 'Аня', position: 1, expenses_back: 1_500_000, contribution_back: 0, rate_accrued: 2_000_000, rate: 2_000_000, remainder_share: 3_400_000, owed: 6_900_000, on_hand: 12_000_000, transfer: -5_100_000, debt_before: 0, debt_after: 0, hours: 0, pieces: 0 }],
      transfers: [{ from_member: A, to_member: V, amount: 4_100_000 }],
      ledger: [{ member_id: B, kind: 'credit', amount: 3_000_000, period: 'current' }],
    });
    assert.equal(s.members[0].transfer, -5_100_000);
    assert.deepEqual(s.transfers, [{ fromId: A, toId: V, amount: 4_100_000 }]);
    assert.deepEqual(s.ledger, [{ memberId: B, kind: 'credit', amount: 3_000_000, period: 'current' }]);
    assert.throws(() => mapSnapshot({ net_income: 1.5 }), /целые копейки/);
  });
});

describe('вызовы и ошибки', () => {
  test('без бэкенда — честная ошибка, а не пустой успех', async () => {
    const store = createProjectsStore(null);
    assert.deepEqual(await store.acceptTerms('t1'), { data: null, error: t('errors.noBackend') });
    assert.deepEqual(await store.fetchProject(P), { data: null, error: t('errors.noBackend') });
  });

  test('аргументы RPC: операция, количество, условия', async () => {
    const client = fakeClient({ rpc: async () => ({ data: 'id-1', error: null }) });
    const store = createProjectsStore(client);
    assert.deepEqual(
      await store.addOperation(P, { type: 'income_refund', amount: 600_000, memberId: A, refundOf: 'o1' }),
      { data: 'id-1', error: null },
    );
    await store.setQuantity(P, V, { hours: 1000 });
    await store.proposeTerms(P, toCalcTerms(mixedData().terms[0], mixedData().lines), { leaving: [B] });
    const [add, qty, prop] = client.calls;
    assert.equal(add.fn, 'add_operation');
    assert.deepEqual(add.args, {
      p_project_id: P, p_op_type: 'income_refund', p_amount: 600_000, p_member_id: A, p_refund_of: 'o1',
      p_currency: null, p_exchange_rate: 1, p_occurred_on: null, p_title: null, p_note: null,
    });
    assert.deepEqual(qty.args, { p_project_id: P, p_member_id: V, p_hours: 1000, p_pieces: null }, 'штуки не трогаем');
    assert.equal(prop.args.p_terms.lines[1].leaves, true);
  });

  test('ошибка базы: человеческое сообщение как есть, сеть — «нет связи», неизвестный сбой итога — не «отказ»', async () => {
    const stale = { code: 'P0409', message: 'Данные изменились — посмотрите итог ещё раз' };
    let next = stale;
    const store = createProjectsStore(fakeClient({ rpc: async () => ({ data: null, error: next }) }));
    assert.equal((await store.closePeriod(P, 7)).error, stale.message);
    next = { code: 'XX000', message: 'internal' };
    assert.deepEqual(await store.closePeriod(P, 7), { data: null, error: 'internal', failure: 'unknown' });
    next = { message: 'TypeError: Failed to fetch' };
    assert.equal((await store.acceptTerms('t1')).error, t('errors.noServerConnection'));
    next = { code: '23505', message: 'duplicate key' };
    assert.equal((await store.joinByInvite('c')).error, t('errors.duplicateRecord'));
  });

  test('closePeriod разбирает снимок; preview — только четыре поля', async () => {
    const store = createProjectsStore(fakeClient({
      rpc: async (fn) => (fn === 'close_period'
        ? { data: { period_id: 'per-1', seq: 1, terms_id: 't1', net_income: 0, profit: 0, contributions_repaid: 0, rates_accrued: 0, rates_paid: 0, remainder: 0, members: [], transfers: [], ledger: [] }, error: null }
        : { data: { project_name: 'Свадьба', inviter_name: 'Аня', member_count: 3, is_active: true }, error: null }),
    }));
    assert.equal((await store.closePeriod(P, 7)).data.periodId, 'per-1');
    assert.deepEqual((await store.previewInvite('c')).data, { projectName: 'Свадьба', inviterName: 'Аня', memberCount: 3, isActive: true });
  });

  test('fetchProject: сортировка по position и seq; чужой проект — нет прав; сбой таблицы — ошибка целиком', async () => {
    const d = mixedData();
    const tables = {
      projects: [d.project],
      project_members: d.members,
      project_terms: d.terms,
      project_term_lines: d.lines.map((l) => ({ ...l, project_id: P })),
      project_periods: [{ ...d.periods[0], id: 'per-2', seq: 2 }, d.periods[0]],
      project_contribution_ledger: [{ id: 2, project_id: P }, { id: 1, project_id: P }],
    };
    const ok = await createProjectsStore(fakeClient({ tables })).fetchProject(P);
    assert.equal(ok.error, null);
    assert.deepEqual(ok.data.members.map((m) => m.position), [1, 2, 3]);
    assert.deepEqual(ok.data.periods.map((p) => p.seq), [1, 2]);
    assert.deepEqual(ok.data.ledger.map((r) => r.id), [1, 2]);
    assert.equal((await createProjectsStore(fakeClient({ tables })).fetchProject('other')).error, t('errors.insufficientPermissions'));
    const broken = await createProjectsStore(fakeClient({
      tables,
      errors: { project_quantities: { code: '42501', message: 'Проект не найден или недоступен' } },
    })).fetchProject(P);
    // 42501 — отказ RLS: экран со снимком сотрёт его (круг 2 1.1.1).
    assert.deepEqual(broken, { data: null, error: 'Проект не найден или недоступен', reason: 'denied' });
  });

  test('fetchProject догружает финансовые таблицы всеми страницами; сверх лимита — ошибка, а не обрезка', async () => {
    const d = mixedData();
    const ledger = Array.from({ length: 1203 }, (_, i) => ({ id: i + 1, project_id: P, member_id: B, kind: 'credit', amount: 1 }));
    const quantities = Array.from({ length: 501 }, (_, i) => ({ project_id: P, period_id: `per-${i}`, member_id: V, hours: 100, pieces: 0 }));
    const tables = { projects: [d.project], project_members: d.members, project_contribution_ledger: ledger, project_quantities: quantities };
    const client = fakeClient({ tables });
    const res = await createProjectsStore(client).fetchProject(P);
    assert.equal(res.error, null);
    assert.equal(res.data.ledger.length, 1203);
    assert.equal(res.data.quantities.length, 501);
    assert.equal(client.calls.filter((c) => c.table === 'project_contribution_ledger').length, 3, 'три страницы по 500');
    assert.equal(ledgerBalance(res.data.ledger)[B], 1203, 'долг посчитан по всем строкам журнала');

    const huge = Array.from({ length: 20_001 }, (_, i) => ({ id: i + 1, project_id: P, member_id: B, kind: 'credit', amount: 1 }));
    const over = await createProjectsStore(fakeClient({ tables: { ...tables, project_contribution_ledger: huge } })).fetchProject(P);
    assert.deepEqual(over, { data: null, error: 'Слишком много записей в проекте — не удалось загрузить все' });
  });

  test('fetchHome: данные каждого проекта — только его строки, операции — только открытого периода, тот же расчёт', async () => {
    const d = mixedData();
    const Q = 'proj-2';
    const other = { ...d.project, id: Q, name: 'Второй' };
    const withP = (rows, pid) => rows.map((r) => ({ ...r, project_id: pid }));
    const tables = {
      projects: [d.project, other],
      project_members: [...d.members, ...withP(d.members, Q).map((m) => ({ ...m, id: `q-${m.id}` }))],
      project_terms: [...d.terms, ...withP(d.terms, Q).map((x) => ({ ...x, id: `q-${x.id}` }))],
      project_term_lines: withP(d.lines, P),
      project_periods: [
        ...d.periods,
        { ...d.periods[0], id: 'q-per-1', project_id: Q, status: 'closed' },
        { ...d.periods[0], id: 'q-per-2', project_id: Q, seq: 2, terms_id: 'q-t1' },
      ],
      project_operations: [
        { ...op('o1', 'income', A, 5000), project_id: P },
        { ...op('o2', 'income', A, 7000, 'q-per-1'), project_id: Q },
        { ...op('o3', 'expense', A, 100, 'q-per-2'), project_id: Q },
      ],
    };
    const client = fakeClient({ tables });
    const res = await createProjectsStore(client).fetchHome();
    assert.equal(res.error, null);
    assert.deepEqual(res.data.map((x) => x.data.project.id), [P, Q]);
    assert.ok(res.data[1].data.members.every((m) => m.project_id === Q));
    assert.deepEqual(res.data[0].openOps.map((o) => o.id), ['o1']);
    assert.deepEqual(res.data[1].openOps.map((o) => o.id), ['o3'], 'операции закрытого периода в сводку не попадают');
    const opsCalls = client.calls.filter((c) => c.table === 'project_operations');
    assert.equal(opsCalls.length, 1, 'операции всех проектов — одним запросом');
    assert.deepEqual(opsCalls[0].filters, [['period_id', ['per-1', 'q-per-2']]]);
    assert.ok(!client.calls.some((c) => c.table === 'project_transfers'), 'журнал отметок главной не нужен');
    // Та же цифра, что даёт экран проекта (fetchProject + fetchPeriodOperations).
    const store = createProjectsStore(fakeClient({ tables }));
    const full = await store.fetchProject(P);
    const fullOps = await store.fetchPeriodOperations(P, 'per-1');
    assert.deepEqual(
      calculatePeriod(buildPeriodInput(res.data[0].data, 'per-1', res.data[0].openOps)),
      calculatePeriod(buildPeriodInput(full.data, 'per-1', fullOps.data)),
    );
  });

  test('fetchProject: два одновременных вызова — один набор запросов', async () => {
    const d = mixedData();
    const client = fakeClient({ tables: { projects: [d.project], project_members: d.members } });
    const store = createProjectsStore(client);
    const [a, b] = await Promise.all([store.fetchProject(P), store.fetchProject(P)]);
    assert.equal(a, b);
    assert.equal(client.calls.filter((c) => c.table === 'projects').length, 1);
    await store.fetchProject(P);
    assert.equal(client.calls.filter((c) => c.table === 'projects').length, 2, 'после ответа — снова свежее чтение');
  });

  test('fetchPeriodOperations догружает все страницы и фильтрует по периоду', async () => {
    const rows = Array.from({ length: 503 }, (_, i) => ({ ...op(`o${String(i).padStart(4, '0')}`, 'income', A, 100), project_id: P }));
    rows.push({ ...op('x', 'income', A, 100, 'per-2'), project_id: P });
    const client = fakeClient({ tables: { project_operations: rows } });
    const res = await createProjectsStore(client).fetchPeriodOperations(P, 'per-1');
    assert.equal(res.error, null);
    assert.equal(res.data.length, 503);
    assert.equal(client.calls.filter((c) => c.table === 'project_operations').length, 2, 'две страницы по 500');
  });
});
