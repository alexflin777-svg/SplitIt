/**
 * Итог события: балансы участников и минимальный список переводов.
 *
 * Раньше этот расчёт жил внутри EventBalanceClient. Теперь его использует ещё
 * и экран закрытого события (итог + «Напомнить»), поэтому он вынесен в чистую
 * функцию: одна формула — одни и те же числа на всех экранах, и её можно
 * покрыть unit-тестом без браузера.
 */

import { simplifyDebts, Transaction } from './debt-simplification';

export interface MemberBalance {
  id: string;
  name: string;
  avatar: string;
  paid: number;
  owes: number;
  netAmount: number;
}

export interface EventSummary {
  balances: Record<string, MemberBalance>;
  transfers: Transaction[];
  total: number;
}

type AnyGroup = {
  members?: Array<{ id: string; name: string; avatar?: string }>;
  expenses?: Array<any>;
  settlements?: Array<any>;
  currency?: string;
};

export function computeEventSummary(group: AnyGroup): EventSummary {
  const members = group.members || [];
  const balances: Record<string, MemberBalance> = {};

  for (const m of members) {
    balances[m.id] = { id: m.id, name: m.name, avatar: m.avatar || '👤', paid: 0, owes: 0, netAmount: 0 };
  }

  let total = 0;
  for (const expense of group.expenses || []) {
    const amount = expense.amountInGroupCurrency || expense.amount || 0;
    total += amount;

    if (balances[expense.paidById]) balances[expense.paidById].paid += amount;

    if (expense.splits && expense.splits.length > 0) {
      for (const split of expense.splits) {
        if (balances[split.userId]) balances[split.userId].owes += split.amountOwed || 0;
      }
    } else {
      // Нет долей — поровну на всех участников (поведение прежнего экрана баланса).
      const share = amount / (members.length || 1);
      for (const m of members) balances[m.id].owes += share;
    }
  }

  // Уже совершённые переводы: плательщик «доплатил», получатель «получил».
  for (const s of group.settlements || []) {
    const fromId = s.fromUserId || s.payerId;
    const toId = s.toUserId || s.payeeId;
    const amount = parseFloat(s.amount) || 0;
    if (balances[fromId]) balances[fromId].paid += amount;
    if (balances[toId]) balances[toId].owes += amount;
  }

  for (const b of Object.values(balances)) b.netAmount = b.paid - b.owes;

  const input: Record<string, { name: string; netAmount: number }> = {};
  for (const [id, b] of Object.entries(balances)) input[id] = { name: b.name, netAmount: b.netAmount };

  return {
    balances,
    transfers: simplifyDebts(input, group.currency || 'RUB'),
    total,
  };
}

/** Переводы, в которых участвует пользователь, — для карточки «ты должен / тебе должны». */
export function transfersFor(summary: EventSummary, userId: string | null | undefined) {
  if (!userId) return { owe: [] as Transaction[], owed: [] as Transaction[] };
  return {
    owe: summary.transfers.filter((t) => t.fromId === userId),
    owed: summary.transfers.filter((t) => t.toId === userId),
  };
}

type Fmt = (amount: number, currency: string) => string;
type T = (key: string, vars?: Record<string, string | number>) => string;

/** Текст итога для «Поделиться»: читается в любом мессенджере без приложения. */
export function buildSummaryText(eventName: string, summary: EventSummary, currency: string, t: T, fmt: Fmt): string {
  const lines = [t('summary.shareHeader', { name: eventName }), t('summary.shareTotal', { total: fmt(summary.total, currency) }), ''];
  if (summary.transfers.length === 0) {
    lines.push(t('summary.allSettled'));
  } else {
    for (const tr of summary.transfers) {
      lines.push(`• ${tr.fromName} → ${tr.toName}: ${fmt(tr.amount, currency)}`);
    }
  }
  return lines.join('\n');
}

/** Текст напоминания конкретному должнику. */
export function buildReminderText(eventName: string, transfer: Transaction, currency: string, t: T, fmt: Fmt): string {
  return t('summary.reminderText', {
    name: transfer.fromName,
    amount: fmt(transfer.amount, currency),
    to: transfer.toName,
    event: eventName,
  });
}
