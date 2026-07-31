'use client';

import { useState } from 'react';
import Link from 'next/link';
import { INITIAL_GROUPS, INITIAL_MEMBERS } from '@/lib/mock-data';
import { formatMoney } from '@/lib/currency';
import { simplifyDebts } from '@/lib/debt-simplification';
import {
  ArrowLeft,
  Scale,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Zap,
  TrendingUp,
  UserCheck,
} from 'lucide-react';

export default function EventBalanceClient({ groupId }: { groupId: string }) {
  const group = INITIAL_GROUPS.find((g) => g.id === groupId) || {
    id: groupId,
    name: 'Новое событие',
    category: 'trip' as const,
    currency: 'RUB',
    createdBy: 'user-me',
    createdAt: new Date().toISOString(),
    members: INITIAL_MEMBERS,
    expenses: [],
    settlements: [],
  };

  // Calculate Net Balances for each member
  const memberBalances: Record<string, { name: string; avatar: string; paid: number; owes: number; netAmount: number }> = {};

  group.members.forEach((m) => {
    memberBalances[m.id] = {
      name: m.name,
      avatar: m.avatar,
      paid: 0,
      owes: 0,
      netAmount: 0,
    };
  });

  // Calculate total paid & owed from expenses
  group.expenses.forEach((expense) => {
    if (memberBalances[expense.paidById]) {
      memberBalances[expense.paidById].paid += expense.amountInGroupCurrency;
    }
    expense.splits.forEach((split) => {
      if (memberBalances[split.userId]) {
        memberBalances[split.userId].owes += split.amountOwed;
      }
    });
  });

  // Adjust for settlements
  group.settlements.forEach((s) => {
    if (s.status === 'completed') {
      if (memberBalances[s.payerId]) memberBalances[s.payerId].paid += s.amount;
      if (memberBalances[s.payeeId]) memberBalances[s.payeeId].owes += s.amount;
    }
  });

  // Compute Net Balance
  Object.keys(memberBalances).forEach((id) => {
    const b = memberBalances[id];
    b.netAmount = b.paid - b.owes;
  });

  // Run Debt Simplification algorithm
  const debtGraphInput: Record<string, { name: string; netAmount: number }> = {};
  Object.entries(memberBalances).forEach(([id, data]) => {
    debtGraphInput[id] = { name: data.name, netAmount: data.netAmount };
  });

  const optimizedTransactions = simplifyDebts(debtGraphInput, group.currency);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link
          href={`/events/${group.id}`}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 text-base">Баланс & Итоговый расчет</h2>
        <div className="w-9" />
      </div>

      {/* Debt Simplification Alert Card */}
      <div className="stitch-card p-5 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white shadow-xl space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
              Алгоритм минимизации долгов
            </span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-400/30">
            Оптимизировано
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Вместо {group.members.length * (group.members.length - 1)} переводов между всеми участниками,
          алгоритм свел все взаиморасчеты всего к <strong className="text-white font-extrabold">{optimizedTransactions.length} оптимальным транзакциям</strong>.
        </p>

        <Link
          href={`/events/${group.id}/settle`}
          className="inline-flex items-center gap-2 w-full justify-center py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-md transition-all active:scale-98"
        >
          <CreditCard className="w-4 h-4" />
          <span>Перейти к гашению долгов</span>
        </Link>
      </div>

      {/* Optimized Transactions Graph List */}
      <div className="space-y-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <span>Оптимальные переводы для закрытия долгов</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
            {optimizedTransactions.length}
          </span>
        </h3>

        {optimizedTransactions.length === 0 ? (
          <div className="stitch-card p-5 text-center text-xs text-slate-500">
            Все расчеты выполнены. Никто никому не должен! 🎉
          </div>
        ) : (
          optimizedTransactions.map((tx, idx) => {
            const fromMember = group.members.find((m) => m.id === tx.fromId);
            const toMember = group.members.find((m) => m.id === tx.toId);

            return (
              <div
                key={idx}
                className="stitch-card p-4 flex items-center justify-between hover:border-blue-300 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center -space-x-1">
                    <div className="w-9 h-9 rounded-full bg-amber-100 border-2 border-white flex items-center justify-center text-sm font-bold shadow-xs">
                      {fromMember?.avatar || '👤'}
                    </div>
                    <div className="w-9 h-9 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-sm font-bold shadow-xs">
                      {toMember?.avatar || '👤'}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1 text-xs font-bold text-slate-900">
                      <span>{fromMember?.name.split(' ')[0]}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      <span>{toMember?.name.split(' ')[0]}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium">Перевод через СБП / Карту</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-extrabold text-slate-900 text-sm">
                    {formatMoney(tx.amount, tx.currency)}
                  </span>
                  <Link
                    href={`/events/${group.id}/settle?from=${tx.fromId}&to=${tx.toId}&amount=${tx.amount}`}
                    className="block text-[11px] font-bold text-blue-600 hover:text-blue-700 mt-0.5"
                  >
                    Оплатить ➔
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Individual Net Balances List */}
      <div className="space-y-3 pt-2">
        <h3 className="font-bold text-slate-900 text-sm">Итоговые балансы участников</h3>

        <div className="space-y-2.5">
          {Object.entries(memberBalances).map(([id, data]) => {
            const isOwed = data.netAmount > 0.01;
            const owes = data.netAmount < -0.01;

            return (
              <div key={id} className="stitch-card p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-base">
                    {data.avatar}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-xs">{data.name}</h4>
                    <p className="text-[11px] text-slate-500">
                      Оплатил(а): {formatMoney(data.paid, group.currency)}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`font-extrabold text-sm ${
                      isOwed ? 'text-emerald-600' : owes ? 'text-amber-600' : 'text-slate-400'
                    }`}
                  >
                    {isOwed && '+ '}
                    {formatMoney(data.netAmount, group.currency)}
                  </span>
                  <span className="block text-[10px] text-slate-400 font-semibold">
                    {isOwed ? 'Ему должны' : owes ? 'Должен' : 'В расчете'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
