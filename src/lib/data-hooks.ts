'use client';

import { useEffect } from 'react';
import useSWR, { mutate as mutateGlobal } from 'swr';
import {
  getGroup,
  listGroups,
  subscribeToGroup,
  type Group,
  type GroupRealtimeChange,
  type RemoteResult,
} from './store';
import { DEFAULT_EXPENSE_PAGE_SIZE } from './remote-store';

export const GROUPS_CACHE_KEY = 'splitit:groups';
export const groupCacheKey = (groupId: string, expensesLimit = DEFAULT_EXPENSE_PAGE_SIZE) =>
  ['splitit:group', groupId, expensesLimit] as const;

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
    const expenses = [change.expense, ...withoutChanged]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, result.data.expensesLimit ?? DEFAULT_EXPENSE_PAGE_SIZE);

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
              expenses: [change.expense, ...group.expenses.filter((expense) => expense.id !== change.expense.id)]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, group.expensesLimit ?? DEFAULT_EXPENSE_PAGE_SIZE),
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
    void mutateGlobal(GROUPS_CACHE_KEY);
    return;
  }

  if (change.type === 'refetch') {
    void mutateGlobal((key) => Array.isArray(key) && key[0] === 'splitit:group' && key[1] === groupId);
    void mutateGlobal(GROUPS_CACHE_KEY);
    return;
  }

  void mutateGlobal(
    (key) => Array.isArray(key) && key[0] === 'splitit:group' && key[1] === groupId,
    (current) => patchGroup(current as RemoteResult<Group> | undefined, change),
    { revalidate: false },
  );
  void mutateGlobal(
    GROUPS_CACHE_KEY,
    (current) => patchGroups(current as RemoteResult<Group[]> | undefined, change),
    { revalidate: false },
  );
}

export function useGroups() {
  const swr = useSWR(GROUPS_CACHE_KEY, listGroups, { revalidateOnFocus: true });

  return {
    groups: swr.data?.data ?? [],
    error: swr.data?.error ?? null,
    isLoading: swr.isLoading,
    refresh: swr.mutate,
  };
}

export function useGroup(groupId: string, expensesLimit = DEFAULT_EXPENSE_PAGE_SIZE) {
  const key = groupId ? groupCacheKey(groupId, expensesLimit) : null;
  const swr = useSWR(key, () => getGroup(groupId, { expensesLimit }), { revalidateOnFocus: true });

  useEffect(() => {
    if (!groupId) return;
    return subscribeToGroup(groupId, (change) => applyRealtimeChange(groupId, change));
  }, [groupId]);

  return {
    group: swr.data?.data ?? null,
    error: swr.data?.error ?? null,
    isLoading: swr.isLoading,
    refresh: swr.mutate,
  };
}
