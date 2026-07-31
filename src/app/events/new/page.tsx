'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plane, Home, Utensils, Sparkles, Check, UserPlus, X, Globe } from 'lucide-react';
import { CURRENCIES } from '@/lib/currency';
import { getSavedGroups, saveGroups, getActiveSession, UserProfile } from '@/lib/supabase';

export default function NewEventPage() {
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'trip' | 'restaurant' | 'home' | 'party' | 'other'>('trip');
  const [currency, setCurrency] = useState('RUB');
  const [memberInput, setMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>(['Вы']);

  useEffect(() => {
    getActiveSession().then((u) => {
      if (u) {
        setUserProfile(u);
        setMembers([u.full_name || 'Вы']);
        if (u.preferred_currency) setCurrency(u.preferred_currency);
      }
    });
  }, []);

  const categories = [
    { id: 'trip', label: 'Поездка / Путешествие', icon: Plane, color: 'text-blue-500 bg-blue-50' },
    { id: 'restaurant', label: 'Ресторан / Бары', icon: Utensils, color: 'text-amber-500 bg-amber-50' },
    { id: 'home', label: 'Совместное жилье', icon: Home, color: 'text-indigo-500 bg-indigo-50' },
    { id: 'party', label: 'Вечеринка / Праздник', icon: Sparkles, color: 'text-purple-500 bg-purple-50' },
  ];

  const handleAddMember = () => {
    if (memberInput.trim() && !members.includes(memberInput.trim())) {
      setMembers([...members, memberInput.trim()]);
      setMemberInput('');
    }
  };

  const handleRemoveMember = (nameToRemove: string) => {
    if (members.length > 1) {
      setMembers(members.filter((m) => m !== nameToRemove));
    }
  };

  const handleCreate = () => {
    const finalName = name.trim() || 'Поездка в Сочи 2026';

    const newGroupId = 'group-sochi-2026';
    const newGroup = {
      id: newGroupId,
      name: finalName,
      category,
      currency,
      createdBy: userProfile?.id || 'user-me',
      createdAt: new Date().toISOString(),
      members: members.map((mName, idx) => ({
        id: `member-${idx}-${Date.now()}`,
        name: mName,
        avatar: idx === 0 ? (userProfile?.avatar_url || '👑') : '👤',
        phone: '',
        email: '',
        role: idx === 0 ? 'owner' : 'member',
      })),
      expenses: [],
      settlements: [],
    };

    const existingGroups = getSavedGroups().filter(g => g.id !== newGroupId);
    saveGroups([newGroup, ...existingGroups]);
    router.push('/');
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link href="/" className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 text-base">Создание события</h2>
        <div className="w-9" />
      </div>

      <div className="space-y-5">
        {/* Event Name Card */}
        <div className="stitch-card p-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Название события или группы
          </label>
          <input
            type="text"
            required
            placeholder="Например: Алтай 2026, Ресторан, Аренда Дома"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Category Choice */}
        <div className="stitch-card p-5 space-y-3">
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
                      ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cat.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Currency Selection */}
        <div className="stitch-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-blue-500" />
              <span>Базовая валюта группы</span>
            </label>
          </div>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {Object.values(CURRENCIES).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name} ({c.symbol})
              </option>
            ))}
          </select>
        </div>

        {/* Members Management */}
        <div className="stitch-card p-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Участники события ({members.length})
          </label>

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
              className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              type="button"
              onClick={handleAddMember}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Добавить</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            {members.map((m, idx) => (
              <span
                key={idx}
                className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 text-xs font-semibold flex items-center gap-1.5 border border-slate-200/80"
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
        <button
          id="btn-create-event"
          type="button"
          onClick={handleCreate}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98"
        >
          Создать событие и перейти
        </button>
      </div>
    </div>
  );
}
