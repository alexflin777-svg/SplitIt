'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Calendar, Tag, Trash2 } from 'lucide-react';
import { CURRENCIES, convertCurrency, formatMoney, fetchLiveExchangeRates, getRateDisclosureContext, isRateStale } from '@/lib/currency';
import { getGroup, updateExpense, deleteExpense } from '@/lib/store';
import { routes } from '@/lib/routes';
import { parseAmount, AMOUNT_INPUT_PROPS, splitEvenly } from '@/lib/money';
import { rescaleSplits, resolveSplitMode, sameTotal, type Split, type SplitMode } from '@/lib/split-rescale';
import { useI18n } from '@/lib/i18n/provider';

export default function EditExpenseClient({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const router = useRouter();
  const { t } = useI18n();

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
  // Доли из базы и как они были получены. Раньше экран забирал только id
  // участников и при сохранении делил поровну — неравные доли терялись (P1-16).
  const [originalSplits, setOriginalSplits] = useState<Split[]>([]);
  const [originalMode, setOriginalMode] = useState<SplitMode>('equal');
  // «Поровну» включается только явным действием пользователя, если расход
  // был поделён иначе.
  const [equalMode, setEqualMode] = useState(true);

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
        const splits: Split[] = (foundExp.splits || []).map((s: any) => ({ userId: s.userId, amountOwed: Number(s.amountOwed) }));
        const mode = resolveSplitMode({ ...foundExp, splits });
        setOriginalSplits(splits);
        setOriginalMode(mode);
        setEqualMode(mode === 'equal');
        setSelectedMembers(splits.map((s) => s.userId));
      }
    }
    });
  }, [groupId, expenseId]);

  if (!group || !expense) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-sm font-bold text-slate-500">{t('expenseEdit.loading')}</p>
        <Link href={routes.eventDetail(groupId)} className="text-xs font-bold text-blue-600 underline">
          {t('expenseEdit.backToEvent')}
        </Link>
      </div>
    );
  }

  const parsedAmount = parseAmount(amount).value || 0;
  const groupCurrency = group.currency || 'RUB';
  // Сумма и валюта не менялись — берём сохранённый пересчёт, а не свежий курс:
  // иначе при валютном расходе итог «сам» сдвигался бы при каждом сохранении.
  const amountUnchanged =
    parsedAmount === Number(expense.amount) &&
    currency === (expense.currency || groupCurrency) &&
    Number.isFinite(Number(expense.amountInGroupCurrency));
  const convertedAmount = amountUnchanged
    ? Number(expense.amountInGroupCurrency)
    : convertCurrency(parsedAmount, currency, groupCurrency).convertedAmount;
  const originalIds = originalSplits.map((s) => s.userId);
  const membersUnchanged =
    selectedMembers.length === originalIds.length && selectedMembers.every((id) => originalIds.includes(id));

  // Доли, которые будут сохранены, — их же показывает список ниже.
  let plannedSplits: Split[] | null;
  let rescaled = false;
  if (!equalMode) {
    if (sameTotal(originalSplits, convertedAmount)) {
      plannedSplits = originalSplits;
    } else {
      plannedSplits = rescaleSplits(originalSplits, convertedAmount);
      rescaled = true;
    }
  } else if (originalMode === 'equal' && membersUnchanged && sameTotal(originalSplits, convertedAmount)) {
    // Ничего не менялось — сохраняем как было, не перераспределяя копейку остатка.
    plannedSplits = originalSplits;
  } else {
    // Порядок по id: лишняя копейка должна доставаться одному и тому же
    // участнику на всех устройствах (порядок долей из PostgREST не гарантирован).
    const ordered = [...selectedMembers].sort();
    const shares = splitEvenly(convertedAmount, ordered.length);
    plannedSplits = ordered.map((userId, i) => ({ userId, amountOwed: shares[i] }));
  }
  const plannedSplitMode: SplitMode = equalMode ? 'equal' : originalMode;
  const shareById = new Map((plannedSplits ?? []).map((s) => [s.userId, s.amountOwed]));
  const originalShareById = new Map(originalSplits.map((s) => [s.userId, s.amountOwed]));
  const knownIds = new Set((group.members || []).map((m: any) => m.id));
  const splitRows: Array<{ id: string; name: string; avatar: string }> = [
    ...(group.members || []).map((m: any) => ({ id: m.id, name: m.name, avatar: m.avatar || '👤' })),
    // Доля участника, которого уже нет в событии, не должна пропасть молча.
    ...originalIds
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ id, name: t('expenseEdit.unknownMember'), avatar: '👤' })),
  ];
  const rateDisclosureCtx = ratesLoaded
    ? getRateDisclosureContext(currency, group?.currency || 'RUB')
    : null;

  const categories = [
    { id: 'food', label: t('expenseNew.cat.food'), emoji: '🍱' },
    { id: 'transport', label: t('expenseNew.cat.transport'), emoji: '🚖' },
    { id: 'lodging', label: t('expenseNew.cat.lodging'), emoji: '🏨' },
    { id: 'entertainment', label: t('expenseNew.cat.entertainment'), emoji: '🎟️' },
    { id: 'other', label: t('expenseNew.cat.other'), emoji: '🛍️' },
  ];

  const toggleMember = (id: string) => {
    // Неравные доли: состав меняется только после явного «Поделить поровну».
    if (!equalMode) return;
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
      setAmountError(t('expenseNew.titleError'));
      return;
    }

    // Раньше здесь стояло `if (!parsedAmount) return` — отрицательное число
    // truthy, поэтому расход на минус спокойно сохранялся.
    const { value: validAmount, error: amountProblem } = parseAmount(amount);
    if (amountProblem || validAmount === null) {
      setAmountError(amountProblem);
      return;
    }

    if (!plannedSplits || plannedSplits.length === 0) {
      setAmountError(t('expenseEdit.rescaleError'));
      return;
    }

    setIsSaving(true);
    const { error: saveProblem } = await updateExpense(group.id, expenseId, {
      title,
      amount: validAmount,
      currency,
      amountInGroupCurrency: convertedAmount,
      category,
      paidById,
      splits: plannedSplits,
      splitMode: plannedSplitMode,
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
        <h2 className="font-extrabold text-slate-900 text-base">{t('expenseEdit.pageTitle')}</h2>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition-all shadow-xs"
          title={t('expenseEdit.deleteExpenseTitle')}
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* Title Card */}
        <div className="stitch-card p-5 space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('expenseNew.titleLabel')}
          </label>
          <input
            type="text"
            required
            placeholder={t('expenseEdit.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Date & Category Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="stitch-card p-4 space-y-1.5 min-w-0">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              <span>{t('expenseNew.dateLabel')}</span>
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="expense-date"
              className="block w-full min-w-0 h-10 appearance-none text-left px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="stitch-card p-4 space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-amber-500" />
              <span>{t('expenseNew.categoryLabel')}</span>
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
                {t('expenseNew.amountLabel')}
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
                {t('expenseNew.currencyLabel')}
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
                  {t('expenseEdit.conversionNotice')}
                </span>
                <span className="font-extrabold text-blue-700">
                  ≈ {formatMoney(convertedAmount, group.currency || 'RUB')}
                </span>
              </div>
              {rateDisclosureCtx && (
                <p
                  data-testid="rate-disclosure"
                  className={`text-[11px] font-medium ${
                    isRateStale() ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t(rateDisclosureCtx.key, rateDisclosureCtx.params)}
                </p>
              )}
            </div>
          )}

        </div>

        {/* Who paid */}
        <div className="stitch-card p-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('expenseNew.paidByLabel')}
          </label>
          <select
            value={paidById}
            onChange={(e) => setPaidById(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {(group.members || []).map((m: any) => (
              <option key={m.id} value={m.id}>
                <span className="truncate max-w-[150px] inline-block align-bottom">{m.avatar || '👤'} {m.name}</span>
              </option>
            ))}
          </select>
        </div>

        {/* Split members */}
        <div className="stitch-card p-5 space-y-3" data-testid="split-section">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {equalMode ? t('expenseNew.splitLabel', { count: selectedMembers.length }) : t('expenseEdit.splitsTitle')}
            </label>
            <span
              data-testid="split-mode-badge"
              data-mode={plannedSplitMode}
              className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 font-semibold text-[10px] uppercase text-slate-600 dark:text-slate-300"
            >
              {t(`expenseEdit.mode.${plannedSplitMode}`)}
            </span>
          </div>

          {!equalMode && (
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('expenseEdit.keepSplitsHint')}</p>
          )}
          {!equalMode && rescaled && plannedSplits && (
            <p
              role="status"
              data-testid="split-rescaled-notice"
              className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-300"
            >
              {t('expenseEdit.rescaledNotice')}
            </p>
          )}

          <div className="space-y-2">
            {splitRows.map((member) => {
              const isSelected = equalMode ? selectedMembers.includes(member.id) : shareById.has(member.id);
              const share = shareById.get(member.id);
              const before = originalShareById.get(member.id);

              return (
                <div
                  key={member.id}
                  data-testid="split-row"
                  data-member-id={member.id}
                  onClick={() => toggleMember(member.id)}
                  aria-disabled={!equalMode}
                  className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                    equalMode ? 'cursor-pointer' : 'cursor-default'
                  } ${isSelected ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200 bg-white opacity-60'}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-white text-xs ${
                        isSelected ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <span className="text-base">{member.avatar}</span>
                    <span className="text-xs font-bold text-slate-900 min-w-0 truncate max-w-xs">{member.name}</span>
                  </div>

                  {isSelected && share !== undefined && (
                    <span className="flex items-baseline gap-1.5 shrink-0">
                      {rescaled && before !== undefined && before !== share && (
                        <s className="text-[10px] font-semibold text-slate-400">{formatMoney(before, groupCurrency)}</s>
                      )}
                      <span data-testid="split-share" className="text-xs font-extrabold text-blue-600">
                        {formatMoney(share, groupCurrency)}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {originalMode !== 'equal' && (
            <button
              type="button"
              data-testid={equalMode ? 'split-restore-action' : 'split-equal-action'}
              onClick={() => {
                if (equalMode) {
                  setSelectedMembers(originalIds);
                  setEqualMode(false);
                } else {
                  setEqualMode(true);
                }
              }}
              className="w-full py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all"
            >
              {equalMode ? t('expenseEdit.restoreSplitsAction') : t('expenseEdit.splitEqualAction')}
            </button>
          )}
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
            {t('expenseEdit.saveChangesButton')}
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="w-full py-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-xs border border-rose-200 transition-all"
          >
            {t('expenseEdit.deleteThisExpenseButton')}
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
              <h3 className="font-extrabold text-slate-900 text-base">{t('expenseEdit.deleteConfirmTitle')}</h3>
              <p className="text-xs text-slate-600 font-medium">
                {t('expenseEdit.deleteConfirmBody', { title, amount: formatMoney(parsedAmount, currency) })}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                {t('eventDetail.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md shadow-rose-500/20 transition-all"
              >
                {t('eventDetail.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
