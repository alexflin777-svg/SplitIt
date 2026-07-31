'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatMoney } from '@/lib/currency';
import { getActiveSession, getSavedGroups, subscribeToRealtimeSync, UserProfile } from '@/lib/supabase';
import {
  Plus,
  Plane,
  Home,
  Utensils,
  Sparkles,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight,
  TrendingUp,
  Search,
  Users,
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [groups, setGroups] = useState<any[]>(() => getSavedGroups());
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    // Synchronize groups state on mount
    setGroups(getSavedGroups());

    // Check active session - redirect to auth if not logged in
    getActiveSession().then((user) => {
      if (user) {
        setUserProfile(user);
        setGroups(getSavedGroups());
      } else {
        router.push('/auth');
      }
    });

    const handleProfileChanged = () => {
      getActiveSession().then((user) => {
        if (user) setUserProfile(user);
        setGroups(getSavedGroups());
      });
    };
    window.addEventListener('splitit_profile_changed', handleProfileChanged);

    // Subscribe to cross-tab / multi-user realtime sync
    const unsubscribe = subscribeToRealtimeSync(() => {
      setGroups(getSavedGroups());
    });

    return () => {
      window.removeEventListener('splitit_profile_changed', handleProfileChanged);
      unsubscribe();
    };
  }, [router]);

  const categoryIcons: Record<string, any> = {
    trip: <Plane className="w-5 h-5 text-blue-500" />,
    home: <Home className="w-5 h-5 text-indigo-500" />,
    restaurant: <Utensils className="w-5 h-5 text-amber-500" />,
    party: <Sparkles className="w-5 h-5 text-purple-500" />,
    other: <Sparkles className="w-5 h-5 text-emerald-500" />,
  };

  const filteredGroups = groups.filter((g) => {
    const matchesCategory = filterCategory === 'all' || g.category === filterCategory;
    const matchesSearch = g.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const totalSpent = groups.reduce((acc, g) => {
    const groupSum = (g.expenses || []).reduce((eAcc: number, e: any) => eAcc + (e.amountInGroupCurrency || e.amount || 0), 0);
    return acc + groupSum;
  }, 0);

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1 pb-24">
      {/* User Greeting Bar */}
      {userProfile && (
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 font-extrabold flex items-center justify-center text-lg overflow-hidden">
              {userProfile.avatar_url && userProfile.avatar_url.startsWith('data:image') ? (
                <img src={userProfile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{userProfile.avatar_url || '👤'}</span>
              )}
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Активный профиль
              </span>
              <h3 className="font-extrabold text-slate-900 text-sm">{userProfile.full_name}</h3>
            </div>
          </div>
          <Link
            href="/auth"
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
          >
            Сменить
          </Link>
        </div>
      )}

      {/* Top User Financial Overview Card */}
      <div className="stitch-card p-5 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-36 h-36 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Общие расходы по событиям
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight mt-0.5 text-white">
              {formatMoney(totalSpent, userProfile?.preferred_currency || 'RUB')}
            </h2>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
            <div>
              <span className="block text-[11px] text-slate-400 font-medium">Активных групп</span>
              <span className="text-sm font-bold text-emerald-400">{groups.length}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div>
              <span className="block text-[11px] text-slate-400 font-medium">Баланс</span>
              <span className="text-sm font-bold text-amber-400">0 ₽</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Category Filter Bar */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Поиск событий или групп..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all placeholder:text-slate-400 shadow-sm"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'all', label: 'Все события' },
            { id: 'trip', label: 'Поездки' },
            { id: 'home', label: 'Дом' },
            { id: 'restaurant', label: 'Рестораны' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                filterCategory === cat.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events List Header */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
          <span>Мои группы и события</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-extrabold">
            {filteredGroups.length}
          </span>
        </h3>
        <Link
          href="/events/new"
          className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <span>Создать</span>
          <Plus className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Group List Feed or Clean Empty State */}
      {filteredGroups.length > 0 ? (
        <div className="space-y-3">
          {filteredGroups.map((group) => {
            const expenseCount = (group.expenses || []).length;
            const groupSum = (group.expenses || []).reduce((acc: number, e: any) => acc + (e.amountInGroupCurrency || e.amount || 0), 0);

            return (
              <Link
                key={group.id}
                href={`/events/${group.id}`}
                className="stitch-card p-4 flex items-center justify-between hover:border-blue-300 transition-all block"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                    {categoryIcons[group.category] || categoryIcons.trip}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">{group.name}</h4>
                    <p className="text-xs text-slate-500 font-medium flex items-center gap-1">
                      <Users className="w-3 h-3 text-slate-400" />
                      <span>{group.members?.length || 1} участн.</span>
                      <span>•</span>
                      <span>{expenseCount} расходов</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-right">
                  <div>
                    <span className="block font-extrabold text-slate-900 text-sm">
                      {formatMoney(groupSum, group.currency || 'RUB')}
                    </span>
                    <span className="text-[10px] text-blue-600 font-semibold">Открыть ➔</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 stitch-card bg-white space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center shadow-xs">
            <Sparkles className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h4 className="font-extrabold text-slate-900 text-base">
              {userProfile ? `Добро пожаловать, ${userProfile.full_name}!` : 'Нет активных событий'}
            </h4>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              Создайте первое совместное событие (поездку, ресторан или совместное жилье) для разделения расходов с друзьями.
            </p>
          </div>
          
          <div className="pt-2 flex flex-col gap-2 max-w-xs mx-auto">
            <Link
              href="/events/new"
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Создать первое событие</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
