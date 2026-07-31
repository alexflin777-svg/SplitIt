/**
 * Единая точка доступа к данным для экранов.
 *
 * Приложение живёт в двух режимах, и экраны не должны про это знать:
 *
 *   - **сетевой** — Supabase настроен, данные общие, доступ режет RLS,
 *     изменения прилетают через Postgres Changes;
 *   - **локальный** — Supabase не настроен, данные лежат в localStorage на
 *     одном устройстве, и приложение честно об этом сообщает.
 *
 * Раньше локальный режим был единственным и притворялся сетевым: экран
 * авторизации обещал синхронизацию между устройствами, а ссылка-приглашение
 * не могла передать группу. Здесь режим определяется один раз и виден наружу
 * через `isMultiUser()`.
 *
 * Весь API асинхронный даже в локальном режиме: иначе переход между режимами
 * потребовал бы переписывать каждый экран.
 */

import { isSupabaseConfigured } from './env';
import * as remote from './remote-store';
import type { Group, RemoteResult } from './remote-store';
import { getSavedGroups, saveGroups, getLocalSession } from './supabase';

export type { Group, GroupMember, GroupExpense, GroupSettlement } from './remote-store';

export function isMultiUser(): boolean {
  return isSupabaseConfigured();
}

function ok<T>(data: T): RemoteResult<T> {
  return { data, error: null };
}

function localGroups(): Group[] {
  return getSavedGroups() as Group[];
}

function writeLocal(groups: Group[]): string | null {
  return saveGroups(groups);
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

export async function listGroups(): Promise<RemoteResult<Group[]>> {
  if (isMultiUser()) return remote.fetchGroups();
  return ok(localGroups());
}

export async function getGroup(groupId: string): Promise<RemoteResult<Group>> {
  if (isMultiUser()) return remote.fetchGroup(groupId);

  const found = localGroups().find((g) => g.id === groupId);
  // Ничего не сочиняем: событие либо есть, либо его нет.
  return found
    ? ok(found)
    : { data: null, error: 'Событие недоступно: его нет на этом устройстве.' };
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

export async function createGroup(input: {
  name: string;
  category: string;
  currency: string;
  memberNames?: string[];
}): Promise<RemoteResult<Group>> {
  const session = getLocalSession();
  if (!session) return { data: null, error: 'Войдите в аккаунт, чтобы создать событие' };

  if (isMultiUser()) {
    // Участников по именам в сетевом режиме не добавляют: человек попадает в
    // группу только через приглашение, иначе в базе появятся строки без
    // настоящих пользователей и расчёт долгов повиснет на призраках.
    return remote.createGroup({
      name: input.name,
      category: input.category,
      currency: input.currency,
      ownerId: session.id,
    });
  }

  const group: Group = {
    id: `group-${Date.now()}`,
    name: input.name,
    category: input.category,
    currency: input.currency,
    status: 'active',
    createdBy: session.id,
    createdAt: new Date().toISOString(),
    members: (input.memberNames ?? [session.full_name]).map((name, idx) => ({
      id: idx === 0 ? session.id : `member-${idx}-${Date.now()}`,
      name,
      avatar: idx === 0 ? session.avatar_url || '👑' : '👤',
      role: idx === 0 ? 'owner' : 'member',
    })),
    expenses: [],
    settlements: [],
  };

  const error = writeLocal([group, ...localGroups()]);
  return error ? { data: null, error } : ok(group);
}

export async function renameGroup(groupId: string, name: string): Promise<RemoteResult<true>> {
  if (isMultiUser()) return remote.renameGroup(groupId, name);

  const groups = localGroups();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return { data: null, error: 'Событие не найдено' };
  groups[idx] = { ...groups[idx], name, updatedAt: new Date().toISOString() };
  const error = writeLocal(groups);
  return error ? { data: null, error } : ok(true);
}

export async function setGroupStatus(groupId: string, status: string): Promise<RemoteResult<true>> {
  if (isMultiUser()) {
    const { error } = await remote.renameGroupStatus(groupId, status);
    return error ? { data: null, error } : ok(true);
  }

  const groups = localGroups();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return { data: null, error: 'Событие не найдено' };
  groups[idx] = { ...groups[idx], status, updatedAt: new Date().toISOString() };
  const error = writeLocal(groups);
  return error ? { data: null, error } : ok(true);
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
): Promise<RemoteResult<true>> {
  if (isMultiUser()) {
    const { error } = await remote.addExpense(groupId, expense);
    return error ? { data: null, error } : ok(true);
  }

  const groups = localGroups();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return { data: null, error: 'Событие не найдено' };

  groups[idx] = {
    ...groups[idx],
    expenses: [
      { id: `exp-${Date.now()}`, ...expense, createdAt: expense.createdAt ?? new Date().toISOString() },
      ...groups[idx].expenses,
    ],
    updatedAt: new Date().toISOString(),
  };
  const error = writeLocal(groups);
  return error ? { data: null, error } : ok(true);
}

export async function updateExpense(
  groupId: string,
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
  if (isMultiUser()) {
    const { error } = await remote.updateExpense(expenseId, expense);
    return error ? { data: null, error } : ok(true);
  }

  const groups = localGroups();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return { data: null, error: 'Событие не найдено' };

  groups[idx] = {
    ...groups[idx],
    expenses: groups[idx].expenses.map((e) =>
      e.id === expenseId ? { ...e, ...expense, id: expenseId, createdAt: expense.createdAt ?? e.createdAt } : e,
    ),
    updatedAt: new Date().toISOString(),
  };
  const error = writeLocal(groups);
  return error ? { data: null, error } : ok(true);
}

export async function deleteExpense(groupId: string, expenseId: string): Promise<RemoteResult<true>> {
  if (isMultiUser()) {
    const { error } = await remote.deleteExpense(expenseId);
    return error ? { data: null, error } : ok(true);
  }

  const groups = localGroups();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return { data: null, error: 'Событие не найдено' };
  groups[idx] = {
    ...groups[idx],
    expenses: groups[idx].expenses.filter((e) => e.id !== expenseId),
    updatedAt: new Date().toISOString(),
  };
  const error = writeLocal(groups);
  return error ? { data: null, error } : ok(true);
}

export async function addSettlement(
  groupId: string,
  settlement: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    currency: string;
    paymentMethod: string;
  },
): Promise<RemoteResult<true>> {
  if (isMultiUser()) {
    const { error } = await remote.addSettlement(groupId, settlement);
    return error ? { data: null, error } : ok(true);
  }

  const groups = localGroups();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return { data: null, error: 'Событие не найдено' };
  groups[idx] = {
    ...groups[idx],
    settlements: [
      {
        id: `stl-${Date.now()}`,
        ...settlement,
        status: 'completed',
        createdAt: new Date().toISOString(),
      },
      ...groups[idx].settlements,
    ],
    updatedAt: new Date().toISOString(),
  };
  const error = writeLocal(groups);
  return error ? { data: null, error } : ok(true);
}

// ---------------------------------------------------------------------------
// Приглашения
// ---------------------------------------------------------------------------

/**
 * В сетевом режиме возвращает одноразовый код. В локальном приглашений нет
 * вовсе: передать событие на другое устройство физически нечем, и притворяться
 * тут — тот самый дефект, из-за которого ссылка открывала выдуманную группу.
 */
export async function createInvite(groupId: string): Promise<RemoteResult<string>> {
  if (!isMultiUser()) {
    return {
      data: null,
      error: 'Приглашения работают только с подключённым бэкендом: событие хранится на этом устройстве.',
    };
  }

  const session = getLocalSession();
  if (!session) return { data: null, error: 'Войдите в аккаунт' };
  return remote.createInvite(groupId, session.id);
}

export async function redeemInvite(code: string): Promise<RemoteResult<string>> {
  if (!isMultiUser()) {
    return { data: null, error: 'Приглашения работают только с подключённым бэкендом.' };
  }
  return remote.redeemInvite(code);
}

// ---------------------------------------------------------------------------
// Подписка на изменения
// ---------------------------------------------------------------------------

export function subscribeToGroup(groupId: string, onChange: () => void): () => void {
  if (isMultiUser()) return remote.subscribeToGroup(groupId, onChange);

  // Локальный режим: только соседние вкладки того же браузера.
  if (typeof window === 'undefined') return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === 'splitit_local_groups_data') onChange();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
