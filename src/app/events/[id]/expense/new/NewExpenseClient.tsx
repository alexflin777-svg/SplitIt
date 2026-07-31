'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Camera, Upload, Sparkles, Check, Globe, RefreshCw, UserCheck, Calendar, DollarSign, Tag } from 'lucide-react';
import { CURRENCIES, convertCurrency, formatMoney } from '@/lib/currency';
import { parseReceiptImage } from '@/lib/ocr';
import { getSavedGroups, saveGroups } from '@/lib/supabase';

export default function NewExpenseClient({ groupId }: { groupId: string }) {
  const router = useRouter();

  const [group, setGroup] = useState<any>(() => {
    const saved = getSavedGroups();
    const found = saved.find((g: any) => g.id === groupId);
    if (found) return found;
    return {
      id: groupId,
      name: 'Совместная поездка',
      currency: 'RUB',
      members: [
        { id: 'm-1', name: 'Анастасия', avatar: '👑' },
        { id: 'm-2', name: 'Максим', avatar: '👤' },
      ],
      expenses: [],
    };
  });

  const todayStr = new Date().toISOString().split('T')[0];

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(group?.currency || 'RUB');
  const [date, setDate] = useState(todayStr);
  const [category, setCategory] = useState<'food' | 'transport' | 'lodging' | 'entertainment' | 'other'>('food');
  const [paidById, setPaidById] = useState(group?.members?.[0]?.id || 'user-me');
  const [selectedMembers, setSelectedMembers] = useState<string[]>((group?.members || []).map((m: any) => m.id));

  // OCR state
  const [isScanning, setIsScanning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSavedGroups();
    const found = saved.find((g: any) => g.id === groupId);
    if (found) {
      setGroup(found);
      setCurrency(found.currency || 'RUB');
      setPaidById(found.members?.[0]?.id || 'user-me');
      setSelectedMembers((found.members || []).map((m: any) => m.id));
    }
  }, [groupId]);

  const parsedAmount = parseFloat(amount) || 0;
  const { convertedAmount } = convertCurrency(parsedAmount, currency, group?.currency || 'RUB');

  const categories = [
    { id: 'food', label: 'Еда & Рестораны', emoji: '🍱' },
    { id: 'transport', label: 'Транспорт & Такси', emoji: '🚖' },
    { id: 'lodging', label: 'Жилье & Отель', emoji: '🏨' },
    { id: 'entertainment', label: 'Развлечения', emoji: '🎟️' },
    { id: 'other', label: 'Другое', emoji: '🛍️' },
  ];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setOcrStatus('Сканирование чека с помощью Tesseract OCR...');

    try {
      const result = await parseReceiptImage(file);
      setIsScanning(false);

      if (result.suggestedTotal) {
        setAmount(result.suggestedTotal.toString());
        setOcrStatus(`Сумма ${result.suggestedTotal} ${currency} распознана из чека!`);
      }
      if (result.suggestedTitle) {
        setTitle(result.suggestedTitle);
      }
    } catch (err) {
      setIsScanning(false);
      setOcrStatus('Ошибка распознавания. Введите данные вручную.');
    }
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !parsedAmount) return;

    const perPerson = selectedMembers.length > 0 ? convertedAmount / selectedMembers.length : 0;
    const newExpense = {
      id: 'exp-' + Date.now(),
      groupId: group.id,
      paidById: paidById || group.members?.[0]?.id || 'user-me',
      title,
      amount: parsedAmount,
      currency,
      amountInGroupCurrency: convertedAmount,
      category,
      splitType: 'equal',
      splits: selectedMembers.map((mId) => ({ userId: mId, amountOwed: perPerson })),
      createdAt: date || new Date().toISOString(),
    };

    const updatedGroup = {
      ...group,
      expenses: [newExpense, ...(group.expenses || [])],
    };

    // Save persistent
    const saved = getSavedGroups();
    const idx = saved.findIndex((g: any) => g.id === group.id);
    if (idx !== -1) {
      saved[idx] = updatedGroup;
      saveGroups(saved);
    } else {
      saveGroups([updatedGroup, ...saved]);
    }

    router.push(`/events/${group.id}`);
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link
          href={`/events/${group?.id || ''}`}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 text-base">Добавление расхода</h2>
        <div className="w-9" />
      </div>

      {/* AI Receipt OCR Scanner Box */}
      <div className="stitch-card p-4 bg-gradient-to-br from-indigo-50 via-blue-50 to-indigo-100 border-blue-200 space-y-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
            <Sparkles className="w-4 h-4 text-indigo-600 animate-pulse" />
            <span>AI Сканер чека (Tesseract OCR)</span>
          </div>
          <span className="text-[10px] bg-indigo-600 text-white font-extrabold px-2.5 py-0.5 rounded-full shadow-xs">
            Умный ввод
          </span>
        </div>

        <label className="flex items-center justify-center gap-2.5 p-3.5 rounded-xl bg-white border-2 border-dashed border-indigo-300 text-indigo-700 text-xs font-bold cursor-pointer hover:bg-indigo-50/70 transition-all shadow-xs">
          <Camera className="w-4 h-4 text-indigo-600" />
          <span>{isScanning ? 'Идет сканирование...' : 'Загрузить / Сфотографировать чек'}</span>
          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
        </label>

        {ocrStatus && (
          <p className="text-[11px] font-semibold text-indigo-900 bg-white/90 p-2.5 rounded-lg text-center shadow-xs border border-indigo-100">
            {ocrStatus}
          </p>
        )}
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
            placeholder="Например: Ужин в ресторане, Такси в отель"
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

          {/* Category Selector */}
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

        {/* Amount & Multi-Currency */}
        <div className="stitch-card p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Сумма платежа
              </label>
              <input
                type="number"
                step="any"
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

          {/* Currency conversion notice */}
          {currency !== group?.currency && parsedAmount > 0 && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <Globe className="w-4 h-4 text-blue-600" />
                <span>Пересчет в валюту группы:</span>
              </div>
              <span className="font-extrabold text-blue-700">
                ≈ {formatMoney(convertedAmount, group?.currency || 'RUB')}
              </span>
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
            Между кем делить? ({selectedMembers.length})
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

        {/* Save button */}
        <button
          type="submit"
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98"
        >
          Сохранить расход ({date})
        </button>
      </form>
    </div>
  );
}
