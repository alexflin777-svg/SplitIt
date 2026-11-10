/**
 * Фейковый клиент Supabase для «Проекта» — ТОЛЬКО для e2e-сборки (`npm run build:test`:
 * NEXT_PUBLIC_OCR_TEST_HOOK=1 и без бэкенда). В обычной сборке не подключается
 * (см. projects-client.ts): без бэкенда проекты честно отвечают «нет бэкенда».
 *
 * Повторяет контракт RPC миграции 20261101000000_projects.sql в объёме экранов
 * 3в: те же имена, аргументы, коды ошибок и тот же расчёт (ядро project-calc).
 * Данные — в localStorage, чтобы переживать переходы статического экспорта.
 *
 * Управление из теста (window.localStorage):
 *   splitit_fake_projects_actor — {"id","name"}: от чьего имени вызовы (по умолчанию — локальная сессия);
 *   splitit_fake_projects_fail  — {"fn","mode"}: один сбой RPC; mode 'error' — отказ базы,
 *                                 'lost' — база выполнила, ответ потерян (обрыв связи);
 *                                 fn "table:<имя>" — один сбой чтения таблицы: 'denied' (403/42501) или 'lost'.
 *   splitit_fake_latency_ms     — задержка «сети» на каждый запрос (замер v1.1/perf/measure.mjs);
 *                                 счётчик запросов и одновременности — window.__splititNet.
 */

import { calculatePeriod, closePeriodDebt } from './project-calc';
import { buildPeriodInput, toCalcTerms } from './projects-store';
import type { ProjectData } from './projects-store';
import { getLocalSession } from './supabase';

const DB_KEY = 'splitit_fake_projects';
const ACTOR_KEY = 'splitit_fake_projects_actor';
const FAIL_KEY = 'splitit_fake_projects_fail';
const LATENCY_KEY = 'splitit_fake_latency_ms';

/** Один «сетевой» запрос: считается всегда, задерживается только с флагом замера. */
export async function fakeLatency(label: string): Promise<void> {
  const w = window as unknown as { __splititNet?: { total: number; inflight: number; maxInflight: number; log: [string, number][] } };
  const n = (w.__splititNet ??= { total: 0, inflight: 0, maxInflight: 0, log: [] });
  n.total++;
  n.inflight++;
  n.maxInflight = Math.max(n.maxInflight, n.inflight);
  n.log.push([label, Math.round(performance.now())]);
  const ms = Number(window.localStorage.getItem(LATENCY_KEY) || 0);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  n.inflight--;
}

type Row = Record<string, any>;
type Db = Record<string, Row[]>;

const TABLES = [
  'projects', 'project_members', 'project_invites', 'project_terms', 'project_term_lines', 'project_term_approvals',
  'project_periods', 'project_operations', 'project_quantities', 'project_contribution_ledger', 'project_transfers',
];

class DbError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

let seq = 0;
const id = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
// Время строго растёт: порядок условий и операций в тесте не зависит от совпадения миллисекунд.
let lastTs = 0;
const now = () => {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return new Date(lastTs).toISOString();
};

function load(): Db {
  const raw = window.localStorage.getItem(DB_KEY);
  const db = (raw ? JSON.parse(raw) : {}) as Db;
  for (const t of TABLES) db[t] ??= [];
  return db;
}

export function fakeActor(): { id: string; name: string } | null {
  const raw = window.localStorage.getItem(ACTOR_KEY);
  if (raw) return JSON.parse(raw);
  const s = getLocalSession();
  return s ? { id: s.id, name: s.full_name || 'Участник' } : null;
}

function data(db: Db, pid: string): ProjectData {
  const of = (t: string) => db[t].filter((r) => r.project_id === pid) as any[];
  return {
    project: db.projects.find((p) => p.id === pid) as any,
    members: of('project_members').sort((a, b) => a.position - b.position),
    terms: of('project_terms'),
    lines: of('project_term_lines'),
    approvals: of('project_term_approvals'),
    periods: of('project_periods').sort((a, b) => a.seq - b.seq),
    quantities: of('project_quantities'),
    ledger: of('project_contribution_ledger'),
    transfers: of('project_transfers'),
  };
}

function caller(db: Db, pid: string, uid: string): Row {
  const m = db.project_members.find((x) => x.project_id === pid && x.user_id === uid && x.status === 'active');
  if (!m) throw new DbError('Проект не найден или недоступен', '42501');
  return m;
}

const openPeriod = (db: Db, pid: string) => db.project_periods.find((p) => p.project_id === pid && p.status === 'open')!;
const bump = (db: Db, pid: string) => (openPeriod(db, pid).revision += 1);

function insertTerms(db: Db, pid: string, uid: string, terms: Row, effSeq: number | null, memberOf: (l: Row) => string): string {
  const lines = (terms.lines ?? []) as Row[];
  if (!lines.length) throw new DbError('Кто-то должен получать остаток', '22023');
  const tid = id();
  db.project_terms.push({
    id: tid, project_id: pid, status: 'proposed', proposed_by: uid, effective_from_seq: effSeq, preset: terms.preset ?? 'custom',
    contrib_enabled: !!terms.contrib_enabled, remainder_method: terms.remainder_method ?? 'equal', created_at: now(),
  });
  for (const l of lines) {
    const { position: _position, ...rest } = l;
    db.project_term_lines.push({ ...rest, member_id: memberOf(l), terms_id: tid, project_id: pid });
  }
  return tid;
}

function tryActivate(db: Db, tid: string): void {
  const terms = db.project_terms.find((x) => x.id === tid)!;
  const pid = terms.project_id;
  const users = db.project_members.filter((m) => m.project_id === pid && m.kind === 'user' && m.status === 'active');
  const ok = users.every((u) =>
    db.project_term_approvals.some((a) => a.terms_id === tid && a.user_id === u.user_id && a.decision === 'accept'),
  );
  if (!ok) return;
  const period = openPeriod(db, pid);
  if (terms.effective_from_seq === 1) {
    for (const x of db.project_terms) if (x.id === period.terms_id && x.id !== tid && x.status === 'active') x.status = 'superseded';
    terms.status = 'active';
    period.terms_id = tid;
  } else {
    for (const x of db.project_terms)
      if (x.project_id === pid && x.status === 'active' && x.effective_from_seq === period.seq + 1) x.status = 'superseded';
    terms.status = 'active';
    terms.effective_from_seq = period.seq + 1;
  }
}

function closePeriod(db: Db, pid: string, uid: string, revision: number): Row {
  caller(db, pid, uid);
  const project = db.projects.find((p) => p.id === pid)!;
  if (project.owner_id !== uid) throw new DbError('Зафиксировать итог может только владелец', '42501');
  const period = openPeriod(db, pid);
  const terms = db.project_terms.find((x) => x.id === period.terms_id)!;
  const waiting = db.project_members
    .filter((m) => m.project_id === pid && m.kind === 'user' && m.status === 'active')
    .filter((m) => !db.project_term_approvals.some((a) => a.terms_id === terms.id && a.user_id === m.user_id && a.decision === 'accept'))
    .map((m) => m.display_name);
  if (terms.status !== 'active' || (period.seq === 1 && waiting.length)) {
    throw new DbError(`Ждём согласия: ${waiting.join(', ') || '—'}`, 'P0409');
  }
  if (revision !== period.revision) throw new DbError('Данные изменились — посмотрите итог ещё раз', 'P0409');

  const d = data(db, pid);
  const input = buildPeriodInput(d, period.id, db.project_operations.filter((o) => o.period_id === period.id) as any);
  const res = calculatePeriod(input);
  const next = db.project_terms.find((x) => x.project_id === pid && x.status === 'active' && x.effective_from_seq === period.seq + 1);
  const debt = closePeriodDebt({
    members: input.members,
    debtAtStart: Object.fromEntries(input.members.map((m) => [m.id, input.debtAtStart?.[m.id] ?? 0])),
    repaid: Object.fromEntries(input.members.map((m) => [m.id, res.perPerson[m.id].contributionBack])),
    nextTerms: next ? toCalcTerms(next as any, d.lines) : undefined,
  });
  const ledger: Row[] = [];
  if (period.seq === 1 && terms.contrib_enabled) {
    for (const l of d.lines.filter((x) => x.terms_id === terms.id && x.contrib_new > 0)) {
      ledger.push({ member_id: l.member_id, kind: 'credit', amount: l.contrib_new, period: 'current' });
    }
  }
  for (const e of debt.entries) ledger.push({ member_id: e.memberId, kind: e.kind, amount: e.amount, period: e.period });

  const snap = {
    period_id: period.id, seq: period.seq, terms_id: terms.id,
    net_income: res.netIncome, profit: res.profit, contributions_repaid: res.contributionsRepaid,
    rates_accrued: res.ratesAccrued, rates_paid: res.ratesPaid, remainder: res.remainder,
    members: input.members.map((m) => {
      const p = res.perPerson[m.id];
      const q = input.quantities?.[m.id];
      return {
        member_id: m.id, name: m.name, position: m.position, expenses_back: p.expensesBack,
        contribution_back: p.contributionBack, rate_accrued: p.rateAccrued, rate: p.rate, remainder_share: p.remainderShare,
        owed: p.owed, on_hand: p.onHand, transfer: p.transfer, debt_before: input.debtAtStart?.[m.id] ?? 0,
        debt_after: res.debtAfter[m.id] ?? 0, hours: q?.hours ?? 0, pieces: q?.pieces ?? 0,
      };
    }),
    transfers: res.transfers.map((x) => ({ from_member: x.fromId, to_member: x.toId, amount: x.amount })),
    ledger,
  };
  Object.assign(period, { status: 'closed', closed_at: now(), snapshot: snap });
  const nextId = id();
  db.project_periods.push({
    id: nextId, project_id: pid, seq: period.seq + 1, status: 'open', terms_id: next?.id ?? terms.id,
    revision: period.revision + 1, opened_at: now(), closed_at: null, snapshot: null,
  });
  let n = db.project_contribution_ledger.length;
  for (const e of ledger) {
    db.project_contribution_ledger.push({
      id: ++n, project_id: pid, member_id: e.member_id, period_id: e.period === 'current' ? period.id : nextId, kind: e.kind, amount: e.amount,
    });
  }
  if (next) terms.status = 'superseded';
  return snap;
}

function call(db: Db, fn: string, a: Row, uid: string | null, name: string): unknown {
  if (fn === 'preview_project_invite') {
    const inv = db.project_invites.find((i) => i.code === a.p_code);
    if (!inv) throw new DbError('Приглашение не найдено', 'P0002');
    const p = db.projects.find((x) => x.id === inv.project_id)!;
    return {
      project_name: p.name,
      inviter_name: db.project_members.find((m) => m.project_id === p.id && m.user_id === inv.created_by)?.display_name ?? null,
      member_count: db.project_members.filter((m) => m.project_id === p.id && m.status === 'active').length,
      is_active: !inv.disabled_at,
    };
  }
  if (!uid) throw new DbError('Требуется авторизация', '28000');
  switch (fn) {
    case 'create_project': {
      if (!String(a.p_name ?? '').trim()) throw new DbError('Название проекта — от 1 до 80 символов', '22023');
      const pid = id();
      db.projects.push({ id: pid, name: a.p_name.trim(), currency: a.p_currency || 'RUB', owner_id: uid, created_at: now() });
      const names = [name, ...((a.p_guest_names ?? []) as string[])];
      const members = names.map((n, i) => ({
        id: id(), project_id: pid, kind: i ? 'guest' : 'user', user_id: i ? null : uid, display_name: n.trim(), position: i + 1, status: 'active',
      }));
      db.project_members.push(...members);
      const tid = insertTerms(db, pid, uid, a.p_terms, 1, (l) => {
        const m = members.find((x) => x.position === l.position);
        if (!m) throw new DbError('Условия — только для участников проекта, по одной строке на человека', '22023');
        return m.id;
      });
      db.project_periods.push({ id: id(), project_id: pid, seq: 1, status: 'open', terms_id: tid, revision: 1, opened_at: now(), closed_at: null, snapshot: null });
      db.project_term_approvals.push({ project_id: pid, terms_id: tid, user_id: uid, decision: 'accept' });
      tryActivate(db, tid);
      return pid;
    }
    case 'create_project_invite': {
      caller(db, a.p_project_id, uid);
      const code = `${id()}${id()}`.replace(/[^a-z0-9]/g, '').slice(0, 40).padEnd(16, '0');
      db.project_invites.push({ id: id(), project_id: a.p_project_id, code, created_by: uid, expires_at: null, disabled_at: null, created_at: now() });
      return code;
    }
    case 'disable_project_invite': {
      const inv = db.project_invites.find((i) => i.code === a.p_code);
      if (!inv) throw new DbError('Приглашение не найдено или недоступно', '42501');
      caller(db, inv.project_id, uid);
      inv.disabled_at = now();
      return null;
    }
    case 'join_project_by_invite': {
      const inv = db.project_invites.find((i) => i.code === a.p_code && !i.disabled_at);
      if (!inv) throw new DbError('Приглашение недействительно или отключено', '22023');
      const pid = inv.project_id;
      const mine = db.project_members.find((m) => m.project_id === pid && m.user_id === uid);
      if (mine) return mine.id;
      const position = Math.max(...db.project_members.filter((m) => m.project_id === pid).map((m) => m.position)) + 1;
      const m = { id: id(), project_id: pid, kind: 'user', user_id: uid, display_name: name, position, status: 'active' };
      db.project_members.push(m);
      return m.id;
    }
    case 'propose_terms': {
      caller(db, a.p_project_id, uid);
      const period = openPeriod(db, a.p_project_id);
      const tid = insertTerms(db, a.p_project_id, uid, a.p_terms, period.seq === 1 ? 1 : null, (l) => l.member_id);
      db.project_term_approvals.push({ project_id: a.p_project_id, terms_id: tid, user_id: uid, decision: 'accept' });
      tryActivate(db, tid);
      return tid;
    }
    case 'accept_terms':
    case 'decline_terms': {
      const terms = db.project_terms.find((x) => x.id === a.p_terms_id);
      if (!terms) throw new DbError('Проект не найден или недоступен', '42501');
      caller(db, terms.project_id, uid);
      const period = openPeriod(db, terms.project_id);
      const accept = fn === 'accept_terms';
      if (db.project_term_approvals.some((x) => x.terms_id === terms.id && x.user_id === uid)) {
        throw new DbError('Ты уже ответил на эти условия', 'P0409');
      }
      if (!(terms.status === 'proposed' || (accept && terms.status === 'active' && terms.id === period.terms_id && period.seq === 1))) {
        throw new DbError('Эти условия уже не ждут согласия', 'P0409');
      }
      db.project_term_approvals.push({ project_id: terms.project_id, terms_id: terms.id, user_id: uid, decision: accept ? 'accept' : 'decline' });
      if (!accept) {
        terms.status = 'rejected';
        return 'rejected';
      }
      if (terms.status === 'proposed') tryActivate(db, terms.id);
      return terms.status;
    }
    case 'add_operation': {
      caller(db, a.p_project_id, uid);
      if (!db.project_members.some((m) => m.id === a.p_member_id && m.project_id === a.p_project_id && m.status === 'active')) {
        throw new DbError('Участник не из этого проекта', '22023');
      }
      if (!(a.p_amount > 0)) throw new DbError('Сумма должна быть больше нуля', '22023');
      const amount = Math.round(a.p_amount * (a.p_exchange_rate ?? 1));
      if (a.p_refund_of) {
        const inc = db.project_operations.find((o) => o.id === a.p_refund_of && o.op_type === 'income');
        if (!inc) throw new DbError('Доход для возврата не найден в этом проекте', '22023');
        const done = db.project_operations.filter((o) => o.refund_of === inc.id).reduce((s, o) => s + o.amount_in_project_currency, 0);
        if (done + amount > inc.amount_in_project_currency) throw new DbError('Возвраты по доходу больше дохода', '22023');
      }
      const period = openPeriod(db, a.p_project_id);
      const opId = id();
      db.project_operations.push({
        id: opId, project_id: a.p_project_id, period_id: period.id, op_type: a.p_op_type, amount: a.p_amount,
        currency: a.p_currency ?? 'RUB', exchange_rate: a.p_exchange_rate ?? 1, amount_in_project_currency: amount,
        member_id: a.p_member_id, refund_of: a.p_refund_of, occurred_on: a.p_occurred_on ?? now().slice(0, 10),
        title: (a.p_title ?? '').trim(), note: a.p_note, created_by: uid, created_at: now(),
      });
      bump(db, a.p_project_id);
      return opId;
    }
    case 'edit_operation':
    case 'delete_operation': {
      // Порядок проверок — как private.project_lock_operation / edit_operation / delete_operation.
      const op = db.project_operations.find((o) => o.id === a.p_operation_id);
      if (!op) throw new DbError('Операция не найдена или недоступна', 'P0002');
      caller(db, op.project_id, uid);
      if (op.created_by !== uid && db.projects.find((p) => p.id === op.project_id)?.owner_id !== uid) {
        throw new DbError('Править и удалять операцию может автор или владелец', '42501');
      }
      const refunds = db.project_operations.filter((o) => o.refund_of === op.id);
      const closed = db.project_periods.find((p) => p.id === op.period_id)?.status !== 'open';
      if (fn === 'delete_operation') {
        if (refunds.length) throw new DbError('Сначала удалите возвраты по этому доходу', 'P0409');
        if (closed) throw new DbError('Период закрыт: операцию нельзя удалить', 'P0423');
        db.project_operations.splice(db.project_operations.indexOf(op), 1);
        bump(db, op.project_id);
        return null;
      }
      if (a.p_member_id != null && !db.project_members.some((m) => m.id === a.p_member_id && m.project_id === op.project_id && m.status === 'active')) {
        throw new DbError('Участник не из этого проекта', '22023');
      }
      const amount = a.p_amount ?? op.amount;
      if (!(amount > 0)) throw new DbError('Сумма должна быть больше нуля', '22023');
      const pc = Math.round(amount * op.exchange_rate);
      const others = (incomeId: string) =>
        db.project_operations.filter((o) => o.refund_of === incomeId && o.id !== op.id).reduce((s, o) => s + o.amount_in_project_currency, 0);
      if (op.op_type === 'income_refund') {
        const inc = db.project_operations.find((o) => o.id === op.refund_of)!;
        if (others(inc.id) + pc > inc.amount_in_project_currency) throw new DbError('Возвраты по доходу больше дохода', '22023');
      } else if (op.op_type === 'income' && pc < refunds.reduce((s, o) => s + o.amount_in_project_currency, 0)) {
        throw new DbError('Возвраты по доходу больше дохода', '22023');
      }
      if (closed) throw new DbError('Период закрыт: операцию нельзя изменить', 'P0423');
      Object.assign(op, {
        amount, amount_in_project_currency: pc, member_id: a.p_member_id ?? op.member_id,
        title: a.p_title == null ? op.title : String(a.p_title).trim(),
      });
      bump(db, op.project_id);
      return op.id;
    }
    case 'set_quantity': {
      caller(db, a.p_project_id, uid);
      const project = db.projects.find((p) => p.id === a.p_project_id)!;
      const m = db.project_members.find((x) => x.id === a.p_member_id);
      if (!m || !(m.user_id === uid || (m.kind === 'guest' && project.owner_id === uid))) {
        throw new DbError('Часы и штуки вносят только за себя; за гостя — владелец', '42501');
      }
      const period = openPeriod(db, a.p_project_id);
      const terms = db.project_terms.find((x) => x.id === period.terms_id)!;
      const l = db.project_term_lines.find((x) => x.terms_id === terms.id && x.member_id === m.id);
      if (!l) throw new DbError('Участника нет в условиях этого периода', '22023');
      if (a.p_hours != null && !(l.rate_type === 'hourly' || terms.remainder_method === 'hours')) {
        throw new DbError('Часы не нужны: нет ставки «за час» и остаток не «по часам»', '22023');
      }
      if (a.p_pieces != null && l.rate_type !== 'piece') throw new DbError('Штуки не нужны: нет ставки «за штуку»', '22023');
      const q = db.project_quantities.find((x) => x.period_id === period.id && x.member_id === m.id);
      if (q) Object.assign(q, { hours: a.p_hours ?? q.hours, pieces: a.p_pieces ?? q.pieces });
      else db.project_quantities.push({ project_id: a.p_project_id, period_id: period.id, member_id: m.id, hours: a.p_hours ?? 0, pieces: a.p_pieces ?? 0 });
      bump(db, a.p_project_id);
      return null;
    }
    case 'close_period':
      return closePeriod(db, a.p_project_id, uid, a.p_revision);
    case 'mark_transfer_paid': {
      const period = db.project_periods.find((p) => p.id === a.p_period_id);
      if (!period) throw new DbError('Проект не найден или недоступен', '42501');
      const me = caller(db, period.project_id, uid);
      const from = db.project_members.find((m) => m.id === a.p_from_member);
      if (!from || !(from.id === me.id || from.kind === 'guest')) {
        throw new DbError('Отметить перевод может отправитель; за гостя — любой участник', '42501');
      }
      if (period.status !== 'closed') throw new DbError('Период не закрыт: переводов по итогу ещё нет', 'P0423');
      const tr = (period.snapshot?.transfers ?? []).find((x: Row) => x.from_member === a.p_from_member && x.to_member === a.p_to_member);
      if (!tr) throw new DbError('Такого перевода нет в итоге периода', '22023');
      const done = db.project_transfers.find((x) => x.period_id === period.id && x.from_member === tr.from_member && x.to_member === tr.to_member);
      if (done) return done.id;
      const row = { id: id(), project_id: period.project_id, period_id: period.id, from_member: tr.from_member, to_member: tr.to_member, amount: tr.amount, marked_by: uid, marked_at: now() };
      db.project_transfers.push(row);
      return row.id;
    }
    default:
      throw new DbError(`Функция ${fn} не поддержана e2e-фейком`, 'P0001');
  }
}

/** Один сбой чтения таблицы ({"fn":"table:projects","mode":"denied"|"lost"}): 403/42501 или обрыв связи. */
function takeTableFail(table: string) {
  const raw = window.localStorage.getItem(FAIL_KEY);
  const fail = raw ? (JSON.parse(raw) as { fn: string; mode: string }) : null;
  if (fail?.fn !== `table:${table}`) return null;
  window.localStorage.removeItem(FAIL_KEY);
  if (fail.mode === 'denied') return { data: null, error: { message: 'permission denied for table ' + table, code: '42501' }, status: 403 };
  return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 };
}

/** Клиент с формой SupabaseClient в объёме, который использует projects-store. */
export function createFakeProjectsClient() {
  return {
    async rpc(fn: string, args: Row) {
      await fakeLatency(`rpc:${fn}`);
      const failRaw = window.localStorage.getItem(FAIL_KEY);
      const fail = failRaw ? (JSON.parse(failRaw) as { fn: string; mode: 'error' | 'lost' }) : null;
      const failing = fail?.fn === fn;
      if (failing) window.localStorage.removeItem(FAIL_KEY);
      if (failing && fail.mode === 'error') return { data: null, error: { message: 'База отклонила запрос', code: 'P0001' } };
      const db = load();
      const actor = fakeActor();
      try {
        const data = call(db, fn, args, actor?.id ?? null, actor?.name ?? 'Участник');
        window.localStorage.setItem(DB_KEY, JSON.stringify(db));
        // 'lost': база выполнила, ответ не дошёл.
        if (failing) return { data: null, error: { message: 'Failed to fetch' } };
        return { data, error: null };
      } catch (e) {
        if (e instanceof DbError) return { data: null, error: { message: e.message, code: e.code } };
        throw e;
      }
    },
    from(table: string) {
      const q: { filters: [string, unknown][]; range: [number, number] | null; single: boolean } = { filters: [], range: null, single: false };
      const exec = () => {
        const db = load();
        const uid = fakeActor()?.id;
        // RLS: только проекты, где вызывающий — участник.
        const mine = new Set(db.project_members.filter((m) => m.user_id === uid).map((m) => m.project_id));
        let rows = (db[table] ?? []).filter((r) => mine.has(table === 'projects' ? r.id : r.project_id));
        rows = rows.filter((r) => q.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)));
        if (table === 'projects') rows = [...rows].reverse();
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        return { data: q.single ? rows[0] ?? null : rows, error: null };
      };
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (q.filters.push([c, v]), b),
        in: (c: string, vs: unknown[]) => (q.filters.push([c, vs]), b),
        order: () => b,
        range: (from: number, to: number) => ((q.range = [from, to]), b),
        maybeSingle: () => ((q.single = true), b),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => fakeLatency(table).then(() => takeTableFail(table) ?? exec()).then(res, rej),
      };
      return b;
    },
  };
}
