/**
 * Слой данных поверх Supabase.
 *
 * До этого всё хранилось только в localStorage: события существовали на том
 * устройстве, где были созданы, а ссылка-приглашение передавала лишь id и не
 * могла подтянуть группу. Многопользовательский режим требует общего
 * хранилища — здесь оно и появляется.
 *
 * Соглашения этого модуля:
 *
 * 1. Ни одна функция не бросает. Любой сбой возвращается полем `error` со
 *    строкой для пользователя. Пустой `catch` в этом проекте уже один раз
 *    спрятал полное отсутствие бэкенда.
 * 2. Форма данных наружу — та же, что у локального хранилища (`Group` с
 *    вложенными `members`, `expenses`, `settlements`), чтобы экраны не
 *    переписывались под две разные модели.
 * 3. Права не проверяются здесь. Их проверяет RLS: клиент может отправить
 *    что угодно, база отклонит чужое. Клиентская проверка — удобство, а не
 *    защита.
 */

import { supabase } from './supabase';
import { t } from './i18n/t';

export interface RemoteResult<T> {
  data: T | null;
  error: string | null;
}

export interface GroupMember {
  id: string;
  name: string;
  avatar: string;
  role: string;
  email?: string;
  phone?: string;
}

export interface GroupExpense {
  id: string;
  title: string;
  amount: number;
  currency: string;
  amountInGroupCurrency: number;
  category: string;
  paidById: string;
  splits: Array<{ userId: string; amountOwed: number }>;
  createdAt: string;
}

export interface GroupSettlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

export interface Group {
  id: string;
  name: string;
  category: string;
  currency: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  members: GroupMember[];
  expenses: GroupExpense[];
  settlements: GroupSettlement[];
}

function noBackend(): string {
  return t('errors.noBackend');
}

function fail<T>(message: string): RemoteResult<T> {
  return { data: null, error: message };
}

/** Переводит ошибку PostgREST в текст, понятный пользователю. */
function translate(error: { message: string; code?: string }): string {
  const m = error.message.toLowerCase();

  // Отказ RLS выглядит как нарушение политики, а не как «нет прав».
  if (error.code === '42501' || m.includes('row-level security')) {
    return t('errors.insufficientPermissions');
  }
  if (error.code === '23514' || m.includes('check constraint')) {
    return t('errors.checkConstraintAmount');
  }
  if (error.code === '23505') return t('errors.duplicateRecord');
  if (m.includes('fetch') || m.includes('network')) return t('errors.noServerConnection');
  return error.message;
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

/**
 * Одна вложенная выборка вместо пяти запросов: PostgREST собирает связи по
 * внешним ключам, а RLS отсекает чужое на каждом уровне.
 */
const GROUP_SELECT = `
  id, name, category, default_currency, status, created_by, created_at, updated_at,
  group_members ( user_id, role, profiles ( id, full_name, avatar_url, email, phone ) ),
  group_participants ( id, display_name, kind, profile_id, created_by ),
  expenses (
    id, title, amount, currency, amount_in_group_currency, category,
    paid_by_id, created_at,
    expense_splits ( user_id, amount_owed )
  ),
  settlements ( id, payer_id, payee_id, amount, currency, payment_method, status, created_at )
`;

function mapGroup(row: any): Group {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? 'trip',
    currency: row.default_currency ?? 'RUB',
    status: row.status ?? 'active',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    members: [
      ...(row.group_members ?? []).map((m: any) => ({
        id: m.user_id,
        name: m.profiles?.full_name ?? t('export.defaultMember'),
        avatar: m.profiles?.avatar_url ?? '👤',
        role: m.role ?? 'member',
        email: m.profiles?.email ?? undefined,
        phone: m.profiles?.phone ?? undefined,
      })),
      ...(row.group_participants ?? []).filter((p: any) => p.kind === 'guest').map((p: any) => ({
        id: p.id,
        name: p.display_name,
        avatar: '👤',
        role: 'member',
        email: undefined,
        phone: undefined,
      }))
    ],
    expenses: (row.expenses ?? [])
      .map((e: any) => ({
        id: e.id,
        title: e.title,
        amount: Number(e.amount),
        currency: e.currency,
        amountInGroupCurrency: Number(e.amount_in_group_currency),
        category: e.category ?? 'other',
        paidById: e.paid_by_id,
        splits: (e.expense_splits ?? []).map((s: any) => ({
          userId: s.user_id,
          amountOwed: Number(s.amount_owed),
        })),
        createdAt: e.created_at,
      }))
      .sort((a: GroupExpense, b: GroupExpense) => b.createdAt.localeCompare(a.createdAt)),
    settlements: (row.settlements ?? []).map((s: any) => ({
      id: s.id,
      fromUserId: s.payer_id,
      toUserId: s.payee_id,
      amount: Number(s.amount),
      currency: s.currency ?? 'RUB',
      paymentMethod: s.payment_method ?? 'sbp',
      status: s.status ?? 'completed',
      createdAt: s.created_at,
    })),
  };
}

export async function fetchGroups(): Promise<RemoteResult<Group[]>> {
  if (!supabase) return fail(noBackend());

  const { data, error } = await supabase
    .from('groups')
    .select(GROUP_SELECT)
    .order('created_at', { ascending: false });

  if (error) return fail(translate(error));
  return { data: (data ?? []).map(mapGroup), error: null };
}

export async function fetchGroup(groupId: string): Promise<RemoteResult<Group>> {
  if (!supabase) return fail(noBackend());

  const { data, error } = await supabase.from('groups').select(GROUP_SELECT).eq('id', groupId).maybeSingle();

  if (error) return fail(translate(error));
  // Отсутствие строки здесь означает «нет доступа или не существует» — RLS не
  // различает эти случаи намеренно, чтобы по ответу нельзя было перебирать id.
  if (!data) return fail(t('errors.eventUnavailableNoAccess'));
  return { data: mapGroup(data), error: null };
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

export async function createGroup(input: {
  name: string;
  category: string;
  currency: string;
}): Promise<RemoteResult<Group>> {
  if (!supabase) return fail(noBackend());

  const { data: createdId, error } = await supabase.rpc('create_group_with_owner', {
    p_name: input.name,
    p_category: input.category,
    p_default_currency: input.currency,
  });

  if (error) return fail(translate(error));
  if (!createdId) return fail(t('errors.noCreatedIdEvent'));
  return fetchGroup(createdId as string);
}

export async function renameGroup(groupId: string, name: string): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());
  const { data, error } = await supabase.from('groups').update({ name }).eq('id', groupId).select('id').maybeSingle();
  if (error) return fail(translate(error));
  return data ? { data: true, error: null } : fail(t('errors.eventNotFoundOrNoRenamePermission'));
}

export async function renameGroupStatus(groupId: string, status: string): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());
  const { data, error } = await supabase.from('groups').update({ status }).eq('id', groupId).select('id').maybeSingle();
  if (error) return fail(translate(error));
  return data ? { data: true, error: null } : fail(t('errors.eventNotFoundOrNotOwnerStatus'));
}

export async function deleteGroup(groupId: string): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());
  const { data, error } = await supabase.from('groups').delete().eq('id', groupId).select('id').maybeSingle();
  if (error) return fail(translate(error));
  return data ? { data: true, error: null } : fail(t('errors.eventNotFoundOrNoDeletePermission'));
}

export async function addExpense(
  groupId: string,
  expense: {
    title: string;
    amount: number;
    currency: string;
    amountInGroupCurrency: number;
    category: string;
    paidById: string;
    splits: Array<{ userId: string; amountOwed: number }>;
    createdAt?: string;
  },
): Promise<RemoteResult<string>> {
  if (!supabase) return fail(noBackend());

  const { data: createdId, error } = await supabase.rpc('add_expense_with_splits', {
    p_group_id: groupId,
    p_paid_by_id: expense.paidById,
    p_title: expense.title,
    p_amount: expense.amount,
    p_currency: expense.currency,
    p_amount_in_group_currency: expense.amountInGroupCurrency,
    p_category: expense.category,
    p_created_at: expense.createdAt,
    p_splits: expense.splits.map((split) => ({ user_id: split.userId, amount_owed: split.amountOwed })),
  });

  if (error) return fail(translate(error));
  return createdId ? { data: createdId as string, error: null } : fail(t('errors.noCreatedIdExpense'));
}

/**
 * Правка расхода и полная замена долей выполняются одной RPC-транзакцией.
 */
export async function updateExpense(
  expenseId: string,
  expense: {
    title: string;
    amount: number;
    currency: string;
    amountInGroupCurrency: number;
    category: string;
    paidById: string;
    splits: Array<{ userId: string; amountOwed: number }>;
    createdAt?: string;
  },
): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());

  const { data, error } = await supabase.rpc('update_expense_with_splits', {
    p_expense_id: expenseId,
    p_paid_by_id: expense.paidById,
    p_title: expense.title,
    p_amount: expense.amount,
    p_currency: expense.currency,
    p_amount_in_group_currency: expense.amountInGroupCurrency,
    p_category: expense.category,
    p_created_at: expense.createdAt,
    p_splits: expense.splits.map((split) => ({ user_id: split.userId, amount_owed: split.amountOwed })),
  });

  if (error) return fail(translate(error));
  return data ? { data: true, error: null } : fail(t('errors.expenseNotFoundOrUnavailable'));
}

export async function deleteExpense(expenseId: string): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());
  const { data, error } = await supabase.from('expenses').delete().eq('id', expenseId).select('id').maybeSingle();
  if (error) return fail(translate(error));
  return data ? { data: true, error: null } : fail(t('errors.expenseNotFoundOrNoDeletePermission'));
}

export async function addSettlement(
  groupId: string,
  settlement: { fromUserId: string; toUserId: string; amount: number; currency: string; paymentMethod: string },
): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());

  const { error } = await supabase.from('settlements').insert({
    group_id: groupId,
    payer_id: settlement.fromUserId,
    payee_id: settlement.toUserId,
    amount: settlement.amount,
    currency: settlement.currency,
    payment_method: settlement.paymentMethod,
  });

  return error ? fail(translate(error)) : { data: true, error: null };
}

// ---------------------------------------------------------------------------
// Приглашения
// ---------------------------------------------------------------------------

function randomInviteCode(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .slice(0, 12);
}

/**
 * Ссылка-приглашение содержит одноразовый код, а не id группы. По id вступить
 * нельзя: политика на group_members разрешает прямую запись только владельцу.
 */
export async function createInvite(
  groupId: string,
  createdBy: string,
  ttlHours = 24 * 14,
): Promise<RemoteResult<string>> {
  if (!supabase) return fail(noBackend());

  const code = randomInviteCode();
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  const { error } = await supabase
    .from('group_invites')
    .insert({ group_id: groupId, invite_code: code, created_by: createdBy, expires_at: expiresAt });

  return error ? fail(translate(error)) : { data: code, error: null };
}

/** Вызывает SECURITY DEFINER функцию: единственный путь в чужую группу. */
export async function redeemInvite(code: string): Promise<RemoteResult<string>> {
  if (!supabase) return fail(noBackend());

  const { data, error } = await supabase.rpc('redeem_group_invite', { p_invite_code: code });

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('недействительно') || m.includes('истекло')) {
      return fail(t('errors.inviteInvalidOrExpired'));
    }
    return fail(translate(error));
  }
  return { data: data as string, error: null };
}

export async function leaveGroup(groupId: string, userId: string): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());
  const { data, error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .select('group_id')
    .maybeSingle();
  if (error) return fail(translate(error));
  return data ? { data: true, error: null } : fail(t('errors.memberNotFoundOrLeft'));
}

// ---------------------------------------------------------------------------
// Профиль
// ---------------------------------------------------------------------------

export async function upsertProfile(profile: {
  id: string;
  full_name: string;
  avatar_url?: string;
  email?: string;
  phone?: string;
  preferred_currency?: string;
}): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());

  const { error } = await supabase.from('profiles').upsert({
    id: profile.id,
    full_name: profile.full_name,
    avatar_url: profile.avatar_url,
    email: profile.email,
    phone: profile.phone,
    default_currency: profile.preferred_currency,
    updated_at: new Date().toISOString(),
  });

  return error ? fail(translate(error)) : { data: true, error: null };
}

/**
 * Подписка на изменения группы через Postgres Changes.
 *
 * Это не тот broadcast-канал, что был раньше: события приходят из базы после
 * применения RLS, поэтому чужие изменения физически не долетают — в отличие от
 * прошлой схемы, где клиенты сами рассылали друг другу всё своё состояние.
 */
export function subscribeToGroup(groupId: string, onChange: () => void): () => void {
  const client = supabase;
  if (!client) return () => {};

  const channel = client
    .channel(`group:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups', filter: `id=eq.${groupId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` }, onChange)
    // expense_splits не содержит group_id, поэтому фильтрацию оставляет RLS.
    // Событие нужно слушать: при редактировании expense UPDATE приходит до
    // замены долей, и без этого финального сигнала другой клиент видел старый split.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${groupId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, onChange)
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

export async function joinWaitlist(email: string): Promise<RemoteResult<true>> {
  if (!supabase) return fail(noBackend());

  // Запись идёт через RPC, а не прямым INSERT: политика анонимной записи снята
  // миграцией 20260815000000_harden_waitlist.sql. Функция сама нормализует и
  // проверяет адрес и не различает вставку и дубликат, поэтому по её ответу
  // нельзя узнать, был ли адрес уже в списке.
  const { error } = await supabase.rpc('join_waitlist', { p_email: email });

  if (error) {
    return fail(translate(error));
  }

  return { data: true, error: null };
}

// ---------------------------------------------------------------------------
// Virtual members (guests)
// ---------------------------------------------------------------------------

export async function addGuestMember(groupId: string, name: string): Promise<RemoteResult<GroupMember>> {
  if (!supabase) return fail(noBackend());

  const { data, error } = await supabase.rpc('add_virtual_member', {
    p_group_id: groupId,
    p_member_name: name,
  });

  if (error) return fail(translate(error));
  if (!data) return fail(t('errors.noMemberDataReturned'));

  const participant = data as any;
  return {
    data: {
      id: participant.id,
      name: participant.name,
      avatar: participant.avatar ?? '👤',
      role: participant.role ?? 'member',
      email: undefined,
      phone: undefined,
    },
    error: null
  };
}
