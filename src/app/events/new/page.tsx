'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plane, Home, Utensils, Sparkles, Check, Plus, X } from 'lucide-react';
import { CURRENCIES } from '@/lib/currency';
import { getActiveSession, UserProfile } from '@/lib/supabase';
import { useSavedFriends } from '@/lib/data-hooks';
import { createGroup, isMultiUser } from '@/lib/store';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import MemberAvatar from '@/components/MemberAvatar';
import KindPicker from '@/components/v1/KindPicker';
import { Avatar, Chip, MainButton, Plaque, TopNav, V1Screen } from '@/components/v1/ui';

export default function NewEventPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'trip' | 'restaurant' | 'home' | 'party' | 'other'>('trip');
  const [currency, setCurrency] = useState('RUB');
  const [memberInput, setMemberInput] = useState('');
  const [showMemberInput, setShowMemberInput] = useState(false);
  const [members, setMembers] = useState<string[]>([t('eventNew.defaultYou')]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const multiUser = isMultiUser();
  // В сетевом режиме локальные друзья не предлагаются: участники приходят по приглашению.
  const localFriends = useSavedFriends();
  const savedFriends = multiUser ? [] : localFriends;

  useEffect(() => {
    getActiveSession().then((u) => {
      if (u) {
        setUserProfile(u);
        // Меняем только себя (первый элемент): уже введённые имена гостей не стираются.
        setMembers((prev) => [u.full_name || t('eventNew.defaultYou'), ...prev.slice(1)]);
        if (u.preferred_currency) setCurrency(u.preferred_currency);
      }
    });
  }, [t]);

  const categories = [
    { id: 'trip', label: t('eventNew.category.trip'), icon: Plane, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/60' },
    { id: 'restaurant', label: t('eventNew.category.restaurant'), icon: Utensils, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/60' },
    { id: 'home', label: t('eventNew.category.home'), icon: Home, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/60' },
    { id: 'party', label: t('eventNew.category.party'), icon: Sparkles, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/60' },
  ];

  const handleAddMember = () => {
    if (memberInput.trim() && !members.includes(memberInput.trim())) {
      setMembers([...members, memberInput.trim()]);
      setMemberInput('');
    }
  };

  const handleToggleSavedFriend = (friendName: string) => {
    if (members.includes(friendName)) {
      if (members.length > 1) {
        setMembers(members.filter((m) => m !== friendName));
      }
    } else {
      setMembers([...members, friendName]);
    }
  };

  const handleRemoveMember = (nameToRemove: string) => {
    if (members.length > 1) {
      setMembers(members.filter((m) => m !== nameToRemove));
    }
  };

  const handleCreate = async () => {
    setCreateError(null);
    setIsCreating(true);

    const { data, error } = await createGroup({
      name: name.trim() || t('eventNew.defaultEventName'),
      category,
      currency,
      memberNames: members,
    });

    setIsCreating(false);
    if (data && error) {
      // Событие создано, но часть гостей не добавилась: показываем, кого именно,
      // и даём перейти в событие, а не создавать его повторно.
      setCreateError(error);
      setCreatedEventId(data.id);
      return;
    }
    if (error || !data) {
      setCreateError(error ?? t('eventNew.errorCreateFailed'));
      return;
    }
    // Сразу шаг «Позови друзей» (SCENARIOS-AUDIT §4 п. 5), из него — в событие.
    // В локальном режиме приглашений нет — шаг пропускается, чтобы не показывать тупик.
    router.push(routes.eventDetail(data.id, multiUser ? { invite: 1 } : {}));
  };

  return (
    <V1Screen
      testId="event-new"
      dock={
        <MainButton testId="btn-create-event" onClick={handleCreate} disabled={isCreating || createdEventId !== null}>
          {isCreating ? t('eventNew.creating') : t('eventNew.submit')}
        </MainButton>
      }
    >
      <TopNav back={routes.home()} close />
      <KindPicker value="event" />

      <label className="mt-2 block px-6 py-3.5 rounded-card bg-v1-card">
        <span className="block text-[15px] text-v1-muted">{t('project.new.name')}</span>
        <input
          type="text"
          required
          placeholder={t('eventNew.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-transparent outline-none text-[17px] font-bold placeholder:text-v1-muted placeholder:font-medium placeholder:text-[15px]"
        />
      </label>

      {/* Категория и валюта — одной компактной строкой чипов и полем, без служебных подписей. */}
      <div className="mt-2 -mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar">
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <Chip key={cat.id} on={category === cat.id} onClick={() => setCategory(cat.id as any)}>
              <Icon className="w-5 h-5" aria-hidden="true" />
              {cat.label}
            </Chip>
          );
        })}
      </div>

      <label className="mt-2 block px-6 py-3.5 rounded-card bg-v1-card">
        <span className="block text-[15px] text-v1-muted">{t('eventNew.currency')}</span>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="w-full bg-transparent outline-none text-[17px] font-bold"
        >
          {Object.values(CURRENCIES).map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name} ({c.symbol})
            </option>
          ))}
        </select>
      </label>

      {/* В сетевом режиме имена становятся гостями события (group_participants),
          люди с аккаунтом присоединяются по приглашению. */}
      <div className="flex items-center justify-between gap-3 mt-[22px] mb-3">
        <h2 className="text-xl leading-tight font-extrabold tracking-[-0.01em]">
          {t('eventNew.membersLabel', { count: members.length })}
        </h2>
        <button
          type="button"
          onClick={() => setShowMemberInput(true)}
          className="h-11 px-4 rounded-full bg-v1-card inline-flex items-center gap-1.5 font-bold text-[15px] flex-none"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          {t('project.new.byName')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {members.map((m, idx) => (
          <span
            key={idx}
            className="h-11 inline-flex items-center gap-2 pl-1.5 pr-4 rounded-full bg-v1-accent-soft text-v1-accent-ink shadow-[inset_0_0_0_2px_var(--v1-accent)] font-semibold text-[15px]"
          >
            <Avatar name={m} index={idx} size="s" />
            {m}
            {idx > 0 && (
              <button
                type="button"
                onClick={() => handleRemoveMember(m)}
                aria-label={t('eventDetail.removeGuest', { name: m })}
                className="ml-1 text-v1-muted"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
      </div>

      {showMemberInput && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleAddMember();
          }}
        >
          <input
            type="text"
            autoFocus
            placeholder={t('eventNew.memberPlaceholder')}
            value={memberInput}
            onChange={(e) => setMemberInput(e.target.value)}
            className="flex-1 min-w-0 h-11 px-4 rounded-full bg-v1-card outline-none text-base font-semibold"
          />
          <button type="submit" className="h-11 px-4 rounded-full bg-v1-ink text-white font-bold">
            {t('eventNew.add')}
          </button>
        </form>
      )}

      {/* Быстрый выбор из сохранённых друзей (только локальный режим). */}
      {savedFriends.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {savedFriends.map((friend) => {
            const isAdded = members.includes(friend.name);
            return (
              <Chip key={friend.id} on={isAdded} onClick={() => handleToggleSavedFriend(friend.name)}>
                <span className="w-6 h-6 rounded-full overflow-hidden inline-flex items-center justify-center flex-shrink-0">
                  <MemberAvatar avatar={friend.avatar} />
                </span>
                {friend.name}
                {isAdded && <Check className="w-4 h-4" aria-hidden="true" />}
              </Chip>
            );
          })}
        </div>
      )}

      {multiUser && <p className="mt-2.5 text-[15px] leading-snug text-v1-muted">{t('eventNew.multiUserNote')}</p>}

      {createError && (
        <div className="mt-3">
          <Plaque kind="err" testId="create-error">
            {createError}
            {createdEventId && (
              <Link href={routes.eventDetail(createdEventId)} className="mt-2 block font-bold underline">
                {t('eventNew.openCreatedEvent')}
              </Link>
            )}
          </Plaque>
        </div>
      )}
    </V1Screen>
  );
}
