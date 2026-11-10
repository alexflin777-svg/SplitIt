'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { computeEventSummary } from '@/lib/event-summary';
import EventInviteStep from '@/components/v1/EventInviteStep';
import { Art, Avatar, BlockHead, Header, MainButton, PillLink, Plaque, TopNav, V1Screen, avatarBg, cx } from '@/components/v1/ui';
import { getActiveSession, getSavedFriends, getSavedGroups, saveGroups, UserProfile } from '@/lib/supabase';
import {
  renameGroup,
  setGroupStatus,
  deleteExpense as deleteExpenseFromStore,
  deleteGroup,
  createInvite,
  getActiveInvite,
  addGuestMember,
  removeGuest,
  isMultiUser,
} from '@/lib/store';
import { formatMoney } from '@/lib/currency';
import {
  Plus,
  Scale,
  CreditCard,
  FileText,
  Share2,
  X,
  Check,
  Pencil,
  Trash2,
  Phone,
  Send,
  MessageCircle,
  MessageSquare,
  Users,
  Lock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { routes, absoluteInviteLink, hasPublicInviteOrigin } from '@/lib/routes';
import { getConfigProblem } from '@/lib/env';
import { useI18n } from '@/lib/i18n/provider';
import { useGroup } from '@/lib/data-hooks';
import { resolveSplitMode } from '@/lib/split-rescale';
import { DEFAULT_EXPENSE_PAGE_SIZE } from '@/lib/remote-store';
import EventSummary from '../_components/EventSummary';
import MemberAvatar from '@/components/MemberAvatar';

/**
 * Экран «события нет на этом устройстве».
 *
 * Возникает, когда ссылку прислали с чужого телефона. Без подключённого
 * бэкенда подтянуть чужую группу неоткуда, и честнее сказать это прямо, чем
 * показать выдуманное событие.
 */
function EventNotFound({ groupId }: { groupId: string }) {
  const { t } = useI18n();
  const configProblem = getConfigProblem();

  return (
    <div className="max-w-md mx-auto px-1 pb-24 pt-6">
      <div role="alert" className="stitch-card p-6 text-center space-y-3 bg-white dark:bg-slate-800">
        <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">{t('eventDetail.notFoundTitle')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('eventDetail.notFoundBody', { groupId })}
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {configProblem
            ? t('eventDetail.notFoundLocal')
            : t('eventDetail.notFoundNoAccess')}
        </p>
        <Link
          href={routes.home()}
          className="inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all duration-300 hover:bg-blue-700"
        >
          {t('eventDetail.backToEvents')}
        </Link>
      </div>
    </div>
  );
}

export default function EventDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  // Сколько расходов показывать в ленте. Это только отрисовка: в group.expenses
  // всегда все расходы, по ним считаются итог и категории (G2).
  const [expenseLimit, setExpenseLimit] = useState(DEFAULT_EXPENSE_PAGE_SIZE);
  const { group: cachedGroup, error: cachedError, isLoading, refresh: refreshGroup } = useGroup(groupId, { snapshot: true });
  const [group, setGroup] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'not-found'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [managingMembers, setManagingMembers] = useState(false);
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
   * под настоящим id. Сейчас данные приходят из SWR-кеша; Realtime события
   * точечно патчат этот кеш, а не вызывают полный refetch группы на каждый split.
   */
  useEffect(() => {
    if (isLoading && !cachedGroup && !cachedError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- P1-6 (синхронизация SWR-кеша события с редактируемым состоянием); пересмотр до 2026-11-15
      setStatus('loading');
      return;
    }

    if (cachedError || !cachedGroup) {
      setGroup(null);
      setLoadError(cachedError);
      setStatus('not-found');
      return;
    }

    setGroup(cachedGroup);
    setEditedName(cachedGroup.name);
    setStatus('ok');
    getActiveSession().then(setUserProfile);
  }, [cachedError, cachedGroup, isLoading]);


  if (status === 'loading') {
    return <div className="p-4 text-xs font-bold text-slate-500 text-center">{t('eventDetail.loading')}</div>;
  }

  if (status === 'not-found' || !group) {
    return <EventNotFound groupId={groupId} />;
  }

  const totalExpenses = (group.expenses || []).reduce(
    (acc: number, e: any) => acc + (e.amountInGroupCurrency || e.amount || 0),
    0
  );

  const isCompleted = group.status === 'completed';
  // Закрыть и переоткрыть событие может только владелец — это же правило
  // проверяет политика groups_update_owner в базе.
  const isOwner = !isMultiUser() || userProfile?.id === group.createdBy;
  const isCurrentUserMember =
    !!userProfile && (group.members || []).some((m: any) => m.id === userProfile.id);

  // Шаг «Позови друзей» сразу после создания (SCENARIOS-AUDIT §4 п. 5).
  if (searchParams.get('invite') === '1') {
    return <EventInviteStep group={group} isOwner={isOwner} onDone={() => router.replace(routes.eventDetail(group.id))} />;
  }
  // «Тебе должны / Ты должен» — та же формула, что экран «Баланс».
  const myBalance = userProfile ? computeEventSummary(group).balances[userProfile.id] : undefined;
  const myNet = myBalance && Math.abs(myBalance.netAmount) >= 0.005 ? myBalance.netAmount : 0;

  // Category Colors and Breakdown Diagram Math
  const categoryConfig: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
    food: { label: t('eventDetail.category.food'), color: 'bg-emerald-400', bg: 'text-emerald-300', emoji: '🍱' },
    transport: { label: t('eventDetail.category.transport'), color: 'bg-sky-400', bg: 'text-sky-300', emoji: '🚖' },
    lodging: { label: t('eventDetail.category.lodging'), color: 'bg-purple-400', bg: 'text-purple-300', emoji: '🏨' },
    entertainment: { label: t('eventDetail.category.entertainment'), color: 'bg-amber-400', bg: 'text-amber-300', emoji: '🎟️' },
    other: { label: t('eventDetail.category.other'), color: 'bg-rose-400', bg: 'text-rose-300', emoji: '🛍️' },
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
  const inviteText = t('eventDetail.inviteShareText', { name: group.name });

  /**
   * Ссылка выдаётся базой: одноразовый код с сроком жизни. Раньше в ссылку
   * подставлялся id группы, по которому получатель всё равно ничего не мог
   * открыть.
   */
  const ensureInviteLink = async (): Promise<string | null> => {
    if (inviteLink) return inviteLink;
    if (!hasPublicInviteOrigin()) {
      setInviteError(t('eventDetail.noPublicUrlError'));
      return null;
    }

    // Одна ссылка на событие: действующая показывается снова, новая — только если её нет.
    const existing = await getActiveInvite(group.id);
    // Не прочитали действующую — не создаём вторую вслепую.
    if (existing.error) {
      setInviteError(existing.error);
      return null;
    }
    const { data: code, error } = existing.data ? { data: existing.data.code, error: null } : await createInvite(group.id);
    if (error || !code) {
      setInviteError(error ?? t('eventDetail.errorCreateInviteFailed'));
      return null;
    }
    const link = absoluteInviteLink(code);
    if (!link) {
      setInviteError(t('eventDetail.noPublicUrlError'));
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
          title: t('eventDetail.inviteShareTitle', { name: group.name }),
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
          const cName = contacts[0].name?.[0] || contacts[0].tel?.[0] || t('eventDetail.contacts');
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

    if (isMultiUser()) {
      // Optimistic update
      const tempId = `guest-${new Date().getTime()}`;
      const optimisticMember = {
        id: tempId,
        name: nameStr.trim(),
        avatar: '👤',
        role: 'member',
      };
      
      const previousGroup = { ...group };
      const updated = { ...group, members: [...(group.members || []), optimisticMember] };
      setGroup(updated);
      setNewMemberName('');
      setIsAddingMember(false);

      // Backend call
      const { data: newMember, error } = await addGuestMember(group.id, nameStr.trim());
      
      if (error) {
        setInviteError(error);
        setGroup(previousGroup); // Rollback on error
        return;
      }

      // Replace optimistic member with real backend member
      setGroup((prev: any) => {
        if (!prev) return prev;
        const members = prev.members.map((m: any) => m.id === tempId ? newMember : m);
        return { ...prev, members };
      });
      return;
    }

    // Локальный режим
    // Точечное исключение: правило purity не различает тело компонента и
    // обработчик, а здесь Date.now() вызывается только по нажатию. Само
    // правило остаётся включённым для всего проекта.
    // eslint-disable-next-line react-hooks/purity
    const localMemberId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newMember = {
      id: localMemberId,
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

  // Гость: в сети — участник без аккаунта; локально — любой, кроме владельца.
  // В закрытом событии состав не меняем; гость, ещё не подтверждённый
  // сервером (временный id guest-…), удаляться не может.
  const canRemoveMember = (m: any) =>
    group.status !== 'completed' &&
    !String(m.id).startsWith('guest-') &&
    (isMultiUser() ? !!m.isGuest : m.role !== 'owner' && m.id !== group.createdBy && m.id !== userProfile?.id);

  const handleRemoveMember = async (member: any) => {
    // Повторный тап до ответа сервера дал бы «нельзя удалить» уже после удаления.
    if (removingMemberId) return;
    setActionError(null);
    setRemovingMemberId(member.id);
    const { error } = await removeGuest(group.id, member.id);
    setRemovingMemberId(null);
    if (error) {
      setActionError(error);
      return;
    }
    await refreshGroup();
  };

  const handleSaveGroupName = async () => {
    if (!editedName.trim()) return;
    setIsEditingName(false);

    const { error } = await renameGroup(group.id, editedName.trim());
    if (error) {
      setActionError(error);
      return;
    }
    await refreshGroup();
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
    await refreshGroup();
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
    const { error } = await setGroupStatus(group.id, targetStatus);
    if (error) {
      setActionError(error);
      return;
    }
    await refreshGroup();
    // С экрана «Подвести итог» — обратно на событие, уже закрытое.
    if (targetStatus === 'completed') router.replace(routes.eventDetail(group.id));
  };

  const expenses = group.expenses || [];
  const members = group.members || [];
  const currency = group.currency || 'RUB';
  // Цвет аватара — по порядку участников события (avatarBg), как на остальных экранах V1.
  const memberIdx = (id: string) => members.findIndex((m: any) => m.id === id);
  const ownerName = members.find((m: any) => m.id === group.createdBy)?.name ?? t('eventDetail.defaultMember');
  const mineLabel = myNet > 0 ? t('event.v1.owedToYou') : myNet < 0 ? t('event.v1.youOwe') : t('event.v1.even');
  const mineAmount = formatMoney(Math.abs(myNet), currency);

  const errorPlaque = actionError && (
    <Plaque kind="err" testId="action-error">
      <span className="flex items-start justify-between gap-2">
        <span>{actionError}</span>
        <button onClick={() => setActionError(null)} aria-label={t('eventDetail.cancel')} className="text-v1-muted">
          <X className="w-5 h-5" />
        </button>
      </span>
    </Plaque>
  );

  // «Подвести итог» — отдельный экран V1 в том же маршруте (?settle=1): переводы и одна кнопка.
  // Закрыть может только владелец и только непустое событие — иначе обычный экран.
  if (searchParams.get('settle') === '1' && !isCompleted && isOwner && expenses.length > 0) {
    const transfersCount = computeEventSummary(group).transfers.length;
    return (
      <V1Screen
        testId="event-settle"
        dock={
          <>
            {/* Пояснение о фиксации — над кнопкой, в закреплённой зоне: видно до нажатия. */}
            <Plaque kind="warn" testId="settle-lock-note">
              <b className="block text-base">{t('event.v1.lockTitle')}</b>
              {t('event.v1.lockBody')}
            </Plaque>
            <MainButton testId="settle-lock" onClick={() => handleToggleCompleteEvent('completed')}>
              <Lock className="w-5 h-5" aria-hidden="true" />
              {t('eventDetail.finishSettlement')}
            </MainButton>
          </>
        }
      >
        <TopNav back={routes.eventDetail(group.id)} />
        <Header title={t('summary.transfersTitle')} sub={`${group.name} · ${formatMoney(totalExpenses, currency)}`} />
        {errorPlaque}
        {transfersCount > 0 && (
          <div className="relative overflow-hidden isolate mb-2 px-5 pt-[18px] pb-5 rounded-tile bg-v1-trip">
            <p className="text-[26px] leading-[1.1] font-extrabold tracking-[-0.02em]">
              {t('event.v1.settleLeft', { count: transfersCount })}
            </p>
            <p className="mt-2 max-w-[14em] text-base text-v1-ink2 relative z-[1]">{t('event.v1.settleLeftBody')}</p>
            <Art name="receipts" className="absolute w-[112px] -right-3 -bottom-6 pointer-events-none" />
          </div>
        )}
        <EventSummary group={group} currentUserId={userProfile?.id} compact />
      </V1Screen>
    );
  }

  const moreLink = 'w-full flex items-center gap-3 min-h-16 py-3 pr-4 pl-3 bg-v1-card rounded-row text-base font-semibold text-left';
  const moreIcon = 'w-10 h-10 rounded-full bg-v1-bg grid place-items-center flex-none';

  return (
    <V1Screen
      testId="event-detail"
      dock={
        // Одна главная кнопка внизу (V1): владельцу — «Подвести итог», остальным — «Добавить расход».
        !isCompleted &&
        (isOwner && expenses.length > 0 ? (
          <MainButton testId="close-event" onClick={() => router.push(routes.eventDetail(group.id, { settle: 1 }))}>
            {t('event.v1.settle')}
          </MainButton>
        ) : (
          <MainButton testId="event-add-expense" href={routes.expenseNew(group.id)}>
            {expenses.length ? t('eventDetail.actionExpense') : t('event.v1.addFirst')}
          </MainButton>
        ))
      }
    >
      <TopNav
        back={routes.home()}
        right={
          isCompleted ? (
            isOwner && (
              <PillLink onClick={() => handleToggleCompleteEvent('active')}>
                <Lock className="w-5 h-5" aria-hidden="true" />
                {t('eventDetail.resume')}
              </PillLink>
            )
          ) : (
            <PillLink
              onClick={() => {
                setShowInviteModal(true);
                void ensureInviteLink();
              }}
            >
              <Users className="w-5 h-5" aria-hidden="true" />
              {t('event.v1.invite')}
            </PillLink>
          )
        }
      />

      {isEditingName ? (
        <div className="pt-1 pb-4 flex items-center gap-2">
          <input
            type="text"
            autoFocus
            value={editedName}
            aria-label={t('eventNew.nameLabel')}
            onChange={(e) => setEditedName(e.target.value)}
            className="flex-1 min-w-0 h-12 px-4 rounded-full bg-v1-card outline-none text-xl font-extrabold"
          />
          <button
            onClick={handleSaveGroupName}
            aria-label={t('eventDetail.ok')}
            className="w-12 h-12 rounded-full bg-v1-ink text-white grid place-items-center flex-none"
          >
            <Check className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <Header
          title={
            isCompleted ? (
              t('event.v1.closedTitle')
            ) : (
              <button type="button" onClick={() => setIsEditingName(true)} className="text-left">
                {group.name}
                <Pencil className="inline-block ml-2 w-5 h-5 text-v1-muted align-baseline" aria-hidden="true" />
              </button>
            )
          }
          sub={
            isCompleted
              ? group.name
              : expenses.length
                ? t('event.v1.totalAll', { total: formatMoney(totalExpenses, currency) })
                : t('event.v1.noExpensesSub')
          }
        />
      )}

      {errorPlaque}

      {searchParams.get('joined') === '1' && (
        <Plaque kind="ok" testId="event-joined">
          <b>{t('event.v1.joinedTitle')}</b> {t('event.v1.joinedBody', { name: ownerName })}
        </Plaque>
      )}

      {isCompleted ? (
        // Спокойный мятный итог вместо насыщенно-зелёной панели. Градиент едва заметный,
        // но остаётся: регрессия close-event проверяет, что фон баннера не сброшен .stitch-card.
        <div
          data-testid="closed-banner"
          className={cx(
            'relative overflow-hidden isolate rounded-tile px-5 pt-[18px] pb-5 bg-gradient-to-br',
            myNet < 0 ? 'from-v1-minus to-[#FCD3B8]' : 'from-v1-plus to-[#C6EAD1]',
          )}
        >
          <span className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-v1-card text-[15px] font-bold">
            <Lock className="w-4 h-4" aria-hidden="true" />
            {t('eventDetail.completedBanner')}
          </span>
          {myBalance && (
            <>
              <p className="mt-3 text-base font-semibold text-v1-ink2">{mineLabel}</p>
              <p className="mt-1 text-[46px] leading-none font-extrabold tracking-[-0.03em]">{mineAmount}</p>
            </>
          )}
          <p className="mt-2 max-w-[15em] text-[15px] text-v1-ink2 relative z-[1]">{t('eventDetail.completedNote')}</p>
          {group.category === 'trip' && (
            <Art name="trip" className="absolute w-[96px] -right-2 -bottom-4 pointer-events-none" />
          )}
        </div>
      ) : (
        (myBalance || expenses.length === 0) && (
          // Без расходов — голубое пустое состояние V1 (макет h4-joined).
          <div
            data-testid="event-mine"
            className={cx(
              'relative overflow-hidden isolate rounded-tile px-5 pt-[18px] pb-5',
              expenses.length === 0 ? 'bg-v1-trip' : myNet < 0 ? 'bg-v1-minus' : 'bg-v1-plus',
            )}
          >
            {myBalance && (
              <>
                <p className="text-base font-semibold text-v1-ink2">{mineLabel}</p>
                <p className="mt-1 text-[46px] leading-none font-extrabold tracking-[-0.03em]">{mineAmount}</p>
              </>
            )}
            <p className="mt-2 max-w-[15em] text-[15px] text-v1-ink2 relative z-[1]">
              {expenses.length === 0
                ? t('event.v1.emptyHint')
                : t('event.v1.paidShare', {
                    paid: formatMoney(myBalance?.paid ?? 0, currency),
                    share: formatMoney(myBalance?.owes ?? 0, currency),
                  })}
            </p>
            {group.category === 'trip' && (
              <Art name="trip" className="absolute w-[96px] -right-2 -bottom-4 pointer-events-none" />
            )}
          </div>
        )
      )}

      {isCompleted && (
        <>
          <BlockHead title={t('event.v1.transfers')} />
          <EventSummary group={group} currentUserId={userProfile?.id} />
        </>
      )}

      {/* Участники: крупные аватары по порядку события, «+ Позвать» в конце ряда. */}
      <BlockHead
        title={t('eventDetail.members')}
        right={
          members.some(canRemoveMember) ? (
            // Удаление — в режиме управления, не постоянным крестиком на каждом аватаре.
            <>
              {members.length} ·{' '}
              <button type="button" data-testid="members-manage" onClick={() => setManagingMembers((v) => !v)}
                aria-pressed={managingMembers}
                className="py-3 -my-3 px-1 -mx-1 text-v1-accent-ink font-bold"
              >
                {managingMembers ? t('terms.done') : t('common.edit')}
              </button>
            </>
          ) : (
            members.length
          )
        }
      />
      <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pt-1 pb-1">
        {members.map((m: any, i: number) => (
          <div key={m.id} className="relative flex-none w-16 flex flex-col items-center gap-1.5">
            <Avatar name={m.name} index={i} size="l" />
            <span className="w-full text-center text-[15px] font-medium truncate">
              {userProfile && m.id === userProfile.id ? t('project.you') : m.name}
            </span>
            {managingMembers && canRemoveMember(m) && (
              <button
                type="button"
                data-testid={`remove-member-${m.id}`}
                onClick={() => void handleRemoveMember(m)}
                disabled={removingMemberId !== null}
                aria-label={t('eventDetail.removeGuest', { name: m.name })}
                title={t('eventDetail.removeGuest', { name: m.name })}
                className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-v1-card shadow-sm grid place-items-center text-v1-muted"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setIsAddingMember(true)} className="flex-none w-16 flex flex-col items-center gap-1.5">
          <span className="w-14 h-14 rounded-full bg-v1-card grid place-items-center">
            <Plus className="w-6 h-6" aria-hidden="true" />
          </span>
          <span className="text-[15px] font-medium">{t('event.v1.call')}</span>
        </button>
      </div>

      {isAddingMember && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              placeholder={t('eventDetail.newMemberPlaceholder')}
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              className="flex-1 min-w-0 h-11 px-4 rounded-full bg-v1-card outline-none text-base font-semibold"
            />
            <button onClick={() => addMemberByName(newMemberName)} className="h-11 px-4 rounded-full bg-v1-ink text-white font-bold">
              {t('eventDetail.ok')}
            </button>
            <button
              onClick={() => setIsAddingMember(false)}
              aria-label={t('eventDetail.cancel')}
              className="w-11 h-11 rounded-full bg-v1-card grid place-items-center flex-none"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={handleSelectFromPhonebook}
            title={t('eventDetail.pickFromContacts')}
            className="h-11 px-4 rounded-full bg-v1-card inline-flex items-center gap-2 font-semibold text-[15px]"
          >
            <Phone className="w-4 h-4" aria-hidden="true" />
            {t('eventDetail.contacts')}
          </button>
        </div>
      )}

      {/* Расходы: белые строки V1. Без расходов блока нет — пустое состояние выше. */}
      {expenses.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 mt-[22px] mb-3">
            <h2 className="text-xl leading-tight font-extrabold tracking-[-0.01em]">
              {t('event.v1.expenses', { count: expenses.length })}
            </h2>
            {!isCompleted && (
              <Link
                href={routes.expenseNew(group.id)}
                className="h-11 px-4 rounded-full bg-v1-card inline-flex items-center gap-1.5 font-bold text-[15px]"
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
                {t('eventNew.add')}
              </Link>
            )}
          </div>
          <div className="space-y-2">
            {expenses.slice(0, expenseLimit).map((expense: any) => {
              // Плательщика нет среди участников — пишем «Участник», а не
              // приписываем расход первому участнику, как раньше.
              const paidByMember = members.find((m: any) => m.id === expense.paidById);
              // Доля в расчёте события — в валюте события (как в computeEventSummary).
              const mySplit = userProfile ? (expense.splits || []).find((s: any) => s.userId === userProfile.id) : undefined;

              return (
                <div key={expense.id} data-testid="expense-card" className="bg-v1-card rounded-row py-3 pl-3 pr-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={cx(
                        'w-10 h-10 rounded-full flex-none grid place-items-center overflow-hidden text-base font-bold',
                        avatarBg(memberIdx(expense.paidById)),
                      )}
                      data-testid="expense-payer-avatar"
                    >
                      <MemberAvatar avatar={paidByMember?.avatar} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className="text-base font-semibold leading-tight line-clamp-2 break-words">{expense.title}</h5>
                      <p className="mt-0.5 text-[14px] text-v1-muted leading-snug line-clamp-2 break-words">
                        {t('eventDetail.paidByName')}{' '}
                        <span className="font-semibold text-v1-ink2">{paidByMember?.name || t('eventDetail.defaultMember')}</span>
                      </p>
                    </div>
                    <div className="text-right flex-none">
                      <span className="block text-[17px] font-bold tracking-[-0.01em] whitespace-nowrap" data-testid="expense-amount">
                        {formatMoney(expense.amount, expense.currency || group.currency)}
                      </span>
                      {expense.currency !== group.currency && (
                        <span className="block text-[14px] text-v1-muted whitespace-nowrap">
                          ≈ {formatMoney(expense.amountInGroupCurrency, group.currency)}
                        </span>
                      )}
                      {mySplit && (
                        <span className="block text-[14px] text-v1-muted whitespace-nowrap">
                          {t('event.v1.yours', { amount: formatMoney(mySplit.amountOwed || 0, currency) })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 pl-[52px] flex items-center justify-between gap-2 text-[14px] text-v1-muted">
                    <span className="min-w-0 truncate">
                      {resolveSplitMode(expense) === 'equal' ? t('eventDetail.splitEqual') : t('eventDetail.splitShares')}{' '}
                      <span data-testid="expense-members-count">• {t('eventDetail.membersCountShort', { count: (expense.splits || []).length })}</span>
                      {/* Дата берётся только из записи. Прежний fallback на
                          Date.now() рисовал сегодняшнее число у расхода без
                          даты — выдуманное значение и расхождение гидратации. */}
                      {expense.createdAt
                        ? ` · ${new Date(expense.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                        : null}
                    </span>

                    {!isCompleted && (
                      <span className="flex items-center gap-1 flex-none">
                        <Link
                          href={routes.expenseEdit(group.id, expense.id)}
                          className="w-10 h-10 rounded-full grid place-items-center text-v1-ink2 hover:bg-v1-bg"
                          title={t('eventDetail.editExpense')}
                          aria-label={t('eventDetail.editExpense')}
                        >
                          <Pencil className="w-[18px] h-[18px]" aria-hidden="true" />
                        </Link>
                        <button
                          onClick={() => setExpenseToDelete(expense)}
                          className="w-10 h-10 rounded-full grid place-items-center text-v1-ink2 hover:bg-v1-bg"
                          title={t('eventDetail.deleteExpenseTitle')}
                          aria-label={t('eventDetail.deleteExpenseTitle')}
                        >
                          <Trash2 className="w-[18px] h-[18px]" aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {expenses.length > expenseLimit ? (
              <button
                type="button"
                onClick={() => setExpenseLimit((limit) => limit + DEFAULT_EXPENSE_PAGE_SIZE)}
                className="w-full h-[52px] rounded-full bg-v1-card font-bold text-base"
              >
                {t('eventDetail.showMoreExpenses', { count: Math.min(DEFAULT_EXPENSE_PAGE_SIZE, expenses.length - expenseLimit) })}
              </button>
            ) : null}
          </div>
        </>
      )}

      {/* Прежняя тёмная панель — вниз, в сворачиваемый «Подробнее»: итог по категориям,
          Баланс / Расчёт / Отчёт и редкие действия. */}
      <details className="group mt-[22px]" data-testid="event-more">
        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer h-[52px] px-5 rounded-full bg-v1-card flex items-center justify-between font-bold text-base">
          {t('event.v1.more')}
          <ChevronDown className="w-5 h-5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-2 space-y-2">
          {totalExpenses > 0 && (
            <div className="bg-v1-card rounded-row px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-base font-semibold">
                <span>{t('eventDetail.totalSpent')}</span>
                <span className="font-bold whitespace-nowrap">{formatMoney(totalExpenses, currency)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {categorySegments.map((seg) => (
                  <span key={seg.key} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-v1-bg text-[14px] font-semibold">
                    <span className={`w-2 h-2 rounded-full ${seg.config.color}`} aria-hidden="true" />
                    {seg.config.emoji} {seg.config.label} {seg.percent}%
                  </span>
                ))}
              </div>
            </div>
          )}
          <Link href={routes.eventBalance(group.id)} className={moreLink}>
            <span className={moreIcon}><Scale className="w-5 h-5" aria-hidden="true" /></span>
            <span className="flex-1">{t('eventDetail.actionBalance')}</span>
            <ChevronRight className="w-5 h-5 text-v1-muted" aria-hidden="true" />
          </Link>
          <Link href={routes.eventSettle(group.id)} className={moreLink}>
            <span className={moreIcon}><CreditCard className="w-5 h-5" aria-hidden="true" /></span>
            <span className="flex-1">{t('eventDetail.actionSettle')}</span>
            <ChevronRight className="w-5 h-5 text-v1-muted" aria-hidden="true" />
          </Link>
          <Link href={routes.eventExport(group.id)} className={moreLink}>
            <span className={moreIcon}><FileText className="w-5 h-5" aria-hidden="true" /></span>
            <span className="flex-1">{t('eventDetail.actionReport')}</span>
            <ChevronRight className="w-5 h-5 text-v1-muted" aria-hidden="true" />
          </Link>
          {isCompleted && (
            <button
              type="button"
              onClick={() => {
                setShowInviteModal(true);
                void ensureInviteLink();
              }}
              className={moreLink}
            >
              <span className={moreIcon}><Users className="w-5 h-5" aria-hidden="true" /></span>
              <span className="flex-1">{t('eventDetail.invitePeople')}</span>
            </button>
          )}
          {(!isMultiUser() || userProfile?.id === group.createdBy) && (
            <button type="button" onClick={() => setShowDeleteEventModal(true)} className={cx(moreLink, 'text-v1-danger')}>
              <span className={moreIcon}><Trash2 className="w-5 h-5" aria-hidden="true" /></span>
              <span className="flex-1">{t('eventDetail.deleteEvent')}</span>
            </button>
          )}
        </div>
      </details>

      {/* Phonebook Contacts Picker Modal */}
      {showPhonebookModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base flex items-center gap-2">
                <Phone className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <span>{t('eventDetail.phonebookTitle')}</span>
              </h3>
              <button onClick={() => setShowPhonebookModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Pick Saved Friends List */}
            {savedFriends.length > 0 && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  {t('eventDetail.pickFromSavedFriends')}
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
                          <span className="text-base w-6 h-6 rounded-full overflow-hidden inline-flex items-center justify-center flex-shrink-0"><MemberAvatar avatar={f.avatar} /></span>
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
                          {isAlreadyIn ? t('eventDetail.alreadyIn') : t('eventDetail.addChip')}
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
                {t('eventDetail.orManualEntry')}
              </label>
              <input
                type="text"
                required
                placeholder={t('eventDetail.contactNamePlaceholder')}
                value={contactNameInput}
                onChange={(e) => setContactNameInput(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white focus:outline-none"
              />
              <input
                type="tel"
                placeholder={t('friends.phonePlaceholder')}
                value={contactPhoneInput}
                onChange={(e) => setContactPhoneInput(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white focus:outline-none"
              />

              <button
                type="submit"
                className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md transition-all"
              >
                {t('eventDetail.saveContactToEvent')}
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
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">{t('eventDetail.deleteExpenseTitle')}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {t('eventDetail.deleteExpenseConfirm', {
                  title: expenseToDelete.title,
                  amount: formatMoney(expenseToDelete.amount, expenseToDelete.currency),
                })}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setExpenseToDelete(null)}
                className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                {t('eventDetail.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeleteExpenseConfirmed}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md shadow-rose-500/20 transition-all"
              >
                {t('eventDetail.yesDelete')}
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
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">{t('eventDetail.deleteEventTitle')}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {t('eventDetail.deleteEventBody', { name: group.name })}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteEventModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                {t('eventDetail.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeleteEventConfirmed}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md shadow-rose-500/20 transition-all"
              >
                {t('eventDetail.delete')}
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
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">{t('eventDetail.inviteModalTitle')}</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              {t('eventDetail.inviteModalBody')}
            </p>

            {inviteError && (
              <p role="alert" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">
                {inviteError}
              </p>
            )}

            {!inviteLink && !inviteError && (
              <p className="text-xs text-slate-400 font-medium">{t('eventDetail.preparingLink')}</p>
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
                <span>{t('eventDetail.systemShare')}</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
              <button
                onClick={handleSelectFromPhonebook}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md shadow-indigo-500/20 transition-all"
              >
                <Phone className="w-4 h-4" />
                <span>{t('eventDetail.pickFromPhonebook')}</span>
              </button>
            </div>

            {copiedInvite && (
              <p className="text-[11px] font-bold text-center text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 p-2 rounded-lg">
                {t('eventDetail.linkCopied')}
              </p>
            )}
          </div>
        </div>
      )}
    </V1Screen>
  );
}
