'use client';

import { useEffect, useSyncExternalStore } from 'react';
import useSWR, { mutate as mutateGlobal } from 'swr';
import {
  getGroup,
  listGroups,
  subscribeToGroup,
  type Group,
  type GroupRealtimeChange,
  type RemoteResult,
} from './store';
import { getFriendsSnapshot, getLocalSession, getSavedFriends, getServerFriendsSnapshot, subscribeToFriends, supabase } from './supabase';
import { authGeneration, onAuthUserChanged, readSnap, settleSnap } from './snapshot';

/**
 * Локальный список друзей без setState в эффекте (P1-6): на сервере и при
 * гидратации — пустой список, затем React сам перечитывает localStorage.
 * Обновляется при saveFriends в этой вкладке и при изменениях в соседних.
 */
export function useSavedFriends(): any[] {
  useEffect(() => {
    // Одноразовая чистка старого демо-набора в хранилище (инвариант И-14).
    getSavedFriends();
  }, []);
  return useSyncExternalStore(subscribeToFriends, getFriendsSnapshot, getServerFriendsSnapshot);
}

/** Ключи кэша — с id пользователя: ответ, пришедший после смены аккаунта, ляжет под ключ прежнего. */
const cacheUid = () => getLocalSession()?.id ?? '';
const groupsCacheKey = () => ['splitit:groups', cacheUid()] as const;
const groupCacheKey = (groupId: string) => ['splitit:group', groupId, cacheUid()] as const;
const isGroupsKey = (key: unknown) => Array.isArray(key) && key[0] === 'splitit:groups';

// Смена аккаунта: весь кэш событий — прочь до первого кадра нового аккаунта.
onAuthUserChanged(() => void mutateGlobal(() => true, undefined, { revalidate: false }));

function patchGroup(result: RemoteResult<Group> | undefined, change: GroupRealtimeChange): RemoteResult<Group> | undefined {
  if (!result?.data) return result;
  if (result.data.id !== change.groupId) return result;

  if (change.type === 'group-patch') {
    return { ...result, data: { ...result.data, ...change.patch } };
  }

  if (change.type === 'expense-delete') {
    return {
      ...result,
      data: {
        ...result.data,
        expenses: result.data.expenses.filter((expense) => expense.id !== change.expenseId),
      },
    };
  }

  if (change.type === 'expense-upsert') {
    const withoutChanged = result.data.expenses.filter((expense) => expense.id !== change.expense.id);
    // Без обрезки: в кеше все расходы события (G2), и обрезка выкинула бы
    // старые расходы из балансов при каждом новом.
    const expenses = [change.expense, ...withoutChanged].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      ...result,
      data: {
        ...result.data,
        expenses,
      },
    };
  }

  return result;
}

function patchGroups(result: RemoteResult<Group[]> | undefined, change: GroupRealtimeChange): RemoteResult<Group[]> | undefined {
  if (!result?.data) return result;

  if (change.type === 'group-patch') {
    return {
      ...result,
      data: result.data.map((group) => (group.id === change.groupId ? { ...group, ...change.patch } : group)),
    };
  }

  if (change.type === 'expense-delete') {
    return {
      ...result,
      data: result.data.map((group) =>
        group.id === change.groupId
          ? { ...group, expenses: group.expenses.filter((expense) => expense.id !== change.expenseId) }
          : group,
      ),
    };
  }

  if (change.type === 'expense-upsert') {
    return {
      ...result,
      data: result.data.map((group) =>
        group.id === change.groupId
          ? {
              ...group,
              expenses: [change.expense, ...group.expenses.filter((expense) => expense.id !== change.expense.id)].sort(
                (a, b) => b.createdAt.localeCompare(a.createdAt),
              ),
            }
          : group,
      ),
    };
  }

  return result;
}

function applyRealtimeChange(groupId: string, change: GroupRealtimeChange | undefined) {
  if (!change) {
    void mutateGlobal((key) => Array.isArray(key) && key[0] === 'splitit:group' && key[1] === groupId);
    void mutateGlobal(isGroupsKey);
    return;
  }

  if (change.type === 'refetch') {
    void mutateGlobal((key) => Array.isArray(key) && key[0] === 'splitit:group' && key[1] === groupId);
    void mutateGlobal(isGroupsKey);
    return;
  }

  // Гость, добавленный на другом устройстве, приходит в расходе раньше, чем в
  // members (group_participants нет в realtime-публикации). Такой расход
  // нельзя просто вклеить: доля неизвестного участника молча выпала бы из
  // итогов. Поэтому в этом случае группа перечитывается целиком.
  let unknownParty = false;
  const noteUnknown = (group: Group | undefined) => {
    if (group && change.type === 'expense-upsert' && hasUnknownParty(group, change.expense)) unknownParty = true;
  };

  const single = mutateGlobal(
    (key) => Array.isArray(key) && key[0] === 'splitit:group' && key[1] === groupId,
    (current) => {
      noteUnknown((current as RemoteResult<Group> | undefined)?.data ?? undefined);
      return patchGroup(current as RemoteResult<Group> | undefined, change);
    },
    { revalidate: false },
  );
  const list = mutateGlobal(
    isGroupsKey,
    (current) => {
      noteUnknown((current as RemoteResult<Group[]> | undefined)?.data?.find((g) => g.id === groupId));
      return patchGroups(current as RemoteResult<Group[]> | undefined, change);
    },
    { revalidate: false },
  );
  void Promise.all([single, list]).then(() => {
    if (unknownParty) applyRealtimeChange(groupId, undefined);
  });
}

function hasUnknownParty(group: Group, expense: Group['expenses'][number]): boolean {
  const known = new Set(group.members.map((m) => m.id));
  return !known.has(expense.paidById) || expense.splits.some((s) => !known.has(s.userId));
}

/** Снимки событий — только в сетевом режиме: локальные данные и так читаются мгновенно. */
const snapUid = () => (supabase ? getLocalSession()?.id ?? null : null);

const isGroup = (v: unknown) => {
  const g = v as Partial<Group> | null;
  return !!g && typeof g.id === 'string' && Array.isArray(g.members) && Array.isArray(g.expenses);
};
const isGroupList = (v: unknown) => Array.isArray(v) && v.every(isGroup);

/** Снимок для первого кадра. */
function snapFallback<T>(name: string | null, valid: (v: unknown) => boolean) {
  const snap = name ? readSnap<T>(snapUid(), name, valid) : null;
  return snap ? { fallbackData: { data: snap, error: null } as RemoteResult<T> } : {};
}

/**
 * Чтение для экрана со снимком: свежий ответ — в снимок; «нет прав / не найдено» —
 * снимок стереть; сбой связи — снимок остаётся на экране вместе с ошибкой.
 */
function withSnap<T>(name: string | null, valid: (v: unknown) => boolean, read: () => Promise<RemoteResult<T>>) {
  return async (): Promise<RemoteResult<T>> => {
    const uid = snapUid();
    const gen = authGeneration();
    const r = await read();
    if (!name || settleSnap(uid, name, gen, r) !== 'kept') return r;
    return { ...r, data: readSnap<T>(uid, name, valid) };
  };
}

export function useGroups() {
  const swr = useSWR(groupsCacheKey(), withSnap('groups', isGroupList, listGroups), {
    revalidateOnFocus: true,
    ...snapFallback<Group[]>('groups', isGroupList),
  });

  return {
    groups: swr.data?.data ?? [],
    error: swr.data?.error ?? null,
    isLoading: swr.isLoading,
    refresh: swr.mutate,
  };
}

/** snapshot: true — только экран просмотра события; расчёты и отметки переводов — без снимка. */
export function useGroup(groupId: string, opts: { snapshot?: boolean } = {}) {
  const key = groupId ? groupCacheKey(groupId) : null;
  const snapName = opts.snapshot && groupId ? `group:${groupId}` : null;
  const swr = useSWR(key, withSnap(snapName, isGroup, () => getGroup(groupId)), {
    revalidateOnFocus: true,
    ...snapFallback<Group>(snapName, isGroup),
  });

  useEffect(() => {
    if (!groupId) return;
    return subscribeToGroup(groupId, (change) => applyRealtimeChange(groupId, change));
  }, [groupId]);

  return {
    group: swr.data?.data ?? null,
    error: swr.data?.error ?? null,
    /** denied — нет прав или события нет; иначе ошибка временная (сеть), её показывают с «Повторить». */
    reason: swr.data?.reason,
    isLoading: swr.isLoading,
    refresh: swr.mutate,
  };
}
