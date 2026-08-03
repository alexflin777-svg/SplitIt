'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Calendar, Tag, Trash2 } from 'lucide-react';
import { CURRENCIES, convertCurrency, formatMoney, fetchLiveExchangeRates, getRateDisclosure, isRateStale } from '@/lib/currency';
import { getGroup, updateExpense, deleteExpense } from '@/lib/store';
import { routes } from '@/lib/routes';
import { parseAmount, AMOUNT_INPUT_PROPS } from '@/lib/money';

export default function EditExpenseClient({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const router = useRouter();

  const [group, setGroup] = useState<any>(null);
  const [expense, setExpense] = useState<any>(null);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [currency, setCurrency] = useState('RUB');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState<'food' | 'transport' | 'lodging' | 'entertainment' | 'other'>('food');
  const [paidById, setPaidById] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Запрос курсов был, но результат ни на что не влиял: пересчёт считался
  // один раз до его завершения. Флаг заставляет пересчитать после загрузки.
  const [ratesLoaded, setRatesLoaded] = useState(false);

  useEffect(() => {
    fetchLiveExchangeRates().finally(() => setRatesLoaded(true));
    void getGroup(groupId).then(({ data: foundGroup }) => {
    if (foundGroup) {
      setGroup(foundGroup);
      const foundExp = (foundGroup.expenses || []).find((e: any) => e.id === expenseId);
      if (foundExp) {
        setExpense(foundExp);
        setTitle(foundExp.title || '');
        setAmount(foundExp.amount ? foundExp.amount.toString() : '');
        setCurrency(foundExp.currency || foundGroup.currency || 'RUB');
        setDate(foundExp.createdAt ? foundExp.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]);
        setCategory((foundExp.category || 'food') as typeof category);
        setPaidById(foundExp.paidById || foundGroup.members?.[0]?.id || 'user-me');
        setSelectedMembers((foundExp.splits || []).map((s: any) => s.userId));
      }
    }
    });
  }, [groupId, expenseId]);

  if (!group || !expense) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-sm font-bold text-slate-500">Загрузка расхода...</p>
        <Link href={routes.eventDetail(groupId)} className="text-xs font-bold text-blue-600 underline">
          Вернуться к событию
        </Link>
      </div>
    );
  }

  const parsedAmount = parseAmount(amount).value || 0;
  const { convertedAmount } = convertCurrency(parsedAmount, currency, group.currency || 'RUB');
  const rateDisclosure = ratesLoaded
    ? getRateDisclosure(currency, group?.currency || 'RUB')
    : null;

  const categories = [
    { id: 'food', label: 'Еда & Рестораны', emoji: '🍱' },
    { id: 'transport', label: 'Транспорт & Такси', emoji: '🚖' },
    { id: 'lodging', label: 'Жилье & Отель', emoji: '🏨' },
    { id: 'entertainment', label: 'Развлечения', emoji: '🎟️' },
    { id: 'other', label: 'Другое', emoji: '🛍️' },
  ];

  const toggleMember = (id: string) => {
    if (selectedMembers.includes(id)) {
      if (selectedMembers.length > 1) {
        setSelectedMembers(selectedMembers.filter((m) => m !== id));
      }
    } else {
      setSelectedMembers([...selectedMembers, id]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setAmountError(null);

    if (!title) {
      setAmountError('Укажите название расхода');
      return;
    }

    // Раньше здесь стояло `if (!parsedAmount) return` — отрицательное число
    // truthy, поэтому расход на минус спокойно сохранялся.
    const { value: validAmount, error: amountProblem } = parseAmount(amount);
    if (amountProblem || validAmount === null) {
      setAmountError(amountProblem);
      return;
    }

    const perPerson = selectedMembers.length > 0 ? convertedAmount / selectedMembers.length : 0;
    const updatedExpense = {
      ...expense,
      title,
      amount: validAmount,
      currency,
      amountInGroupCurrency: convertedAmount,
      category,
      paidById,
      splits: selectedMembers.map((mId) => ({ userId: mId, amountOwed: perPerson })),
      createdAt: date || expense.createdAt,
    };

    setIsSaving(true);
    const { error: saveProblem } = await updateExpense(group.id, expenseId, {
      title,
      amount: validAmount,
      currency,
      amountInGroupCurrency: convertedAmount,
      category,
      paidById,
      splits: selectedMembers.map((mId) => ({ userId: mId, amountOwed: perPerson })),
      createdAt: date ? new Date(date).toISOString() : expense.createdAt,
    });
    setIsSaving(false);

    if (saveProblem) {
      setSaveError(saveProblem);
      return;
    }
    router.push(routes.eventDetail(group.id));
  };

  const handleDeleteConfirmed = async () => {
    const { error } = await deleteExpense(group.id, expenseId);
    if (error) {
      setSaveError(error);
      return;
    }
    router.push(routes.eventDetail(group.id));
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
        <h2 className="font-extrabold text-slate-900 text-base">Редактирование расхода</h2>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition-all shadow-xs"
          title="Удалить расход"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* Title Card */}
        <div className="stitch-card p-5 space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Название расхода
          </label>
          <input
            type="text"
            required
            placeholder="Например: Ужин в ресторане, Такси"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Date & Category Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="stitch-card p-4 space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              <span>Дата расхода</span>
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="stitch-card p-4 space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-amber-500" />
              <span>Категория</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.emoji} {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Amount & Currency */}
        <div className="stitch-card p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Сумма платежа
              </label>
              <input
                type="number"
                {...AMOUNT_INPUT_PROPS}
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-xl font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Валюта
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-3.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Пересчёт и качество курса. На этом экране не показывались ни тот,
              ни другой: запрос курсов уходил, но результат никуда не попадал. */}
          {group && currency !== (group.currency || 'RUB') && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  Пересчёт в валюту события
                </span>
                <span className="font-extrabold text-blue-700">
                  ≈ {formatMoney(convertedAmount, group.currency || 'RUB')}
                </span>
              </div>
              {rateDisclosure && (
                <p
                  data-testid="rate-disclosure"
                  className={`text-[11px] font-medium ${
                    isRateStale() ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {rateDisclosure}
                </p>
              )}
            </div>
          )}

        </div>

        {/* Who paid */}
        <div className="stitch-card p-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Кто оплатил?
          </label>
          <select
            value={paidById}
            onChange={(e) => setPaidById(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {(group.members || []).map((m: any) => (
              <option key={m.id} value={m.id}>
                {m.avatar || '👤'} {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Split members */}
        <div className="stitch-card p-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Между кем делить? ({selectedMembers.length})
          </label>

          <div className="space-y-2">
            {(group.members || []).map((member: any) => {
              const isSelected = selectedMembers.includes(member.id);
              const perPerson =
                selectedMembers.length > 0 ? parsedAmount / selectedMembers.length : 0;

              return (
                <div
                  key={member.id}
                  onClick={() => toggleMember(member.id)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/40'
                      : 'border-slate-200 bg-white opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center text-white text-xs ${
                        isSelected ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <span className="text-base">{member.avatar || '👤'}</span>
                    <span className="text-xs font-bold text-slate-900">{member.name}</span>
                  </div>

                  {isSelected && parsedAmount > 0 && (
                    <span className="text-xs font-extrabold text-blue-600">
                      {formatMoney(perPerson, currency)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {saveError && (
          <div role="alert" data-testid="save-error" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            {saveError}
          </div>
        )}

        {amountError && (
          <div
            role="alert"
            data-testid="amount-error"
            className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-bold"
          >
            {amountError}
          </div>
        )}

        {/* Save & Delete Action buttons */}
        <div className="space-y-3 pt-2">
          <button
            type="submit"
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98"
          >
            Сохранить изменения
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="w-full py-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-xs border border-rose-200 transition-all"
          >
            Удалить этот расход
          </button>
        </div>
      </form>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="font-extrabold text-slate-900 text-base">Подтверждение удаления</h3>
              <p className="text-xs text-slate-600 font-medium">
                Вы действительно хотите удалить расход «<span className="font-bold text-slate-900">{title}</span>» на сумму{' '}
                <span className="font-extrabold text-slate-900">{formatMoney(parsedAmount, currency)}</span>?
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md shadow-rose-500/20 transition-all"
              >
                Да, удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
