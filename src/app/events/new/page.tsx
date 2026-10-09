'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plane, Home, Utensils, Sparkles, Check, UserPlus, X, Globe, Users } from 'lucide-react';
import { CURRENCIES } from '@/lib/currency';
import { getActiveSession, UserProfile } from '@/lib/supabase';
import { useSavedFriends } from '@/lib/data-hooks';
import { createGroup, isMultiUser } from '@/lib/store';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';

export default function NewEventPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'trip' | 'restaurant' | 'home' | 'party' | 'other'>('trip');
  const [currency, setCurrency] = useState('RUB');
  const [memberInput, setMemberInput] = useState('');
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
    router.push(routes.eventDetail(data.id));
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1 pb-24">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link href="/" className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition-all shadow-xs">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 dark:text-white text-base">{t('eventNew.title')}</h2>
        <div className="w-9" />
      </div>

      <div className="space-y-5">
        {/* Event Name Card */}
        <div className="stitch-card p-5 space-y-3 bg-white dark:bg-slate-800">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('eventNew.nameLabel')}
          </label>
          <input
            type="text"
            required
            placeholder={t('eventNew.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Category Choice */}
        <div className="stitch-card p-5 space-y-3 bg-white dark:bg-slate-800">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('eventNew.categoryLabel')}
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isSelected = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id as any)}
                  className={`p-3 rounded-xl border text-left flex items-center gap-3 transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/60 ring-2 ring-blue-500/20'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cat.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Currency Selection */}
        <div className="stitch-card p-5 space-y-3 bg-white dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-blue-500" />
              <span>{t('eventNew.currency')}</span>
            </label>
          </div>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {Object.values(CURRENCIES).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name} ({c.symbol})
              </option>
            ))}
          </select>
        </div>

        {/* В сетевом режиме имена становятся гостями события (group_participants),
            люди с аккаунтом присоединяются по приглашению. */}
          <div className="stitch-card p-5 space-y-4 bg-white dark:bg-slate-800">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            {t('eventNew.membersLabel', { count: members.length })}
          </label>

          {/* Quick Friend Selection Chips */}
          {savedFriends.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-blue-500" />
                <span>{t('eventNew.quickPickFriends')}</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {savedFriends.map((friend) => {
                  const isAdded = members.includes(friend.name);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => handleToggleSavedFriend(friend.name)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                        isAdded
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <span>{friend.avatar || '👤'}</span>
                      <span>{friend.name}</span>
                      {isAdded && <Check className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={t('eventNew.memberPlaceholder')}
              value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddMember();
                }
              }}
              className="flex-1 h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              type="button"
              onClick={handleAddMember}
              className="px-4 h-11 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{t('eventNew.add')}</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {members.map((m, idx) => (
              <span
                key={idx}
                className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-extrabold flex items-center gap-1.5 border border-slate-200/80 dark:border-slate-600"
              >
                <span>{m}</span>
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(m)}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
          </div>

        {/* Action Button */}
        {createError && (
          <div
            role="alert"
            data-testid="create-error"
            className="p-3 mb-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold"
          >
            {createError}
            {createdEventId && (
              <Link
                href={routes.eventDetail(createdEventId)}
                className="mt-2 block text-center px-3 py-2 rounded-lg bg-white border border-rose-200 text-rose-800"
              >
                {t('eventNew.openCreatedEvent')}
              </Link>
            )}
          </div>
        )}

        {multiUser && (
          <div className="stitch-card p-4 bg-blue-50 border-blue-200 text-[11px] text-blue-900 mb-3">
            {t('eventNew.multiUserNote')}
          </div>
        )}

        <button
          id="btn-create-event"
          type="button"
          onClick={handleCreate}
          disabled={isCreating || createdEventId !== null}
          className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98"
        >
          {isCreating ? t('eventNew.creating') : t('eventNew.createAndOpen')}
        </button>
      </div>
    </div>
  );
}
