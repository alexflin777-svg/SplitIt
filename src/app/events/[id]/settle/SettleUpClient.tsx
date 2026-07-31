'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import confetti from 'canvas-confetti';
import { ArrowLeft, CheckCircle2, CreditCard, Smartphone, Banknote, Upload, ShieldCheck } from 'lucide-react';
import { INITIAL_GROUPS, INITIAL_MEMBERS } from '@/lib/mock-data';
import { CURRENCIES, formatMoney } from '@/lib/currency';

function SettleUpForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
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

  const defaultFrom = searchParams.get('from') || group.members[0]?.id || 'user-me';
  const defaultTo = searchParams.get('to') || group.members[0]?.id || 'user-me';
  const defaultAmount = searchParams.get('amount') || '5000';

  const [payerId, setPayerId] = useState(defaultFrom);
  const [payeeId, setPayeeId] = useState(defaultTo);
  const [amount, setAmount] = useState(defaultAmount);
  const [paymentMethod, setPaymentMethod] = useState<'sbp' | 'card' | 'cash'>('sbp');
  const [isSuccess, setIsSuccess] = useState(false);

  const payerMember = group.members.find((m) => m.id === payerId) || group.members[0];
  const payeeMember = group.members.find((m) => m.id === payeeId) || group.members[0];

  const handleSettleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSuccess(true);
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });

    setTimeout(() => {
      router.push(`/events/${group.id}`);
    }, 2500);
  };

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
        <h2 className="font-extrabold text-slate-900 text-base">Фиксация оплаты долга</h2>
        <div className="w-9" />
      </div>

      {isSuccess && (
        <div className="stitch-card p-6 bg-emerald-500 text-white text-center space-y-3 shadow-xl animate-in fade-in zoom-in duration-300">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto text-white">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-extrabold">Оплата зарегистрирована!</h3>
          <p className="text-xs text-emerald-100 max-w-xs mx-auto">
            Перевод между {payerMember.name} и {payeeMember.name} учтен в балансе группы.
          </p>
        </div>
      )}

      <form onSubmit={handleSettleSubmit} className="space-y-5">
        {/* Payer & Payee Selection */}
        <div className="stitch-card p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Кто переводит деньги? (Должник)
            </label>
            <select
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {group.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.avatar} {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Кому переводит? (Получатель)
            </label>
            <select
              value={payeeId}
              onChange={(e) => setPayeeId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {group.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.avatar} {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Amount Input */}
        <div className="stitch-card p-5 space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Сумма перевода ({group.currency})
          </label>
          <input
            type="number"
            step="any"
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
            Способ перевода
          </label>

          <div className="grid grid-cols-3 gap-2.5">
            {[
              { id: 'sbp', label: 'СБП (Телефон)', icon: Smartphone },
              { id: 'card', label: 'Карта', icon: CreditCard },
              { id: 'cash', label: 'Наличные', icon: Banknote },
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

        {/* Phone / Details for SBP */}
        {paymentMethod === 'sbp' && payeeMember.phone && (
          <div className="stitch-card p-4 bg-emerald-50/60 border-emerald-200 text-xs text-emerald-900 space-y-1">
            <div className="flex items-center gap-2 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Телефон получателя {payeeMember.name}:</span>
            </div>
            <p className="font-extrabold text-sm text-emerald-800 pl-6">{payeeMember.phone}</p>
          </div>
        )}

        {/* Action Button */}
        <button
          type="submit"
          className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md shadow-emerald-500/20 transition-all active:scale-98"
        >
          Подтвердить перевод
        </button>
      </form>
    </div>
  );
}

export default function SettleUpClient({ groupId }: { groupId: string }) {
  return (
    <Suspense fallback={<div className="p-4 text-xs font-bold text-slate-500">Загрузка формы...</div>}>
      <SettleUpForm groupId={groupId} />
    </Suspense>
  );
}
