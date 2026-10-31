/**
 * Слой данных «Проекта» (миграция 20261101000000_projects.sql) поверх Supabase.
 *
 * Соглашения — как в remote-store.ts:
 * 1. Ни одна функция не бросает: сбой возвращается полем `error` строкой для
 *    пользователя. Сообщения функций базы уже написаны для людей — передаются
 *    как есть.
 * 2. Права не проверяются здесь, их проверяет база (RLS + RPC). Клиент не
 *    пишет в таблицы проекта напрямую: только функции.
 * 3. Суммы — целые копейки, количества — сотые (как в project-calc.ts).
 *
 * Модуль не привязан к глобальному клиенту: createProjectsStore(client) —
 * так unit-тест подставляет фейковый клиент без сети.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { t } from './i18n/t';
import { fetchAllPages } from './paging';
import type { RemoteResult } from './remote-store';
import type { Operation, PeriodInput, ProjectMember, Quantity, RateType, RemainderMethod, TermLine, Terms } from './project-calc';

// ---------------------------------------------------------------- строки базы

export type DbRateType = 'none' | 'fixed' | 'hourly' | 'piece';
export type DbRemainderMethod = 'equal' | 'percent' | 'contrib' | 'hours';
export type TermsPreset = 'equal' | 'a' | 'b' | 'v' | 'custom';

export interface ProjectRow {
  id: string;
  name: string;
  currency: string;
  owner_id: string;
  created_at: string;
}

export interface MemberRow {
  id: string;
  project_id: string;
  kind: 'user' | 'guest';
  user_id: string | null;
  display_name: string;
  position: number;
  status: 'active' | 'left';
}

export interface TermsRow {
  id: string;
  project_id: string;
  status: 'proposed' | 'active' | 'rejected' | 'superseded';
  proposed_by: string;
  effective_from_seq: number | null;
  preset: TermsPreset;
  contrib_enabled: boolean;
  remainder_method: DbRemainderMethod;
  created_at: string;
}

export interface TermLineRow {
  terms_id: string;
  member_id: string;
  expenses_back: boolean;
  rate_type: DbRateType;
  rate_amount: number;
  in_remainder: boolean;
  share_bp: number;
  contrib_new: number;
  contrib_kind: 'money' | 'item';
  contrib_note: string | null;
  debt_write_off: number;
  leaves: boolean;
}

export interface ApprovalRow {
  terms_id: string;
  user_id: string;
  decision: 'accept' | 'decline';
}

export interface PeriodRow {
  id: string;
  project_id: string;
  seq: number;
  status: 'open' | 'closed';
  terms_id: string;
  revision: number;
  opened_at: string;
  closed_at: string | null;
  snapshot: unknown;
}

export interface OperationRow {
  id: string;
  period_id: string;
  op_type: 'income' | 'expense' | 'income_refund';
  amount: number;
  currency: string;
  exchange_rate: number | string;
  amount_in_project_currency: number;
  member_id: string;
  refund_of: string | null;
  occurred_on: string;
  title: string;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface QuantityRow {
  period_id: string;
  member_id: string;
  hours: number;
  pieces: number;
}

export interface LedgerRow {
  id: number;
  member_id: string;
  period_id: string;
  kind: 'credit' | 'repay' | 'write_off';
  amount: number;
}

export interface TransferMarkRow {
  id: string;
  period_id: string;
  from_member: string;
  to_member: string;
  amount: number;
  marked_by: string;
  marked_at: string;
}

/** Всё о проекте, кроме операций (их много — грузятся по периоду). */
export interface ProjectData {
  project: ProjectRow;
  members: MemberRow[];
  terms: TermsRow[];
  lines: TermLineRow[];
  approvals: ApprovalRow[];
  periods: PeriodRow[];
  quantities: QuantityRow[];
  ledger: LedgerRow[];
  transfers: TransferMarkRow[];
}

/** Снимок итога, записанный close_period (§5). */
export interface SnapshotMember {
  memberId: string;
  name: string;
  position: number;
  expensesBack: number;
  contributionBack: number;
  rateAccrued: number;
  rate: number;
  remainderShare: number;
  owed: number;
  onHand: number;
  transfer: number;
  debtBefore: number;
  debtAfter: number;
  hours: number;
  pieces: number;
}

export interface PeriodSnapshot {
  periodId: string;
  seq: number;
  termsId: string;
  netIncome: number;
  profit: number;
  contributionsRepaid: number;
  ratesAccrued: number;
  ratesPaid: number;
  remainder: number;
  members: SnapshotMember[];
  transfers: Array<{ fromId: string; toId: string; amount: number }>;
  ledger: Array<{ memberId: string; kind: LedgerRow['kind']; amount: number; period: 'current' | 'next' }>;
}

export interface InvitePreview {
  projectName: string;
  inviterName: string | null;
  memberCount: number;
  isActive: boolean;
}

// ---------------------------------------------------------------- преобразования

const RATE_FROM_DB: Record<DbRateType, RateType> = { none: 'none', fixed: 'period', hourly: 'hourly', piece: 'piece' };
const RATE_TO_DB: Record<RateType, DbRateType> = { none: 'none', period: 'fixed', hourly: 'hourly', piece: 'piece' };
const METHOD_FROM_DB: Record<DbRemainderMethod, RemainderMethod> = {
  equal: 'equal',
  percent: 'percent',
  contrib: 'contributions',
  hours: 'hours',
};
const METHOD_TO_DB: Record<RemainderMethod, DbRemainderMethod> = {
  equal: 'equal',
  percent: 'percent',
  contributions: 'contrib',
  hours: 'hours',
};

/** bigint из PostgREST приходит числом; сумма обязана быть целыми копейками. */
function cents(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Ожидались целые копейки, получено ${String(v)}`);
  return n;
}

export function toCalcLine(row: TermLineRow): TermLine {
  return {
    memberId: row.member_id,
    expensesBack: row.expenses_back,
    rate: { type: RATE_FROM_DB[row.rate_type], amount: cents(row.rate_amount) },
    inRemainder: row.in_remainder,
    shareBp: row.share_bp,
    contribNew: cents(row.contrib_new),
    contribKind: row.contrib_kind,
    contribNote: row.contrib_note ?? undefined,
    debtWriteOff: cents(row.debt_write_off),
  };
}

export function toCalcTerms(terms: TermsRow, lines: TermLineRow[]): Terms {
  return {
    contribEnabled: terms.contrib_enabled,
    remainderMethod: METHOD_FROM_DB[terms.remainder_method],
    lines: lines.filter((l) => l.terms_id === terms.id).map(toCalcLine),
  };
}

export function toCalcMember(row: MemberRow): ProjectMember {
  return { id: row.id, name: row.display_name, position: row.position, role: row.kind, status: row.status };
}

export function toCalcOperation(row: OperationRow): Operation {
  return { type: row.op_type, memberId: row.member_id, amount: cents(row.amount_in_project_currency) };
}

/** Условия ядра → тело propose_terms. leaving — кто выходит этой версией (§4). */
export function toRpcTerms(terms: Terms, opts: { preset?: TermsPreset; leaving?: string[] } = {}) {
  const leaving = new Set(opts.leaving ?? []);
  return {
    preset: opts.preset ?? 'custom',
    contrib_enabled: terms.contribEnabled,
    remainder_method: METHOD_TO_DB[terms.remainderMethod],
    lines: terms.lines.map((l) => ({
      member_id: l.memberId,
      expenses_back: l.expensesBack,
      rate_type: RATE_TO_DB[l.rate.type],
      rate_amount: l.rate.amount,
      in_remainder: l.inRemainder,
      share_bp: l.shareBp,
      contrib_new: l.contribNew,
      contrib_kind: l.contribKind ?? 'money',
      contrib_note: l.contribNote ?? null,
      debt_write_off: l.debtWriteOff,
      leaves: leaving.has(l.memberId),
    })),
  };
}

/** Баланс журнала долга (credit − repay − write_off) по участникам. */
export function ledgerBalance(ledger: LedgerRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of ledger) {
    const a = cents(r.amount);
    out[r.member_id] = (out[r.member_id] ?? 0) + (r.kind === 'credit' ? a : -a);
  }
  return out;
}

/**
 * Вес «по вкладам» к периоду: Σ contrib_new версий, действовавших в периодах
 * 1..seq (так же считает база в private.project_calc). Возврат и списание вес
 * не уменьшают. Без этого ядро взяло бы вклады только текущей версии (3а, п. 5).
 */
export function contributionsTotal(data: ProjectData, seq: number): Record<string, number> {
  const used = new Set(data.periods.filter((p) => p.seq <= seq).map((p) => p.terms_id));
  const out: Record<string, number> = {};
  for (const l of data.lines) {
    if (used.has(l.terms_id)) out[l.member_id] = (out[l.member_id] ?? 0) + cents(l.contrib_new);
  }
  return out;
}

/**
 * Вход calculatePeriod для открытого периода — предпросмотр «Подвести итог»
 * считает то же, что close_period в базе. Участники — активные и все, у кого
 * есть операции. Период 1: вклады первоначальной версии в журнал пишет итог,
 * но в долг на начало они уже входят.
 */
export function buildPeriodInput(data: ProjectData, periodId: string, operations: OperationRow[]): PeriodInput {
  const period = data.periods.find((p) => p.id === periodId);
  if (!period) throw new Error(`Период ${periodId} не найден`);
  const termsRow = data.terms.find((x) => x.id === period.terms_id);
  if (!termsRow) throw new Error(`Условия ${period.terms_id} не найдены`);
  const terms = toCalcTerms(termsRow, data.lines);
  const ops = operations.filter((o) => o.period_id === periodId);
  const withOps = new Set(ops.map((o) => o.member_id));
  const members = data.members.filter((m) => m.status === 'active' || withOps.has(m.id)).map(toCalcMember);

  const debtAtStart = ledgerBalance(data.ledger);
  if (period.seq === 1 && terms.contribEnabled) {
    for (const l of terms.lines) {
      if (l.contribNew > 0) debtAtStart[l.memberId] = (debtAtStart[l.memberId] ?? 0) + l.contribNew;
    }
  }
  const quantities: Record<string, Quantity> = {};
  for (const q of data.quantities) {
    if (q.period_id === periodId) quantities[q.member_id] = { hours: q.hours, pieces: q.pieces };
  }
  return {
    members,
    terms,
    operations: ops.map(toCalcOperation),
    quantities,
    debtAtStart,
    contributionsTotal: contributionsTotal(data, period.seq),
  };
}

export function mapSnapshot(raw: unknown): PeriodSnapshot {
  const s = raw as Record<string, any>;
  return {
    periodId: s.period_id,
    seq: s.seq,
    termsId: s.terms_id,
    netIncome: cents(s.net_income),
    profit: cents(s.profit),
    contributionsRepaid: cents(s.contributions_repaid),
    ratesAccrued: cents(s.rates_accrued),
    ratesPaid: cents(s.rates_paid),
    remainder: cents(s.remainder),
    members: (s.members ?? []).map((m: Record<string, any>) => ({
      memberId: m.member_id,
      name: m.name,
      position: m.position,
      expensesBack: cents(m.expenses_back),
      contributionBack: cents(m.contribution_back),
      rateAccrued: cents(m.rate_accrued),
      rate: cents(m.rate),
      remainderShare: cents(m.remainder_share),
      owed: cents(m.owed),
      onHand: cents(m.on_hand),
      transfer: cents(m.transfer),
      debtBefore: cents(m.debt_before),
      debtAfter: cents(m.debt_after),
      hours: m.hours,
      pieces: m.pieces,
    })),
    transfers: (s.transfers ?? []).map((x: Record<string, any>) => ({
      fromId: x.from_member,
      toId: x.to_member,
      amount: cents(x.amount),
    })),
    ledger: (s.ledger ?? []).map((x: Record<string, any>) => ({
      memberId: x.member_id,
      kind: x.kind,
      amount: cents(x.amount),
      period: x.period,
    })),
  };
}

// ---------------------------------------------------------------- ошибки

interface DbError {
  message: string;
  code?: string;
}

/** Коды, у которых сообщение базы написано для человека (миграция 20261101000000). */
const HUMAN_CODES = new Set(['42501', '22023', 'P0002', 'P0409', 'P0423', '28000']);

function translate(error: DbError, fallback?: string): string {
  const m = error.message.toLowerCase();
  if (m.includes('fetch') || m.includes('network')) return t('errors.noServerConnection');
  if (error.code === '23505') return t('errors.duplicateRecord');
  if (error.code && HUMAN_CODES.has(error.code)) return error.message;
  return fallback ?? error.message;
}

// ---------------------------------------------------------------- вызовы

export interface OperationInput {
  type: OperationRow['op_type'];
  amount: number;
  memberId: string;
  refundOf?: string;
  currency?: string;
  exchangeRate?: number;
  occurredOn?: string;
  title?: string;
  note?: string;
}

/** Таблица → порядок строк: страницы по offset должны быть устойчивы. */
const PROJECT_TABLES: [string, string[]][] = [
  ['project_members', ['position']],
  ['project_terms', ['created_at', 'id']],
  ['project_term_lines', ['terms_id', 'member_id']],
  ['project_term_approvals', ['terms_id', 'user_id']],
  ['project_periods', ['seq']],
  ['project_quantities', ['period_id', 'member_id']],
  ['project_contribution_ledger', ['id']],
  ['project_transfers', ['id']],
];

// Не больше max-rows PostgREST (в Supabase по умолчанию 1000): иначе короткая страница сочтётся последней.
const PAGE_SIZE = 500;
const MAX_ROWS = 20_000;

/** Все строки таблицы проекта, страницами; лимит — явная ошибка: частичные деньги хуже ошибки. */
async function fetchProjectTable(client: SupabaseClient, table: string, order: string[], projectId: string): Promise<RemoteResult<unknown[]>> {
  const rows: unknown[] = [];
  for (;;) {
    let q = client.from(table).select('*').eq('project_id', projectId);
    for (const col of order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) return { data: null, error: translate(error) };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return { data: rows, error: null };
    if (rows.length >= MAX_ROWS) return { data: null, error: 'Слишком много записей в проекте — не удалось загрузить все' };
  }
}

export function createProjectsStore(client: SupabaseClient | null) {
  async function rpc<T>(fn: string, args: Record<string, unknown>, fallback?: string): Promise<RemoteResult<T>> {
    if (!client) return { data: null, error: t('errors.noBackend') };
    const { data, error } = await client.rpc(fn, args);
    if (error) return { data: null, error: translate(error, fallback) };
    return { data: data as T, error: null };
  }

  return {
    async fetchProjects(): Promise<RemoteResult<ProjectRow[]>> {
      if (!client) return { data: null, error: t('errors.noBackend') };
      const { data, error } = await client.from('projects').select('*').order('created_at', { ascending: false });
      return error ? { data: null, error: translate(error) } : { data: (data ?? []) as ProjectRow[], error: null };
    },

    /** Проект целиком, кроме операций; каждая таблица — всеми страницами. */
    async fetchProject(projectId: string): Promise<RemoteResult<ProjectData>> {
      if (!client) return { data: null, error: t('errors.noBackend') };
      const [p, ...rest] = await Promise.all([
        client.from('projects').select('*').eq('id', projectId).maybeSingle(),
        ...PROJECT_TABLES.map(([table, order]) => fetchProjectTable(client, table, order, projectId)),
      ]);
      if (p.error) return { data: null, error: translate(p.error) };
      const failed = rest.find((r) => r.error);
      if (failed) return { data: null, error: failed.error };
      // RLS отдаёт пустоту и «нет проекта», и «не участник» — неразличимо.
      if (!p.data) return { data: null, error: t('errors.insufficientPermissions') };
      const [members, terms, lines, approvals, periods, quantities, ledger, transfers] = rest.map((r) => r.data ?? []);
      return {
        data: {
          project: p.data as ProjectRow,
          members: (members as MemberRow[]).sort((a, b) => a.position - b.position),
          terms: terms as TermsRow[],
          lines: lines as TermLineRow[],
          approvals: approvals as ApprovalRow[],
          periods: (periods as PeriodRow[]).sort((a, b) => a.seq - b.seq),
          quantities: quantities as QuantityRow[],
          ledger: (ledger as LedgerRow[]).sort((a, b) => a.id - b.id),
          transfers: transfers as TransferMarkRow[],
        },
        error: null,
      };
    },

    /** Все операции периода, страницами: частичный список для денег хуже ошибки. */
    async fetchPeriodOperations(projectId: string, periodId: string): Promise<RemoteResult<OperationRow[]>> {
      if (!client) return { data: null, error: t('errors.noBackend') };
      const res = await fetchAllPages<OperationRow>(
        async (offset, limit) => {
          const { data, error } = await client
            .from('project_operations')
            .select('*')
            .eq('project_id', projectId)
            .eq('period_id', periodId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + limit - 1);
          if (error) return { data: null, error: translate(error) };
          const items = (data ?? []) as OperationRow[];
          return { data: { items, hasMore: items.length === limit }, error: null };
        },
        { pageSize: PAGE_SIZE },
      );
      if (res.overflow) return { data: null, error: 'Слишком много операций в периоде — не удалось загрузить все' };
      return { data: res.data, error: res.error };
    },

    /**
     * terms — тело как у toRpcTerms, но строки ссылаются на участников по
     * position (1 — создатель, 2… — гости по порядку): id ещё не существуют.
     */
    createProject: (input: { name: string; currency?: string; guests?: string[]; terms: Record<string, unknown> }) =>
      rpc<string>('create_project', {
        p_name: input.name,
        p_currency: input.currency ?? 'RUB',
        p_guest_names: input.guests ?? [],
        p_terms: input.terms,
      }),

    async previewInvite(code: string): Promise<RemoteResult<InvitePreview>> {
      const res = await rpc<Record<string, unknown>>('preview_project_invite', { p_code: code });
      if (!res.data) return { data: null, error: res.error };
      return {
        data: {
          projectName: String(res.data.project_name),
          inviterName: (res.data.inviter_name as string | null) ?? null,
          memberCount: Number(res.data.member_count),
          isActive: res.data.is_active === true,
        },
        error: null,
      };
    },

    joinByInvite: (code: string) => rpc<string>('join_project_by_invite', { p_code: code }),
    createInvite: (projectId: string) => rpc<string>('create_project_invite', { p_project_id: projectId }),
    disableInvite: (code: string) => rpc<null>('disable_project_invite', { p_code: code }),

    proposeTerms: (projectId: string, terms: Terms, opts: { preset?: TermsPreset; leaving?: string[] } = {}) =>
      rpc<string>('propose_terms', { p_project_id: projectId, p_terms: toRpcTerms(terms, opts) }),
    acceptTerms: (termsId: string) => rpc<TermsRow['status']>('accept_terms', { p_terms_id: termsId }),
    declineTerms: (termsId: string) => rpc<TermsRow['status']>('decline_terms', { p_terms_id: termsId }),

    addOperation: (projectId: string, op: OperationInput) =>
      rpc<string>('add_operation', {
        p_project_id: projectId,
        p_op_type: op.type,
        p_amount: op.amount,
        p_member_id: op.memberId,
        p_refund_of: op.refundOf ?? null,
        p_currency: op.currency ?? null,
        p_exchange_rate: op.exchangeRate ?? 1,
        p_occurred_on: op.occurredOn ?? null,
        p_title: op.title ?? null,
        p_note: op.note ?? null,
      }),
    editOperation: (operationId: string, patch: Partial<Omit<OperationInput, 'type' | 'refundOf'>>) =>
      rpc<string>('edit_operation', {
        p_operation_id: operationId,
        p_amount: patch.amount ?? null,
        p_member_id: patch.memberId ?? null,
        p_currency: patch.currency ?? null,
        p_exchange_rate: patch.exchangeRate ?? null,
        p_occurred_on: patch.occurredOn ?? null,
        p_title: patch.title ?? null,
        p_note: patch.note ?? null,
      }),
    deleteOperation: (operationId: string) => rpc<null>('delete_operation', { p_operation_id: operationId }),

    /** Количество в сотых; null — поле не трогать (у участника его может не быть). */
    setQuantity: (projectId: string, memberId: string, q: { hours?: number | null; pieces?: number | null }) =>
      rpc<null>('set_quantity', {
        p_project_id: projectId,
        p_member_id: memberId,
        p_hours: q.hours ?? null,
        p_pieces: q.pieces ?? null,
      }),

    /** revision — значение периода в момент предпросмотра («пока ты смотрел», §5). */
    async closePeriod(projectId: string, revision: number): Promise<RemoteResult<PeriodSnapshot>> {
      const res = await rpc<unknown>(
        'close_period',
        { p_project_id: projectId, p_revision: revision },
        'Не удалось зафиксировать — ничего не изменилось',
      );
      if (res.error) return { data: null, error: res.error };
      try {
        return { data: mapSnapshot(res.data), error: null };
      } catch (e) {
        // Итог в базе уже зафиксирован — не прочитан только ответ.
        return { data: null, error: `Итог зафиксирован, но ответ не прочитан: ${(e as Error).message}` };
      }
    },

    markTransferPaid: (periodId: string, fromMember: string, toMember: string) =>
      rpc<string>('mark_transfer_paid', { p_period_id: periodId, p_from_member: fromMember, p_to_member: toMember }),
  };
}

export type ProjectsStore = ReturnType<typeof createProjectsStore>;

export const projectsStore: ProjectsStore = createProjectsStore(supabase);
