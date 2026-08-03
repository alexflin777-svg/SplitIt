'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import confetti from 'canvas-confetti';
import { getActiveSession, getSavedFriends, getSavedGroups, saveGroups, UserProfile } from '@/lib/supabase';
import {
  getGroup,
  renameGroup,
  setGroupStatus,
  deleteExpense as deleteExpenseFromStore,
  deleteGroup,
  createInvite,
  subscribeToGroup,
  isMultiUser,
} from '@/lib/store';
import { formatMoney } from '@/lib/currency';
import {
  ArrowLeft,
  PlusCircle,
  Scale,
  CreditCard,
  FileText,
  Share2,
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
  RotateCcw,
  Sparkles,
  PieChart,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { routes, absoluteInviteLink, hasPublicInviteOrigin } from '@/lib/routes';
import { getConfigProblem } from '@/lib/env';

/**
 * Экран «события нет на этом устройстве».
 *
 * Возникает, когда ссылку прислали с чужого телефона. Без подключённого
 * бэкенда подтянуть чужую группу неоткуда, и честнее сказать это прямо, чем
 * показать выдуманное событие.
 */
function EventNotFound({ groupId }: { groupId: string }) {
  const configProblem = getConfigProblem();

  return (
    <div className="max-w-md mx-auto px-1 pb-24 pt-6">
      <div role="alert" className="stitch-card p-6 text-center space-y-3 bg-white dark:bg-slate-800">
        <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">Событие недоступно</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          События <code className="font-mono text-xs">{groupId}</code> нет на этом устройстве.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {configProblem
            ? 'Приложение работает локально: события хранятся на том устройстве, где были созданы, и по ссылке не передаются. Совместный доступ появится, когда будет подключён бэкенд.'
            : 'Возможно, приглашение отозвано или у вас нет доступа к этому событию. Попросите владельца прислать ссылку заново.'}
        </p>
        <Link
          href={routes.home()}
          className="inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all duration-300 hover:bg-blue-700"
        >
          К списку событий
        </Link>
      </div>
    </div>
  );
}

export default function EventDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [group, setGroup] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'not-found'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Modals state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPhonebookModal, setShowPhonebookModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<any | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showDeleteEventModal, setShowDeleteEventModal] = useState(false);

  // Phonebook manual entry
  const [contactNameInput, setContactNameInput] = useState('');
  const [contactPhoneInput, setContactPhoneInput] = useState('');

  const savedFriends = getSavedFriends();

  /**
   * Загрузка события.
   *
   * Раньше отсутствующее событие не считалось ошибкой: функция сочиняла
   * «Совместную поездку» с двумя вымышленными участниками и сохраняла её
   * под настоящим id. Перейдя по приглашению, человек видел пустышку вместо
   * группы владельца — и занятый id, из-за которого настоящая группа уже не
   * могла подгрузиться. Ничего не сочиняем: событие либо есть, либо его нет.
   */
  const loadGroup = useCallback(async () => {
    // Источник данных выбирает фасад: Supabase, когда бэкенд подключён, иначе
    // localStorage. Экран про это не знает и не должен знать.
    const { data, error } = await getGroup(groupId);

    if (error || !data) {
      setGroup(null);
      setLoadError(error);
      setStatus('not-found');
      return;
    }

    setGroup(data);
    setEditedName(data.name);
    setStatus('ok');
    getActiveSession().then(setUserProfile);
  }, [groupId]);

  useEffect(() => {
    loadGroup();
    const unsubscribe = subscribeToGroup(groupId, loadGroup);
    return () => unsubscribe();
  }, [groupId, loadGroup]);

  if (status === 'loading') {
    return <div className="p-4 text-xs font-bold text-slate-500 text-center">Загрузка события...</div>;
  }

  if (status === 'not-found' || !group) {
    return <EventNotFound groupId={groupId} />;
  }

  const totalExpenses = (group.expenses || []).reduce(
    (acc: number, e: any) => acc + (e.amountInGroupCurrency || e.amount || 0),
    0
  );

  const isCompleted = group.status === 'completed';
  const isCurrentUserMember =
    !!userProfile && (group.members || []).some((m: any) => m.id === userProfile.id);

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
  const inviteText = `Привет! Присоединяйся к совместным расходам "${group.name}" в SplitIT:`;

  /**
   * Ссылка выдаётся базой: одноразовый код с сроком жизни. Раньше в ссылку
   * подставлялся id группы, по которому получатель всё равно ничего не мог
   * открыть.
   */
  const ensureInviteLink = async (): Promise<string | null> => {
    if (inviteLink) return inviteLink;
    if (!hasPublicInviteOrigin()) {
      setInviteError('Не задан публичный HTTPS-адрес приложения (NEXT_PUBLIC_APP_URL), поэтому внешнюю ссылку создать нельзя.');
      return null;
    }

    const { data: code, error } = await createInvite(group.id);
    if (error || !code) {
      setInviteError(error ?? 'Не удалось создать приглашение');
      return null;
    }
    const link = absoluteInviteLink(code);
    if (!link) {
      setInviteError('Не задан публичный HTTPS-адрес приложения (NEXT_PUBLIC_APP_URL), поэтому внешнюю ссылку создать нельзя.');
      return null;
    }
    setInviteLink(link);
    return link;
  };

  const handleNativeShare = async () => {
    const link = await ensureInviteLink();
    if (!link) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Приглашение в SplitIT: ${group.name}`,
          text: inviteText,
          url: link,
        });
      } catch (e) {
        console.warn('Share cancelled or failed', e);
      }
    } else {
      handleCopyInviteLink();
    }
  };

  const handleCopyInviteLink = async () => {
    const link = await ensureInviteLink();
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  // Contacts Selection
  const handleSelectFromPhonebook = async () => {
    if ('contacts' in navigator && 'select' in (navigator as any).contacts) {
      try {
        const contacts = await (navigator as any).contacts.select(['name', 'tel'], { multiple: false });
        if (contacts && contacts.length > 0) {
          const cName = contacts[0].name?.[0] || contacts[0].tel?.[0] || 'Контакт';
          addMemberByName(cName);
          setShowPhonebookModal(false);
          return;
        }
      } catch (err) {
        console.warn('Contacts selection cancelled or fallback', err);
      }
    }
    setShowPhonebookModal(true);
  };

  const addMemberByName = async (nameStr: string) => {
    if (!nameStr.trim()) return;
    const isExists = (group.members || []).some(
      (m: any) => m.name.toLowerCase().trim() === nameStr.toLowerCase().trim()
    );
    if (isExists) return;

    // В сетевом режиме финансовые участники без аккаунта появятся только после
    // завершения participant-модели. Имя не используется как идентификатор.
    if (isMultiUser()) {
      setInviteError('В общем событии участники добавляются по ссылке-приглашению.');
      setIsAddingMember(false);
      return;
    }

    // Локальный режим
    const newMember = {
      id: `m-${Date.now()}`,
      name: nameStr.trim(),
      avatar: '👤',
      role: 'member',
    };

    const updated = { ...group, members: [...(group.members || []), newMember] };
    setGroup(updated);
    setNewMemberName('');
    setIsAddingMember(false);
    void persistLocalGroup(updated);
  };

  const handleAddFromPhonebookSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactNameInput.trim()) return;
    addMemberByName(contactNameInput);
    setContactNameInput('');
    setContactPhoneInput('');
    setShowPhonebookModal(false);
  };

  /** Локальный режим: пишем изменённую группу целиком. */
  const persistLocalGroup = async (updated: any) => {
    const saved = getSavedGroups();
    const idx = saved.findIndex((g: any) => g.id === updated.id);
    if (idx !== -1) saved[idx] = updated;
    const error = saveGroups(idx !== -1 ? saved : [updated, ...saved]);
    if (error) setActionError(error);
  };

  const handleSaveGroupName = async () => {
    if (!editedName.trim()) return;
    setIsEditingName(false);

    const { error } = await renameGroup(group.id, editedName.trim());
    if (error) {
      setActionError(error);
      return;
    }
    await loadGroup();
  };

  const handleDeleteExpenseConfirmed = async () => {
    if (!expenseToDelete) return;
    const target = expenseToDelete;
    setExpenseToDelete(null);

    const { error } = await deleteExpenseFromStore(group.id, target.id);
    if (error) {
      setActionError(error);
      return;
    }
    await loadGroup();
  };

  const handleDeleteEventConfirmed = async () => {
    setShowDeleteEventModal(false);
    const { error } = await deleteGroup(group.id);
    if (error) {
      setActionError(error);
      return;
    }
    router.push(routes.home());
  };

  const handleToggleCompleteEvent = async (targetStatus: 'completed' | 'active') => {
    setShowCompleteModal(false);

    const { error } = await setGroupStatus(group.id, targetStatus);
    if (error) {
      setActionError(error);
      return;
    }
    await loadGroup();

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
      {actionError && (
        <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-center justify-between">
          <p className="text-xs font-bold text-rose-700">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Header Nav */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition-all shadow-xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        
        {isEditingName ? (
          <div className="flex items-center gap-1.5 flex-1 max-w-[200px] mx-2">
            <input
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              className="w-full px-2 py-1 text-xs font-bold border border-blue-400 rounded-lg focus:outline-none dark:bg-slate-900 dark:text-white"
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
            <h2 className="font-extrabold text-slate-900 dark:text-white text-base">{group.name}</h2>
            <Edit2 className="w-3.5 h-3.5 text-slate-400 hover:text-blue-600" />
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowInviteModal(true);
              void ensureInviteLink();
            }}
            className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition-all shadow-xs"
            title="Пригласить участников"
          >
            <Share2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </button>
          {(!isMultiUser() || userProfile?.id === group.createdBy) && (
            <button
              onClick={() => setShowDeleteEventModal(true)}
              className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all shadow-xs"
              title="Удалить событие"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
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
            href={routes.expenseNew(group.id)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <PlusCircle className="w-5 h-5 text-blue-400" />
            <span className="text-[10px] font-bold">Расход</span>
          </Link>

          <Link
            href={routes.eventBalance(group.id)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <Scale className="w-5 h-5 text-emerald-400" />
            <span className="text-[10px] font-bold">Баланс</span>
          </Link>

          <Link
            href={routes.eventSettle(group.id)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <CreditCard className="w-5 h-5 text-amber-400" />
            <span className="text-[10px] font-bold">Расчет</span>
          </Link>

          <Link
            href={routes.eventExport(group.id)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-center"
          >
            <FileText className="w-5 h-5 text-purple-400" />
            <span className="text-[10px] font-bold">Отчет</span>
          </Link>
        </div>

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
      <div className="stitch-card p-4 space-y-2 bg-white dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Участники ({group.members?.length || 0})
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectFromPhonebook}
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-100 dark:border-indigo-800"
              title="Выбрать из телефонной книги"
            >
              <Phone className="w-3 h-3" />
              <span>Контакты</span>
            </button>
            <button
              onClick={() => setIsAddingMember(true)}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 rounded-lg border border-blue-100 dark:border-blue-800"
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
              className="flex-1 px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none dark:bg-slate-900 dark:text-white"
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
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 flex-shrink-0"
            >
              <span className="text-base">{m.avatar || '👤'}</span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{m.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Expenses Feed */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-slate-900 dark:text-white text-sm">
            Лента транзакций ({(group.expenses || []).length})
          </h4>
          <Link
            href={routes.expenseNew(group.id)}
            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Добавить</span>
          </Link>
        </div>

        {(group.expenses || []).length === 0 ? (
          <div className="stitch-card p-6 text-center text-slate-500 dark:text-slate-400 text-xs bg-white dark:bg-slate-800">
            Транзакции пока не добавлены. Нажмите «Добавить», чтобы зафиксировать первый расход!
          </div>
        ) : (
          <div className="space-y-3">
            {(group.expenses || []).map((expense: any) => {
              const paidByMember =
                (group.members || []).find((m: any) => m.id === expense.paidById) || group.members[0];

              return (
                <div key={expense.id} className="stitch-card p-4 space-y-3 group hover:border-blue-300 transition-all bg-white dark:bg-slate-800">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 font-bold">
                        {paidByMember?.avatar || '👤'}
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-900 dark:text-white text-sm">{expense.title}</h5>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                          Оплатил(а){' '}
                          <span className="font-bold text-slate-800 dark:text-slate-200">{paidByMember?.name || 'Участник'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="text-right">
                        <span className="block font-extrabold text-slate-900 dark:text-white text-base">
                          {formatMoney(expense.amount, expense.currency || group.currency)}
                        </span>
                        {expense.currency !== group.currency && (
                          <span className="text-[10px] text-slate-400 font-semibold">
                            ≈ {formatMoney(expense.amountInGroupCurrency, group.currency)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 pl-1 border-l border-slate-100 dark:border-slate-700">
                        <Link
                          href={routes.expenseEdit(group.id, expense.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-all"
                          title="Редактировать расход"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => setExpenseToDelete(expense)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-all"
                          title="Удалить расход"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 font-semibold text-[10px] uppercase">
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

      {/* Phonebook Contacts Picker Modal */}
      {showPhonebookModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base flex items-center gap-2">
                <Phone className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <span>Телефонная книга контактов</span>
              </h3>
              <button onClick={() => setShowPhonebookModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Pick Saved Friends List */}
            {savedFriends.length > 0 && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Выбрать из сохраненных друзей:
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {savedFriends.map((f) => {
                    const isAlreadyIn = (group.members || []).some((m: any) => m.name === f.name);
                    return (
                      <div
                        key={f.id}
                        className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{f.avatar || '👤'}</span>
                          <div>
                            <span className="text-xs font-bold text-slate-900 dark:text-white block">{f.name}</span>
                            <span className="text-[10px] text-slate-400">{f.phone}</span>
                          </div>
                        </div>
                        <button
                          disabled={isAlreadyIn}
                          onClick={() => {
                            addMemberByName(f.name);
                            setShowPhonebookModal(false);
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            isAlreadyIn
                              ? 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                          }`}
                        >
                          {isAlreadyIn ? 'В событии' : '+ Добавить'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Manual Contact Entry */}
            <form onSubmit={handleAddFromPhonebookSubmit} className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Или введите контакт вручную:
              </label>
              <input
                type="text"
                required
                placeholder="Имя контакта"
                value={contactNameInput}
                onChange={(e) => setContactNameInput(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white focus:outline-none"
              />
              <input
                type="tel"
                placeholder="+7 (999) 000-00-00"
                value={contactPhoneInput}
                onChange={(e) => setContactPhoneInput(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white focus:outline-none"
              />

              <button
                type="submit"
                className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md transition-all"
              >
                Сохранить контакт в событие
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Expense Modal */}
      {expenseToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Удаление расхода</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Удалить «<span className="font-bold text-slate-900 dark:text-white">{expenseToDelete.title}</span>» на сумму{' '}
                <span className="font-extrabold text-slate-900 dark:text-white">{formatMoney(expenseToDelete.amount, expenseToDelete.currency)}</span>?
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setExpenseToDelete(null)}
                className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 transition-all"
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Завершить событие?</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Все взаиморасчеты будут зафиксированы как выровненные в 0 ₽. Статус события изменится на «Завершено».
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 transition-all"
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

      {/* Delete Event Modal */}
      {showDeleteEventModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Удаление события</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Вы уверены, что хотите безвозвратно удалить событие «<span className="font-bold text-slate-900 dark:text-white">{group.name}</span>»?
                Все участники, расходы и долги будут удалены.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteEventModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteEventConfirmed}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md shadow-rose-500/20 transition-all"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Пригласить участников</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Отправьте приглашение друзьям в удобном мессенджере или добавьте из телефонной книги:
            </p>

            {inviteError && (
              <p role="alert" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">
                {inviteError}
              </p>
            )}

            {!inviteLink && !inviteError && (
              <p className="text-xs text-slate-400 font-medium">Готовим ссылку-приглашение…</p>
            )}

            <div className={`grid grid-cols-2 gap-2.5 pt-1 ${inviteLink ? '' : 'opacity-40 pointer-events-none'}`}>
              <a
                href={`https://t.me/share/url?url=${encodeURIComponent(inviteLink ?? '')}&text=${encodeURIComponent(inviteText)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-100 font-bold text-xs transition-all"
              >
                <Send className="w-4 h-4 text-sky-600" />
                <span>Telegram</span>
              </a>

              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${inviteText} ${inviteLink ?? ''}`)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 font-bold text-xs transition-all"
              >
                <MessageCircle className="w-4 h-4 text-emerald-600" />
                <span>WhatsApp</span>
              </a>

              <a
                href={`sms:?body=${encodeURIComponent(`${inviteText} ${inviteLink ?? ''}`)}`}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-100 font-bold text-xs transition-all"
              >
                <MessageSquare className="w-4 h-4 text-purple-600" />
                <span>SMS</span>
              </a>

              <button
                onClick={handleNativeShare}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 font-bold text-xs transition-all"
              >
                <Share2 className="w-4 h-4 text-blue-600" />
                <span>Системный</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
              <button
                onClick={handleSelectFromPhonebook}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md shadow-indigo-500/20 transition-all"
              >
                <Phone className="w-4 h-4" />
                <span>Выбрать из телефонной книги</span>
              </button>
            </div>

            {copiedInvite && (
              <p className="text-[11px] font-bold text-center text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 p-2 rounded-lg">
                Ссылка скопирована в буфер обмена!
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
