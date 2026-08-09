'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Camera, Upload, Sparkles, Check, Globe, RefreshCw, UserCheck, Calendar, DollarSign, Tag } from 'lucide-react';
import { CURRENCIES, convertCurrency, formatMoney, fetchLiveExchangeRates, getRateDisclosureContext, isRateStale } from '@/lib/currency';
import { parseReceiptImage } from '@/lib/ocr';
import { getGroup, addExpense } from '@/lib/store';
import { routes } from '@/lib/routes';
import { parseAmount, AMOUNT_INPUT_PROPS } from '@/lib/money';
import { useI18n } from '@/lib/i18n/provider';

export default function NewExpenseClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { t } = useI18n();

  const [group, setGroup] = useState<any>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [currency, setCurrency] = useState(group?.currency || 'RUB');
  const [date, setDate] = useState(todayStr);
  const [category, setCategory] = useState<'food' | 'transport' | 'lodging' | 'entertainment' | 'other'>('food');
  const [paidById, setPaidById] = useState(group?.members?.[0]?.id || 'user-me');
  const [selectedMembers, setSelectedMembers] = useState<string[]>((group?.members || []).map((m: any) => m.id));

  // OCR state
  const [isScanning, setIsScanning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [ocrFailed, setOcrFailed] = useState(false);

  // Живые курсы не загружались на этом экране вовсе — пересчёт шёл по
  // резервным значениям из кода, и пользователю об этом не сообщали.
  const [ratesLoaded, setRatesLoaded] = useState(false);

  useEffect(() => {
    fetchLiveExchangeRates().finally(() => setRatesLoaded(true));
  }, []);

  useEffect(() => {
    void getGroup(groupId).then(({ data }) => {
      if (!data) return;
      setGroup(data);
      setCurrency(data.currency || 'RUB');
      setPaidById(data.members?.[0]?.id || '');
      setSelectedMembers((data.members || []).map((m: any) => m.id));
    });
  }, [groupId]);

  const parsedAmount = parseAmount(amount).value || 0;
  const { convertedAmount } = convertCurrency(parsedAmount, currency, group?.currency || 'RUB');
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setOcrFailed(false);
    setOcrStatus(t('expenseNew.ocrScanningMsg'));

    // parseReceiptImage не бросает: исход возвращается полем status. Раньше
    // сбой приходил сюда замаскированным под обычный результат, статус не
    // обновлялся, и на экране навсегда оставалось «Сканирование чека…».
    const { status, result, message } = await parseReceiptImage(file);
    setIsScanning(false);
    e.target.value = '';

    if (status !== 'ok' || !result) {
      setOcrFailed(true);
      setOcrStatus(message);
      return;
    }

    if (result.suggestedTotal !== null) {
      setAmount(result.suggestedTotal.toString());
    }
    if (result.suggestedTitle) {
      setTitle(result.suggestedTitle);
    }
    setOcrStatus(
      result.suggestedTotal !== null
        ? t('expenseNew.ocrSuccessMsg', { total: result.suggestedTotal, currency })
        : t('expenseNew.ocrNoAmountMsg')
    );
  };

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

    const perPerson = selectedMembers.length > 0 ? convertedAmount / selectedMembers.length : 0;

    setIsSaving(true);
    const { error: saveProblem } = await addExpense(group.id, {
      title,
      amount: validAmount,
      currency,
      amountInGroupCurrency: convertedAmount,
      category,
      paidById: paidById || group.members?.[0]?.id || '',
      splits: selectedMembers.map((mId) => ({ userId: mId, amountOwed: perPerson })),
      createdAt: date ? new Date(date).toISOString() : new Date().toISOString(),
    });
    setIsSaving(false);

    if (saveProblem) {
      setSaveError(saveProblem);
      return;
    }
    router.push(routes.eventDetail(group.id));
  };

  if (!group) {
    return <div className="p-4 text-xs font-bold text-slate-500 text-center">{t('expenseNew.loadingEvent')}</div>;
  }

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link
          href={routes.eventDetail(group?.id ?? '')}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 text-base">{t('expenseNew.pageTitle')}</h2>
        <div className="w-9" />
      </div>

      {/* AI Receipt OCR Scanner Box */}
      <div className="stitch-card p-4 bg-gradient-to-br from-indigo-50 via-blue-50 to-indigo-100 border-blue-200 space-y-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
            <Sparkles className="w-4 h-4 text-indigo-600 animate-pulse" />
            <span>{t('expenseNew.scannerTitle')}</span>
          </div>
          <span className="text-[10px] bg-indigo-600 text-white font-extrabold px-2.5 py-0.5 rounded-full shadow-xs">
            {t('expenseNew.smartInput')}
          </span>
        </div>

        <label className="flex items-center justify-center gap-2.5 p-3.5 rounded-xl bg-white border-2 border-dashed border-indigo-300 text-indigo-700 text-xs font-bold cursor-pointer hover:bg-indigo-50/70 transition-all shadow-xs">
          <Camera className="w-4 h-4 text-indigo-600" />
          <span>{isScanning ? t('expenseNew.scanLoading') : t('expenseNew.uploadPrompt')}</span>
          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
        </label>

        {ocrStatus && (
          <p
            role={ocrFailed ? 'alert' : 'status'}
            data-testid="ocr-status"
            className={`text-[11px] font-semibold p-2.5 rounded-lg text-center shadow-xs border ${
              ocrFailed
                ? 'text-rose-800 bg-rose-50 border-rose-200'
                : 'text-indigo-900 bg-white/90 border-indigo-100'
            }`}
          >
            {ocrStatus}
          </p>
        )}
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
            placeholder={t('expenseNew.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Date & Category Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Date Picker Field */}
          <div className="stitch-card p-4 space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              <span>{t('expenseNew.dateLabel')}</span>
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          {/* Category Selector */}
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

        {/* Amount & Multi-Currency */}
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

          {/* Currency conversion notice */}
          {currency !== group?.currency && parsedAmount > 0 && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <Globe className="w-4 h-4 text-blue-600" />
                <span>{t('expenseNew.conversionNotice')}</span>
              </div>
              <span className="font-extrabold text-blue-700">
                ≈ {formatMoney(convertedAmount, group?.currency || 'RUB')}
              </span>
            </div>
          )}

          {/* Качество курса больше не скрыто: раньше getExchangeRateStatus()
              не вызывался ни в одном файле интерфейса. */}
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
            {(group?.members || []).map((m: any) => (
              <option key={m.id} value={m.id}>
                {m.avatar || '👤'} {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Split options */}
        <div className="stitch-card p-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('expenseNew.splitLabel', { count: selectedMembers.length })}
          </label>

          <div className="space-y-2">
            {(group?.members || []).map((member: any) => {
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
          <div
            role="alert"
            data-testid="save-error"
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold"
          >
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

        {/* Save button */}
        <button
          type="submit"
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98"
        >
          {t('expenseNew.saveButton', { date: new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })}
        </button>
      </form>
    </div>
  );
}
