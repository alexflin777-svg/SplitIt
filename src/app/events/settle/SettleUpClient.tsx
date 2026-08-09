'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import confetti from 'canvas-confetti';
import { ArrowLeft, CheckCircle2, CreditCard, Smartphone, Banknote, ShieldCheck, Check } from 'lucide-react';
import { getGroup, addSettlement, setGroupStatus, isMultiUser } from '@/lib/store';
import { getActiveSession } from '@/lib/supabase';
import { formatMoney } from '@/lib/currency';
import { routes } from '@/lib/routes';
import { parseAmount, AMOUNT_INPUT_PROPS } from '@/lib/money';
import { useI18n } from '@/lib/i18n/provider';

function SettleUpForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const [group, setGroup] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Ничего не подставляем: раньше при отсутствии события показывалась
    // выдуманная «Совместная поездка» с двумя вымышленными участниками.
    void Promise.all([getGroup(groupId), getActiveSession()]).then(([result, session]) => {
      if (result.error || !result.data) {
        setLoadError(result.error ?? t('settle.errorEventUnavailable'));
        return;
      }

      const loadedGroup = result.data;
      const memberIds = (loadedGroup.members || []).map((member: any) => member.id);
      const requestedFrom = searchParams.get('from');
      const requestedTo = searchParams.get('to');
      const nextPayer =
        isMultiUser() && session && memberIds.includes(session.id)
          ? session.id
          : requestedFrom && memberIds.includes(requestedFrom)
            ? requestedFrom
            : memberIds[0] ?? '';
      const nextPayee =
        requestedTo && memberIds.includes(requestedTo) && requestedTo !== nextPayer
          ? requestedTo
          : memberIds.find((id: string) => id !== nextPayer) ?? nextPayer;

      setPayerId(nextPayer);
      setPayeeId(nextPayee);
      setGroup(loadedGroup);
    });
  }, [groupId, searchParams, t]);

  const defaultAmount = searchParams.get('amount') || '5000';

  const [payerId, setPayerId] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [amount, setAmount] = useState(defaultAmount);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'sbp' | 'card' | 'cash'>('sbp');
  const [isSuccess, setIsSuccess] = useState(false);

  if (loadError) {
    return <div role="alert" className="p-4 text-xs font-bold text-rose-700 text-center">{loadError}</div>;
  }

  if (!group) {
    return <div className="p-4 text-xs font-bold text-slate-500 text-center">{t('settle.loading')}</div>;
  }

  const payerMember = (group.members || []).find((m: any) => m.id === payerId) || group.members[0];
  const payeeMember = (group.members || []).find((m: any) => m.id === payeeId) || group.members[0];

  const handleSettleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAmountError(null);

    // Раньше отрицательный перевод проходил проверку и переворачивал знак долга.
    const { value: parsedAmount, error: amountProblem } = parseAmount(amount);
    if (amountProblem || parsedAmount === null) {
      setAmountError(amountProblem);
      return;
    }

    if (payerId === payeeId) {
      setAmountError(t('settle.errorPayerEqualsPayee'));
      return;
    }

    // Create settlement record
    const newSettlement = {
      id: 'stl-' + Date.now(),
      fromUserId: payerId,
      toUserId: payeeId,
      amount: parsedAmount,
      currency: group.currency || 'RUB',
      method: paymentMethod,
      createdAt: new Date().toISOString(),
    };

    const { error: settleProblem } = await addSettlement(group.id, {
      fromUserId: payerId,
      toUserId: payeeId,
      amount: parsedAmount,
      currency: group.currency || 'RUB',
      paymentMethod,
    });

    if (settleProblem) {
      setAmountError(settleProblem);
      return;
    }

    setIsSuccess(true);
    try {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err) {
      console.warn('Confetti error', err);
    }

    setTimeout(() => {
      router.push(routes.eventDetail(group.id));
    }, 2000);
  };

  const handleCompleteAllSettlements = async () => {
    const { error } = await setGroupStatus(group.id, 'completed');
    if (error) {
      setAmountError(error);
      return;
    }

    setIsSuccess(true);
    try {
      confetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.5 },
      });
    } catch (err) {
      console.warn('Confetti error', err);
    }

    setTimeout(() => {
      router.push(routes.eventDetail(group.id));
    }, 2000);
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1 pb-24">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link
          href={routes.eventDetail(group.id)}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 text-base">{t('settle.pageTitle')}</h2>
        <div className="w-9" />
      </div>

      {isSuccess && (
        <div className="stitch-card p-6 bg-emerald-500 text-white text-center space-y-3 shadow-xl animate-in fade-in zoom-in duration-300">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto text-white">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-extrabold">{t('settle.successTitle')}</h3>
          <p className="text-xs text-emerald-100 max-w-xs mx-auto font-medium">
            {t('settle.successBody', { payer: payerMember?.name, payee: payeeMember?.name })}
          </p>
        </div>
      )}

      <form onSubmit={handleSettleSubmit} className="space-y-5">
        {/* Payer & Payee Selection */}
        <div className="stitch-card p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('settle.payerLabel')}
            </label>
            <select
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              disabled={isMultiUser()}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {(group.members || []).map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.avatar || '👤'} {m.name}
                </option>
              ))}
            </select>
            {isMultiUser() && (
              <p className="text-[11px] text-slate-500">{t('settle.multiUserPayerNote')}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('settle.payeeLabel')}
            </label>
            <select
              value={payeeId}
              onChange={(e) => setPayeeId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {(group.members || []).map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.avatar || '👤'} {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Amount Input */}
        <div className="stitch-card p-5 space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('settle.amountLabel', { currency: group.currency || 'RUB' })}
          </label>
          <input
            type="number"
            {...AMOUNT_INPUT_PROPS}
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-2xl font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Payment Method Choice */}
        <div className="stitch-card p-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('settle.methodLabel')}
          </label>

          <div className="grid grid-cols-3 gap-2.5">
            {[
              { id: 'sbp', label: t('settle.method.sbp'), icon: Smartphone },
              { id: 'card', label: t('settle.method.card'), icon: CreditCard },
              { id: 'cash', label: t('settle.method.cash'), icon: Banknote },
            ].map((method) => {
              const Icon = method.icon;
              const isSelected = paymentMethod === method.id;
              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => setPaymentMethod(method.id as any)}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-center transition-all ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-5 h-5 text-emerald-600" />
                  <span className="text-[11px]">{method.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {amountError && (
          <div
            role="alert"
            data-testid="amount-error"
            className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-bold"
          >
            {amountError}
          </div>
        )}

        {/* Action Button */}
        <div className="space-y-3">
          <button
            type="submit"
            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md shadow-emerald-500/20 transition-all active:scale-98"
          >
            {t('settle.confirmTransfer')}
          </button>

          <button
            type="button"
            onClick={handleCompleteAllSettlements}
            className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{t('settle.finishAll')}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default function SettleUpClient({ groupId }: { groupId: string }) {
  const { t } = useI18n();
  return (
    <Suspense fallback={<div className="p-4 text-xs font-bold text-slate-500 text-center">{t('settle.formLoading')}</div>}>
      <SettleUpForm groupId={groupId} />
    </Suspense>
  );
}
