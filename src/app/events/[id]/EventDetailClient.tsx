'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import confetti from 'canvas-confetti';
import { getSavedGroups, saveGroups, getActiveSession, UserProfile } from '@/lib/supabase';
import { formatMoney } from '@/lib/currency';
import {
  ArrowLeft,
  PlusCircle,
  Scale,
  CreditCard,
  FileText,
  Share2,
  Receipt,
  CheckCircle2,
  Calendar,
  User,
  Edit2,
  UserPlus,
  X,
  Check,
  Pencil,
  Trash2,
  Phone,
  Send,
  MessageCircle,
  MessageSquare,
  Lock,
  RotateCcw,
  Sparkles,
  PieChart,
} from 'lucide-react';

export default function EventDetailClient({ groupId }: { groupId: string }) {
  const [group, setGroup] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Delete expense confirmation modal state
  const [expenseToDelete, setExpenseToDelete] = useState<any | null>(null);

  // Complete event modal state
  const [showCompleteModal, setShowCompleteModal] = useState(false);

  useEffect(() => {
    getActiveSession().then((u) => setUserProfile(u));

    const saved = getSavedGroups();
    const found = saved.find((g: any) => g.id === groupId);
    if (found) {
      setGroup(found);
      setEditedName(found.name);
    } else {
      const fallbackGroup = {
        id: groupId,
        name: 'Совместная поездка',
        category: 'trip',
        currency: 'RUB',
        status: 'active',
        createdBy: 'user-me',
        createdAt: new Date().toISOString(),
        members: [
          { id: 'm-1', name: 'Вы', avatar: '👑', role: 'owner' },
          { id: 'm-2', name: 'Максим', avatar: '👤', role: 'member' },
        ],
        expenses: [],
        settlements: [],
      };
      setGroup(fallbackGroup);
      setEditedName(fallbackGroup.name);
    }
  }, [groupId]);

  if (!group) {
    return <div className="p-4 text-xs font-bold text-slate-500 text-center">Загрузка события...</div>;
  }

  const totalExpenses = (group.expenses || []).reduce(
    (acc: number, e: any) => acc + (e.amountInGroupCurrency || e.amount || 0),
    0
  );

  const isCompleted = group.status === 'completed';

  // Category Colors and Breakdown Diagram Math
  const categoryConfig: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
    food: { label: 'Еда', color: 'bg-emerald-400', bg: 'text-emerald-300', emoji: '🍱' },
    transport: { label: 'Транспорт', color: 'bg-sky-400', bg: 'text-sky-300', emoji: '🚖' },
    lodging: { label: 'Жилье', color: 'bg-purple-400', bg: 'text-purple-300', emoji: '🏨' },
    entertainment: { label: 'Развлечения', color: 'bg-amber-400', bg: 'text-amber-300', emoji: '🎟️' },
    other: { label: 'Другое', color: 'bg-rose-400', bg: 'text-rose-300', emoji: '🛍️' },
  };

  const categoryTotals: Record<string, number> = {};
  (group.expenses || []).forEach((e: any) => {
    const cat = e.category || 'other';
    const amt = e.amountInGroupCurrency || e.amount || 0;
    categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
  });

  const categorySegments = Object.entries(categoryTotals).map(([catKey, sum]) => ({
    key: catKey,
    sum,
    percent: totalExpenses > 0 ? Math.round((sum / totalExpenses) * 100) : 0,
    config: categoryConfig[catKey] || categoryConfig['other'],
  }));

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://splitit.app';
  const inviteLink = `${origin}/events/${group.id}?join=true`;
  const inviteText = `Привет! Присоединяйся к совместным расходам "${group.name}" в SplitIT:`;

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Приглашение в SplitIT: ${group.name}`,
          text: inviteText,
          url: inviteLink,
        });
      } catch (e) {
        console.warn('Share cancelled or failed', e);
      }
    } else {
      handleCopyInviteLink();
    }
  };

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  // Contacts API Integration (Select from Phonebook)
  const handleSelectFromPhonebook = async () => {
    if ('contacts' in navigator && 'select' in (navigator as any).contacts) {
      try {
        const contacts = await (navigator as any).contacts.select(['name', 'tel'], { multiple: false });
        if (contacts && contacts.length > 0) {
          const cName = contacts[0].name?.[0] || contacts[0].tel?.[0] || 'Контакт';
          addMemberByName(cName);
        }
      } catch (err) {
        console.warn('Contacts selection cancelled or failed', err);
      }
    } else {
      alert('Выбор из телефонной книги поддерживается на Android/Chrome. Введите имя вручную ниже.');
    }
  };

  const addMemberByName = (nameStr: string) => {
    if (!nameStr.trim()) return;
    const newMember = {
      id: `m-${Date.now()}`,
      name: nameStr.trim(),
      avatar: '👤',
      role: 'member',
    };
    const updated = { ...group, members: [...group.members, newMember] };
    setGroup(updated);
    setNewMemberName('');
    setIsAddingMember(false);

    const saved = getSavedGroups();
    const idx = saved.findIndex((g: any) => g.id === group.id);
    if (idx !== -1) {
      saved[idx] = updated;
      saveGroups(saved);
    } else {
      saveGroups([updated, ...saved]);
    }
  };

  const handleSaveGroupName = () => {
    if (!editedName.trim()) return;
    const updated = { ...group, name: editedName.trim() };
    setGroup(updated);
    setIsEditingName(false);

    const saved = getSavedGroups();
    const idx = saved.findIndex((g: any) => g.id === group.id);
    if (idx !== -1) {
      saved[idx] = updated;
      saveGroups(saved);
    } else {
      saveGroups([updated, ...saved]);
    }
  };

  const handleDeleteExpenseConfirmed = () => {
    if (!expenseToDelete) return;
    const updatedExpenses = (group.expenses || []).filter((e: any) => e.id !== expenseToDelete.id);
    const updatedGroup = { ...group, expenses: updatedExpenses };
    setGroup(updatedGroup);
    setExpenseToDelete(null);

    const saved = getSavedGroups();
    const idx = saved.findIndex((g: any) => g.id === group.id);
    if (idx !== -1) {
      saved[idx] = updatedGroup;
      saveGroups(saved);
    }
  };

  const handleToggleCompleteEvent = (targetStatus: 'completed' | 'active') => {
    const updatedGroup = { ...group, status: targetStatus };
    setGroup(updatedGroup);
    setShowCompleteModal(false);

    const saved = getSavedGroups();
    const idx = saved.findIndex((g: any) => g.id === group.id);
    if (idx !== -1) {
      saved[idx] = updatedGroup;
      saveGroups(saved);
    }

    if (targetStatus === 'completed') {
      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch (e) {
        console.warn('Confetti not available', e);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1 pb-24">
      {/* Header Nav */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        
        {isEditingName ? (
          <div className="flex items-center gap-1.5 flex-1 max-w-[200px] mx-2">
            <input
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              className="w-full px-2 py-1 text-xs font-bold border border-blue-400 rounded-lg focus:outline-none"
            />
            <button
              onClick={handleSaveGroupName}
              className="p-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="text-center flex items-center gap-1.5 cursor-pointer" onClick={() => setIsEditingName(true)}>
            <h2 className="font-extrabold text-slate-900 text-base">{group.name}</h2>
            <Edit2 className="w-3.5 h-3.5 text-slate-400 hover:text-blue-600" />
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInviteModal(true)}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs"
            title="Пригласить участников"
          >
            <Share2 className="w-5 h-5 text-blue-600" />
          </button>
        </div>
      </div>

      {/* Completed Status Verification Banner */}
      {isCompleted && (
        <div className="stitch-card p-4 bg-emerald-500 text-white space-y-2 shadow-lg border-emerald-400">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-100" />
              <span className="font-extrabold text-sm">Событие и взаиморасчеты завершены!</span>
            </div>
            <button
              onClick={() => handleToggleCompleteEvent('active')}
              className="text-[10px] font-bold bg-white/20 hover:bg-white/30 px-2.5 py-1 rounded-lg flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Возобновить</span>
            </button>
          </div>
          <p className="text-xs text-emerald-100 font-medium">
            Все долги между участниками полностью рассчитаны и закрыты в 0 ₽.
          </p>
        </div>
      )}

      {/* Main Group Summary Card with Category Breakdown Chart Diagram */}
      <div className="stitch-card p-5 bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white shadow-xl relative overflow-hidden space-y-4 border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                Общие расходы события
              </span>
              <span
                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                  isCompleted ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' : 'bg-blue-500/30 text-blue-200 border border-blue-400/30'
                }`}
              >
                {isCompleted ? 'Завершено ✅' : 'Активное 🟢'}
              </span>
            </div>
            <h3 className="text-3xl font-extrabold mt-1">
              {formatMoney(totalExpenses, group.currency || 'RUB')}
            </h3>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white">
            <PieChart className="w-6 h-6 text-blue-400" />
          </div>
        </div>

        {/* Dynamic Category Breakdown Progress Bar Diagram */}
        {totalExpenses > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
              <span>Диаграмма категорий</span>
              <span>{categorySegments.length} кат.</span>
            </div>

            {/* Segmented Color Bar */}
            <div className="h-3 w-full rounded-full bg-slate-800/80 overflow-hidden flex shadow-inner border border-white/10">
              {categorySegments.map((seg) => (
                <div
                  key={seg.key}
                  style={{ width: `${seg.percent}%` }}
                  className={`h-full ${seg.config.color} transition-all duration-500`}
                  title={`${seg.config.label}: ${seg.percent}% (${formatMoney(seg.sum, group.currency)})`}
                />
              ))}
            </div>

            {/* Category Legend Badges */}
            <div className="flex items-center gap-2 overflow-x-auto pt-1 no-scrollbar text-[11px]">
              {categorySegments.map((seg) => (
                <div
                  key={seg.key}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 whitespace-nowrap"
                >
                  <span className={`w-2 h-2 rounded-full ${seg.config.color}`} />
                  <span className="font-medium text-slate-200">
                    {seg.config.emoji} {seg.config.label}
                  </span>
                  <span className="font-extrabold text-white">{seg.percent}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons Grid */}
        <div className="grid grid-cols-4 gap-2 pt-3 border-t border-white/10">
          <Link
            href={`/events/${group.id}/expense/new`}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <PlusCircle className="w-5 h-5 text-blue-400" />
            <span className="text-[10px] font-bold">Расход</span>
          </Link>

          <Link
            href={`/events/${group.id}/balance`}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <Scale className="w-5 h-5 text-emerald-400" />
            <span className="text-[10px] font-bold">Баланс</span>
          </Link>

          <Link
            href={`/events/${group.id}/settle`}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <CreditCard className="w-5 h-5 text-amber-400" />
            <span className="text-[10px] font-bold">Расчет</span>
          </Link>

          <Link
            href={`/events/${group.id}/export`}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <FileText className="w-5 h-5 text-purple-400" />
            <span className="text-[10px] font-bold">Отчет</span>
          </Link>
        </div>

        {/* Complete Event Footer Button */}
        {!isCompleted && (
          <div className="pt-2">
            <button
              onClick={() => setShowCompleteModal(true)}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs border border-emerald-400/40 flex items-center justify-center gap-2 shadow-md transition-all active:scale-98"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Завершить событие и итоговый расчет</span>
            </button>
          </div>
        )}
      </div>

      {/* Group Members Bar */}
      <div className="stitch-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Участники ({group.members?.length || 0})
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectFromPhonebook}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100"
              title="Выбрать из телефонной книги"
            >
              <Phone className="w-3 h-3" />
              <span>Контакты</span>
            </button>
            <button
              onClick={() => setIsAddingMember(true)}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100"
            >
              <UserPlus className="w-3 h-3" />
              <span>Добавить</span>
            </button>
          </div>
        </div>

        {isAddingMember && (
          <div className="flex items-center gap-2 pt-1 pb-2">
            <input
              type="text"
              placeholder="Имя нового участника..."
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none"
            />
            <button
              onClick={() => addMemberByName(newMemberName)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold"
            >
              ОК
            </button>
            <button onClick={() => setIsAddingMember(false)} className="text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {(group.members || []).map((m: any) => (
            <div
              key={m.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 flex-shrink-0"
            >
              <span className="text-base">{m.avatar || '👤'}</span>
              <span className="text-xs font-semibold text-slate-800">{m.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Expenses Feed */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-slate-900 text-sm">
            Лента транзакций ({(group.expenses || []).length})
          </h4>
          <Link
            href={`/events/${group.id}/expense/new`}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Добавить</span>
          </Link>
        </div>

        {(group.expenses || []).length === 0 ? (
          <div className="stitch-card p-6 text-center text-slate-500 text-xs">
            Транзакции пока не добавлены. Нажмите «Добавить», чтобы зафиксировать первый расход!
          </div>
        ) : (
          <div className="space-y-3">
            {(group.expenses || []).map((expense: any) => {
              const paidByMember =
                (group.members || []).find((m: any) => m.id === expense.paidById) || group.members[0];

              return (
                <div key={expense.id} className="stitch-card p-4 space-y-3 group hover:border-blue-300 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 font-bold">
                        {paidByMember?.avatar || '👤'}
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-900 text-sm">{expense.title}</h5>
                        <p className="text-xs text-slate-500 font-medium">
                          Оплатил(а){' '}
                          <span className="font-bold text-slate-800">{paidByMember?.name || 'Участник'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="text-right">
                        <span className="block font-extrabold text-slate-900 text-base">
                          {formatMoney(expense.amount, expense.currency || group.currency)}
                        </span>
                        {expense.currency !== group.currency && (
                          <span className="text-[10px] text-slate-400 font-semibold">
                            ≈ {formatMoney(expense.amountInGroupCurrency, group.currency)}
                          </span>
                        )}
                      </div>

                      {/* Edit & Delete quick action buttons */}
                      <div className="flex items-center gap-1 pl-1 border-l border-slate-100">
                        <Link
                          href={`/events/${group.id}/expense/${expense.id}/edit`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                          title="Редактировать расход"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => setExpenseToDelete(expense)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                          title="Удалить расход"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Splits breakdown */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 font-semibold text-[10px] uppercase">
                        {expense.splitType === 'equal' ? 'Поровну' : 'Доли'}
                      </span>
                      <span>• {(expense.splits || []).length} участников</span>
                    </div>

                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {new Date(expense.createdAt || Date.now()).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Expense Modal */}
      {expenseToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="font-extrabold text-slate-900 text-base">Удаление расхода</h3>
              <p className="text-xs text-slate-600 font-medium">
                Удалить «<span className="font-bold text-slate-900">{expenseToDelete.title}</span>» на сумму{' '}
                <span className="font-extrabold text-slate-900">{formatMoney(expenseToDelete.amount, expenseToDelete.currency)}</span>?
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setExpenseToDelete(null)}
                className="py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteExpenseConfirmed}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md shadow-rose-500/20 transition-all"
              >
                Да, удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Event Confirmation Modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="font-extrabold text-slate-900 text-base">Завершить событие?</h3>
              <p className="text-xs text-slate-600 font-medium">
                Все взаиморасчеты будут зафиксированы как выровненные в 0 ₽. Статус события изменится на «Завершено».
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => handleToggleCompleteEvent('completed')}
                className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md shadow-emerald-500/20 transition-all"
              >
                Завершить расчет
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal (Telegram, WhatsApp, SMS, Web Share API, Contacts) */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900 text-base">Пригласить участников</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 font-medium">
              Отправьте приглашение друзьями в удобном мессенджере или добавьте из телефонной книги:
            </p>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <a
                href={`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(inviteText)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100 font-bold text-xs transition-all"
              >
                <Send className="w-4 h-4 text-sky-600" />
                <span>Telegram</span>
              </a>

              <a
                href={`https://wa.me/?text=${encodeURIComponent(inviteText + ' ' + inviteLink)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-bold text-xs transition-all"
              >
                <MessageCircle className="w-4 h-4 text-emerald-600" />
                <span>WhatsApp</span>
              </a>

              <a
                href={`sms:?body=${encodeURIComponent(inviteText + ' ' + inviteLink)}`}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 font-bold text-xs transition-all"
              >
                <MessageSquare className="w-4 h-4 text-purple-600" />
                <span>SMS</span>
              </a>

              <button
                onClick={handleNativeShare}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 font-bold text-xs transition-all"
              >
                <Share2 className="w-4 h-4 text-blue-600" />
                <span>Системный</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <button
                onClick={handleSelectFromPhonebook}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md shadow-indigo-500/20 transition-all"
              >
                <Phone className="w-4 h-4" />
                <span>Выбрать из телефонной книги</span>
              </button>
            </div>

            {copiedInvite && (
              <p className="text-[11px] font-bold text-center text-emerald-600 bg-emerald-50 p-2 rounded-lg">
                Ссылка скопирована в буфер обмена!
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
