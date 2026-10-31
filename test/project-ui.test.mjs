// Экраны «Проекта» (этап 3в): чистые функции UI, адрес возврата после входа и
// e2e-фейк store на сквозном сценарии §3а.4 (создать → позвать → условия →
// согласие → операции → итог → отметки). Без сети и без браузера.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPreset,
  consentState,
  formatQty,
  hoursPurpose,
  lineSummary,
  monthName,
  parseQty,
  parseRub,
  quantityFields,
  rateTimes,
  withMethod,
} from '../src/lib/project-ui.ts';
import { rememberReturnPath, safeReturnPath, takeReturnPath } from '../src/lib/auth-return.ts';
import { simulatePreview } from '../src/lib/project-calc.ts';

const line = (memberId, patch = {}) => ({
  memberId,
  expensesBack: true,
  rate: { type: 'none', amount: 0 },
  inRemainder: true,
  shareBp: 0,
  contribNew: 0,
  debtWriteOff: 0,
  ...patch,
});

describe('ввод сумм и количеств', () => {
  test('рубли → копейки: пробелы, запятая, ₽; > 2 знаков и мусор — null', () => {
    assert.equal(parseRub('60 000'), 6_000_000);
    assert.equal(parseRub('1500,5'), 150_050);
    assert.equal(parseRub('1 500.05 ₽'), 150_005);
    assert.equal(parseRub('0'), 0);
    assert.equal(parseRub(''), null);
    assert.equal(parseRub('1,234'), null);
    assert.equal(parseRub('-5'), null);
    assert.equal(parseRub('12abc'), null);
  });

  test('количество в сотых и обратно', () => {
    assert.equal(parseQty('10'), 1000);
    assert.equal(parseQty('2,5'), 250);
    assert.equal(parseQty('0.25'), 25);
    assert.equal(parseQty('1,255'), null);
    assert.equal(formatQty(1000), '10');
    assert.equal(formatQty(250), '2,5');
    assert.equal(formatQty(4000), '40');
  });

  test('живой расчёт ставки: половина копейки — вверх, как в ядре', () => {
    assert.equal(rateTimes(150_000, 1000), 1_500_000); // 10 ч × 1 500 ₽
    assert.equal(rateTimes(400_000, 250), 1_000_000); // 2,5 шт. × 4 000 ₽
    assert.equal(rateTimes(1, 50), 1); // 0,5 копейки → 1
    assert.equal(rateTimes(1, 49), 0);
  });
});

describe('правило полей часов и штук (§3а.1)', () => {
  test('ставка за час → только часы, для ставки', () => {
    const l = line('v', { rate: { type: 'hourly', amount: 150_000 } });
    assert.deepEqual(quantityFields(l, 'percent'), { hours: true, pieces: false });
    assert.equal(hoursPurpose(l), 'rate');
  });
  test('ставка за штуку при остатке не «по часам» → только штуки, часов нет', () => {
    assert.deepEqual(quantityFields(line('g', { rate: { type: 'piece', amount: 1 } }), 'equal'), { hours: false, pieces: true });
  });
  test('ставка за штуку при остатке «по часам» → часы (для остатка) и штуки', () => {
    const l = line('g', { rate: { type: 'piece', amount: 1 } });
    assert.deepEqual(quantityFields(l, 'hours'), { hours: true, pieces: true });
    assert.equal(hoursPurpose(l), 'remainder');
  });
  test('остаток «по часам», но участник в остатке не участвует → ничего', () => {
    assert.deepEqual(quantityFields(line('a', { inRemainder: false }), 'hours'), { hours: false, pieces: false });
  });
  test('фикс за период или нет ставки → полей нет; нет строки условий → полей нет', () => {
    assert.deepEqual(quantityFields(line('a', { rate: { type: 'period', amount: 1 } }), 'percent'), { hours: false, pieces: false });
    assert.deepEqual(quantityFields(undefined, 'hours'), { hours: false, pieces: false });
  });
});

describe('шаблоны и способ остатка (§3а.3)', () => {
  const ids = ['a', 'b', 'v'];
  test('«Поровну» — расходы каждый несёт сам', () => {
    const t = applyPreset('equal', ids);
    assert.equal(t.remainderMethod, 'equal');
    assert.ok(t.lines.every((l) => !l.expensesBack && l.inRemainder));
  });
  test('«Ставки + доли» — фикс у всех, доли в сумме 100 %, первому — копейка ничьей', () => {
    const t = applyPreset('b', ids);
    assert.equal(t.remainderMethod, 'percent');
    assert.deepEqual(t.lines.map((l) => l.shareBp), [3334, 3333, 3333]);
    assert.ok(t.lines.every((l) => l.rate.type === 'period'));
    assert.equal(t.contribEnabled, false);
    assert.equal(applyPreset('v', ids).contribEnabled, true);
  });
  test('«Свои» = «Вернуть расходы и поровну»', () => {
    assert.deepEqual(applyPreset('custom', ids), applyPreset('a', ids));
  });
  test('смена способа: «по %» раздаёт доли участвующим, другое — обнуляет', () => {
    const base = { ...applyPreset('a', ids), lines: [line('a'), line('b'), line('v', { inRemainder: false })] };
    const pct = withMethod(base, 'percent');
    assert.deepEqual(pct.lines.map((l) => l.shareBp), [5000, 5000, 0]);
    assert.deepEqual(withMethod(pct, 'hours').lines.map((l) => l.shareBp), [0, 0, 0]);
  });
  test('строка свёрнутой карточки', () => {
    const t = (k, v = {}) => `${k}${Object.values(v).length ? `(${Object.values(v).join(',')})` : ''}`;
    const terms = { contribEnabled: true, remainderMethod: 'percent', lines: [] };
    assert.equal(
      lineSummary(line('b', { contribNew: 3_000_000, shareBp: 4000 }), terms, t),
      'project.sum.expensesBack · project.sum.contribMoney(30 000 ₽) · 40 %',
    );
    assert.equal(
      lineSummary(line('v', { rate: { type: 'hourly', amount: 150_000 }, inRemainder: false, expensesBack: false }), terms, t),
      'project.sum.ownExpenses · project.sum.rate.hourly(1 500 ₽) · project.sum.noRemainder',
    );
  });
  test('суммы на экране не рвутся по строкам: неразрывные пробелы', async () => {
    const { formatRub, capitalize } = await import('../src/lib/project-ui.ts');
    assert.equal(formatRub(15_000_000), '150 000 ₽');
    assert.equal(formatRub(-333_333), '−3 333,33 ₽');
    assert.equal(capitalize('октябрь'), 'Октябрь');
  });
});

describe('предпросмотр на входах экрана (§3а.6)', () => {
  test('34 000 / 44 000 / 22 000 после ввода Вике примерных 10 ч', () => {
    const members = [
      { id: 'a', name: 'Аня', position: 1, role: 'user' },
      { id: 'b', name: 'Боря', position: 2, role: 'user' },
      { id: 'v', name: 'Вика', position: 3, role: 'guest' },
    ];
    const terms = {
      contribEnabled: true,
      remainderMethod: 'percent',
      lines: [
        line('a', { rate: { type: 'period', amount: 2_000_000 }, shareBp: 4000 }),
        line('b', { contribNew: 3_000_000, shareBp: 4000 }),
        line('v', { rate: { type: 'hourly', amount: 150_000 }, shareBp: 2000 }),
      ],
    };
    const ops = [{ type: 'income', memberId: 'a', amount: parseRub('100 000') }];
    const at = (hours) =>
      simulatePreview({ members, terms, operations: ops, quantities: { v: { hours: parseQty(hours), pieces: 0 } } }).after;
    assert.deepEqual(['a', 'b', 'v'].map((id) => at('0').perPerson[id].owed), [4_000_000, 5_000_000, 1_000_000]);
    assert.deepEqual(['a', 'b', 'v'].map((id) => at('10').perPerson[id].owed), [3_400_000, 4_400_000, 2_200_000]);
  });
});

describe('согласие на условия', () => {
  const data = (approvals, extra = {}) => ({
    project: { id: 'p', name: 'P', currency: 'RUB', owner_id: 'u-a', created_at: '' },
    members: [
      { id: 'a', project_id: 'p', kind: 'user', user_id: 'u-a', display_name: 'Аня', position: 1, status: 'active' },
      { id: 'b', project_id: 'p', kind: 'user', user_id: 'u-b', display_name: 'Боря', position: 2, status: 'active' },
      { id: 'v', project_id: 'p', kind: 'guest', user_id: null, display_name: 'Вика', position: 3, status: 'active' },
    ],
    terms: [{ id: 't1', project_id: 'p', status: 'proposed', proposed_by: 'u-a', effective_from_seq: 1, preset: 'custom', contrib_enabled: false, remainder_method: 'equal', created_at: '2' }, { id: 't0', project_id: 'p', status: 'active', proposed_by: 'u-a', effective_from_seq: 1, preset: 'custom', contrib_enabled: false, remainder_method: 'equal', created_at: '1' }].reverse(),
    lines: [],
    approvals,
    periods: [{ id: 'per', project_id: 'p', seq: 1, status: 'open', terms_id: 't0', revision: 1, opened_at: '2026-10-01T00:00:00Z', closed_at: null, snapshot: null }],
    quantities: [],
    ledger: [],
    transfers: [],
    ...extra,
  });
  test('предложение ждёт Борю; гость согласия не даёт; итог закрыт', () => {
    const c = consentState(data([{ terms_id: 't1', user_id: 'u-a', decision: 'accept' }, { terms_id: 't0', user_id: 'u-a', decision: 'accept' }]), 'u-b');
    assert.equal(c.pending?.id, 't1');
    assert.deepEqual(c.waiting, ['Боря']);
    assert.equal(c.answered, null);
    assert.equal(c.canClose, false); // период 1: первоначальные ещё не принял Боря
  });
  test('все приняли — итог можно подводить', () => {
    const d = data([
      { terms_id: 't0', user_id: 'u-a', decision: 'accept' },
      { terms_id: 't0', user_id: 'u-b', decision: 'accept' },
    ]);
    d.terms = d.terms.filter((x) => x.id === 't0');
    const c = consentState(d, 'u-a');
    assert.equal(c.pending, null);
    assert.equal(c.canClose, true);
  });
  test('отказ показывает, кто не согласен', () => {
    const d = data([{ terms_id: 't1', user_id: 'u-b', decision: 'decline' }]);
    d.terms = d.terms.map((x) => (x.id === 't1' ? { ...x, status: 'rejected' } : x));
    assert.equal(consentState(d, 'u-a').declinedBy, 'Боря');
  });
  test('месяц периода — именительный падеж', () => {
    assert.equal(monthName('2026-10-05T10:00:00Z', 'ru'), 'октябрь');
    assert.equal(monthName('nope', 'ru'), '');
  });
});

describe('адрес возврата после входа (SCENARIOS-AUDIT §4 п. 1)', () => {
  const kv = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };
  test('приглашение переживает уход на Google/Telegram и забирается один раз', () => {
    const s = kv();
    rememberReturnPath('/invite?code=ABC', s);
    assert.equal(takeReturnPath('/friends', s), '/invite?code=ABC');
    assert.equal(takeReturnPath('/friends', s), '/friends');
  });
  test('без приглашения — туда же, куда раньше', () => {
    assert.equal(takeReturnPath('/friends', kv()), '/friends');
  });
  test('чужие адреса не запоминаются: //evil, https://, /\\evil', () => {
    const s = kv();
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'invite', '']) {
      rememberReturnPath(bad, s);
      assert.equal(safeReturnPath(bad), null);
    }
    assert.equal(takeReturnPath('/', s), '/');
  });
});

describe('e2e-фейк store: сквозной сценарий §3а.4', () => {
  const mem = new Map();
  beforeEach(() => mem.clear());
  globalThis.window = {
    localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  };
  const as = (id, name) => mem.set('splitit_fake_projects_actor', JSON.stringify({ id, name }));

  test('создать → позвать → условия → согласие → операции → итог → 1 из 2 → 2 из 2', async () => {
    const { createFakeProjectsClient } = await import('../src/lib/projects-e2e-fake.ts');
    const { createProjectsStore, buildPeriodInput, toRpcTerms } = await import('../src/lib/projects-store.ts');
    const { calculatePeriod } = await import('../src/lib/project-calc.ts');
    const store = createProjectsStore(createFakeProjectsClient());

    as('u-anya', 'Аня');
    const body = toRpcTerms(applyPreset('custom', ['p1', 'p2']));
    const created = await store.createProject({
      name: 'Свадьба',
      guests: ['Вика'],
      terms: { ...body, lines: body.lines.map(({ member_id, ...l }) => ({ ...l, position: Number(member_id.slice(1)) })) },
    });
    assert.equal(created.error, null);
    const pid = created.data;
    const code = (await store.createInvite(pid)).data;
    assert.equal((await store.previewInvite(code)).data.memberCount, 2);

    as('u-borya', 'Боря');
    assert.ok((await store.joinByInvite(code)).data);
    // Ещё не принял первоначальные условия — итог закрыт.
    as('u-anya', 'Аня');
    let d = (await store.fetchProject(pid)).data;
    assert.deepEqual(consentState(d, 'u-anya').waiting, ['Боря']);
    const [A, V, B] = d.members.map((m) => m.id);
    const terms = {
      contribEnabled: true,
      remainderMethod: 'percent',
      lines: [
        line(A, { rate: { type: 'period', amount: 2_000_000 }, shareBp: 4000 }),
        line(B, { contribNew: 3_000_000, shareBp: 4000 }),
        line(V, { rate: { type: 'hourly', amount: 150_000 }, shareBp: 2000 }),
      ],
    };
    const proposed = await store.proposeTerms(pid, terms);
    as('u-borya', 'Боря');
    assert.equal((await store.acceptTerms(proposed.data)).data, 'active');

    as('u-anya', 'Аня');
    for (const [type, m, amount] of [
      ['income', A, 12_000_000], ['income', B, 6_000_000],
      ['expense', A, 1_500_000], ['expense', B, 600_000], ['expense', V, 900_000],
    ]) assert.equal((await store.addOperation(pid, { type, memberId: m, amount })).error, null);
    // Владелец вносит часы гостя; Боре часы не нужны.
    assert.equal((await store.setQuantity(pid, V, { hours: 1000 })).error, null);
    assert.match((await store.setQuantity(pid, B, { hours: 100 })).error, /только за себя|не нужны/);

    d = (await store.fetchProject(pid)).data;
    const open = d.periods.find((p) => p.status === 'open');
    const ops = (await store.fetchPeriodOperations(pid, open.id)).data;
    const res = calculatePeriod(buildPeriodInput(d, open.id, ops));
    assert.deepEqual([A, B, V].map((id) => res.perPerson[id].owed), [6_900_000, 7_000_000, 4_100_000]);

    // Устаревшая ревизия — отказ без изменений.
    assert.match((await store.closePeriod(pid, open.revision - 1)).error, /Данные изменились/);
    const snap = (await store.closePeriod(pid, open.revision)).data;
    assert.deepEqual(
      snap.transfers.map((x) => [x.fromId, x.toId, x.amount]),
      [[A, V, 4_100_000], [A, B, 1_000_000]],
    );
    d = (await store.fetchProject(pid)).data;
    assert.deepEqual(d.ledger.map((r) => [r.kind, r.amount]), [['credit', 3_000_000], ['repay', 3_000_000]]);
    assert.equal(d.periods.filter((p) => p.status === 'open').length, 1);

    assert.equal((await store.markTransferPaid(open.id, A, V)).error, null);
    assert.equal((await store.fetchProject(pid)).data.transfers.length, 1); // 1 из 2
    as('u-borya', 'Боря');
    assert.match((await store.markTransferPaid(open.id, A, B)).error, /отправитель/);
    as('u-anya', 'Аня');
    await store.markTransferPaid(open.id, A, B);
    await store.markTransferPaid(open.id, A, B); // повтор не дублирует
    assert.equal((await store.fetchProject(pid)).data.transfers.length, 2); // 2 из 2
  });

  test('сбой close_period: отказ ничего не меняет, обрыв — база выполнила', async () => {
    const { createFakeProjectsClient } = await import('../src/lib/projects-e2e-fake.ts');
    const { createProjectsStore, toRpcTerms } = await import('../src/lib/projects-store.ts');
    const store = createProjectsStore(createFakeProjectsClient());
    as('u-anya', 'Аня');
    const body = toRpcTerms(applyPreset('custom', ['p1']));
    const pid = (await store.createProject({ name: 'X', terms: { ...body, lines: body.lines.map(({ member_id, ...l }) => ({ ...l, position: 1 })) } })).data;
    const me = (await store.fetchProject(pid)).data.members[0].id;
    await store.addOperation(pid, { type: 'income', memberId: me, amount: 100 });
    const rev = () => store.fetchProject(pid).then((r) => r.data.periods.find((p) => p.status === 'open').revision);

    mem.set('splitit_fake_projects_fail', JSON.stringify({ fn: 'close_period', mode: 'error' }));
    assert.ok((await store.closePeriod(pid, await rev())).error);
    assert.equal((await store.fetchProject(pid)).data.periods.length, 1);

    mem.set('splitit_fake_projects_fail', JSON.stringify({ fn: 'close_period', mode: 'lost' }));
    const lost = await store.closePeriod(pid, await rev());
    assert.ok(lost.error);
    assert.equal((await store.fetchProject(pid)).data.periods.filter((p) => p.status === 'closed').length, 1);
  });
});
