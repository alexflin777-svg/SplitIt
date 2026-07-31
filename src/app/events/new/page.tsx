'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plane, Home, Utensils, Sparkles, Check, UserPlus, X, Globe, Users } from 'lucide-react';
import { CURRENCIES } from '@/lib/currency';
import { getActiveSession, getSavedFriends, UserProfile } from '@/lib/supabase';
import { createGroup, isMultiUser } from '@/lib/store';
import { routes } from '@/lib/routes';

export default function NewEventPage() {
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'trip' | 'restaurant' | 'home' | 'party' | 'other'>('trip');
  const [currency, setCurrency] = useState('RUB');
  const [memberInput, setMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>(['Вы']);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [savedFriends, setSavedFriends] = useState<any[]>([]);

  useEffect(() => {
    getActiveSession().then((u) => {
      if (u) {
        setUserProfile(u);
        setMembers([u.full_name || 'Вы']);
        if (u.preferred_currency) setCurrency(u.preferred_currency);
      }
    });

    setSavedFriends(getSavedFriends());
  }, []);

  const categories = [
    { id: 'trip', label: 'Поездка / Путешествие', icon: Plane, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/60' },
    { id: 'restaurant', label: 'Ресторан / Бары', icon: Utensils, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/60' },
    { id: 'home', label: 'Совместное жилье', icon: Home, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/60' },
    { id: 'party', label: 'Вечеринка / Праздник', icon: Sparkles, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/60' },
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
      name: name.trim() || 'Новое событие',
      category,
      currency,
      memberNames: members,
    });

    setIsCreating(false);
    if (error || !data) {
      setCreateError(error ?? 'Не удалось создать событие');
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
        <h2 className="font-extrabold text-slate-900 dark:text-white text-base">Создание события</h2>
        <div className="w-9" />
      </div>

      <div className="space-y-5">
        {/* Event Name Card */}
        <div className="stitch-card p-5 space-y-3 bg-white dark:bg-slate-800">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Название события или группы
          </label>
          <input
            type="text"
            required
            placeholder="Например: Алтай 2026, Ресторан, Аренда Дома"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Category Choice */}
        <div className="stitch-card p-5 space-y-3 bg-white dark:bg-slate-800">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Категория события
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
              <span>Базовая валюта группы</span>
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

        {/* Members Management */}
        <div className="stitch-card p-5 space-y-4 bg-white dark:bg-slate-800">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            Участники события ({members.length})
          </label>

          {/* Quick Friend Selection Chips */}
          {savedFriends.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-blue-500" />
                <span>Быстрый выбор из сохраненных друзей:</span>
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
              placeholder="Имя участника..."
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
              <span>Добавить</span>
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
          </div>
        )}

        {isMultiUser() && (
          <p className="text-[11px] text-slate-500 mb-3">
            Событие общее: участники присоединяются по ссылке-приглашению, которую вы отправите
            после создания.
          </p>
        )}

        <button
          id="btn-create-event"
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98"
        >
          {isCreating ? 'Создаём…' : 'Создать событие и перейти'}
        </button>
      </div>
    </div>
  );
}
