'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/currency';
import { simplifyDebts } from '@/lib/debt-simplification';
import { getGroup, subscribeToGroup } from '@/lib/store';
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
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';

export default function EventBalanceClient({ groupId }: { groupId: string }) {
  const { t } = useI18n();
  const [group, setGroup] = useState<any>(null);

  useEffect(() => {
    // Никаких выдуманных «Участник 2» при отсутствии события: подставленный
    // фейк раньше показывал баланс несуществующей группы как настоящий.
    const loadGroupData = async () => {
      const { data } = await getGroup(groupId);
      setGroup(data);
    };

    loadGroupData();
    const unsubscribe = subscribeToGroup(groupId, loadGroupData);
    return () => unsubscribe();
  }, [groupId]);

  if (!group) {
    return <div className="p-4 text-xs font-bold text-slate-500 text-center">{t('balance.loading')}</div>;
  }

  // Calculate Net Balances for each member
  const memberBalances: Record<string, { name: string; avatar: string; paid: number; owes: number; netAmount: number }> = {};

  (group.members || []).forEach((m: any) => {
    memberBalances[m.id] = {
      name: m.name,
      avatar: m.avatar || '👤',
      paid: 0,
      owes: 0,
      netAmount: 0,
    };
  });

  // Calculate total paid & owed from expenses
  (group.expenses || []).forEach((expense: any) => {
    const paidBy = expense.paidById;
    const expenseAmt = expense.amountInGroupCurrency || expense.amount || 0;

    if (memberBalances[paidBy]) {
      memberBalances[paidBy].paid += expenseAmt;
    }

    if (expense.splits && expense.splits.length > 0) {
      expense.splits.forEach((split: any) => {
        if (memberBalances[split.userId]) {
          memberBalances[split.userId].owes += (split.amountOwed || 0);
        }
      });
    } else {
      // Default equal split if splits array missing
      const memberCount = (group.members || []).length || 1;
      const share = expenseAmt / memberCount;
      (group.members || []).forEach((m: any) => {
        if (memberBalances[m.id]) {
          memberBalances[m.id].owes += share;
        }
      });
    }
  });

  // Adjust for completed settlements
  (group.settlements || []).forEach((s: any) => {
    const fromId = s.fromUserId || s.payerId;
    const toId = s.toUserId || s.payeeId;
    const amt = parseFloat(s.amount) || 0;

    if (memberBalances[fromId]) memberBalances[fromId].paid += amt;
    if (memberBalances[toId]) memberBalances[toId].owes += amt;
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

  const optimizedTransactions = simplifyDebts(debtGraphInput, group.currency || 'RUB');

  return (
    <div className="space-y-6 max-w-md mx-auto px-1 pb-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link
          href={routes.eventDetail(group.id)}
          className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition-all shadow-xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 dark:text-white text-base">{t('balance.pageTitle')}</h2>
        <div className="w-9" />
      </div>

      {/* Debt Simplification Alert Card */}
      <div className="stitch-card p-5 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white shadow-xl space-y-3 relative overflow-hidden border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
              {t('balance.algorithmTitle')}
            </span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-400/30">
            {t('balance.optimizedBadge')}
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {t('balance.algorithmBody', {
            total: (group.members || []).length * ((group.members || []).length - 1),
            count: optimizedTransactions.length,
          })}
        </p>

        <Link
          href={routes.eventSettle(group.id)}
          className="inline-flex items-center gap-2 w-full justify-center py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-md transition-all active:scale-98"
        >
          <CreditCard className="w-4 h-4" />
          <span>{t('balance.goToSettle')}</span>
        </Link>
      </div>

      {/* Optimized Transactions Graph List */}
      <div className="space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
          <span>{t('balance.optimalTransfers')}</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-bold">
            {optimizedTransactions.length}
          </span>
        </h3>

        {optimizedTransactions.length === 0 ? (
          <div className="stitch-card p-5 text-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800">
            {t('balance.allSettled')}
          </div>
        ) : (
          optimizedTransactions.map((tx, idx) => {
            const fromMember = (group.members || []).find((m: any) => m.id === tx.fromId) || { name: t('balance.defaultMember'), avatar: '👤' };
            const toMember = (group.members || []).find((m: any) => m.id === tx.toId) || { name: t('balance.defaultMember'), avatar: '👤' };

            return (
              <div
                key={idx}
                className="stitch-card p-4 flex items-center justify-between hover:border-blue-300 transition-all bg-white dark:bg-slate-800"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center -space-x-1">
                    <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/50 border-2 border-white dark:border-slate-800 flex items-center justify-center text-sm font-bold shadow-xs">
                      {fromMember?.avatar || '👤'}
                    </div>
                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/50 border-2 border-white dark:border-slate-800 flex items-center justify-center text-sm font-bold shadow-xs">
                      {toMember?.avatar || '👤'}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1 text-xs font-bold text-slate-900 dark:text-white">
                      <span>{fromMember?.name?.split(' ')[0]}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      <span>{toMember?.name?.split(' ')[0]}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('balance.transferMethod')}</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-extrabold text-slate-900 dark:text-white text-sm">
                    {formatMoney(tx.amount, tx.currency || group.currency || 'RUB')}
                  </span>
                  <Link
                    href={routes.eventSettle(group.id, { from: tx.fromId, to: tx.toId, amount: tx.amount })}
                    className="block text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 mt-0.5"
                  >
                    {t('balance.pay')}
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Individual Net Balances List */}
      <div className="space-y-3 pt-2">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm">{t('balance.finalBalances')}</h3>

        <div className="space-y-2.5">
          {Object.entries(memberBalances).map(([id, data]) => {
            const isOwed = data.netAmount > 0.01;
            const owes = data.netAmount < -0.01;

            return (
              <div key={id} className="stitch-card p-3.5 flex items-center justify-between bg-white dark:bg-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-base">
                    {data.avatar}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-xs">{data.name}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('balance.paidLabel')} {formatMoney(data.paid, group.currency || 'RUB')}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`font-extrabold text-sm ${
                      isOwed ? 'text-emerald-600 dark:text-emerald-400' : owes ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'
                    }`}
                  >
                    {isOwed && '+ '}
                    {formatMoney(data.netAmount, group.currency || 'RUB')}
                  </span>
                  <span className="block text-[10px] text-slate-400 font-semibold">
                    {isOwed ? t('balance.owedToThem') : owes ? t('balance.theyOwe') : t('balance.settledUp')}
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
