'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatMoney, convertCurrency } from '@/lib/currency';
import { getActiveSession, UserProfile, saveLocalSession } from '@/lib/supabase';
import { listGroups, isMultiUser, joinWaitlist } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
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
  ShieldCheck,
  Zap,
  Smartphone,
  Camera,
  ArrowRight,
  UserCheck,
  KeyRound,
  LogOut,
  Activity,
  Download,
} from 'lucide-react';
import { routes } from '@/lib/routes';

export default function HomePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [groups, setGroups] = useState<any[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Waitlist State
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [waitlistMsg, setWaitlistMsg] = useState('');

  const handleJoinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistEmail || !waitlistEmail.includes('@')) {
      setWaitlistStatus('error');
      setWaitlistMsg(t('home.waitlistError'));
      return;
    }
    setWaitlistStatus('loading');
    
    // Save to DB
    await joinWaitlist(waitlistEmail);
    
    setWaitlistStatus('success');
    setWaitlistMsg(t('home.waitlistSuccess'));
    
    // Trigger APK download
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = '/SplitIT-Beta.apk';
      a.download = 'SplitIT-Beta.apk';
      a.click();
    }, 1500);
  };

  const refreshGroups = useCallback(async () => {
    const { data, error } = await listGroups();
    setLoadError(error);
    setGroups(data ?? []);
  }, []);

  useEffect(() => {
    // Check active user session
    getActiveSession().then((user) => {
      setUserProfile(user);
      if (user) {
        void refreshGroups();
      }
      setIsLoaded(true);
    });

    const handleProfileChanged = () => {
      getActiveSession().then((user) => {
        setUserProfile(user);
        if (user) void refreshGroups();
      });
    };
    window.addEventListener('splitit_profile_changed', handleProfileChanged);

    // Список перечитывается при возврате на вкладку. Подписка на изменения
    // конкретного события живёт на его экране: здесь она дала бы поток
    // событий по всем группам сразу.
    const onFocus = () => {
      void refreshGroups();
      getActiveSession().then((user) => setUserProfile(user));
    };
    window.addEventListener('focus', onFocus);
    const unsubscribe = () => window.removeEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('splitit_profile_changed', handleProfileChanged);
      unsubscribe();
    };
  }, [refreshGroups]);

  const handleDemoLogin = () => {
    if (isMultiUser()) return;
    const demoUser: UserProfile = {
      id: 'demo-user-' + Date.now(),
      email: 'demo@splitit.app',
      full_name: 'Demo User',
      avatar_url: '👨‍💻',
      preferred_currency: 'RUB',
    };
    saveLocalSession(demoUser);
    setUserProfile(demoUser);
    void refreshGroups();
  };

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
    const { convertedAmount } = convertCurrency(groupSum, g.currency || 'RUB', userProfile?.preferred_currency || 'RUB');
    return acc + convertedAmount;
  }, 0);

  if (!isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500 font-semibold">{t('home.loading')}</p>
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // WELCOME LANDING SCREEN (If no user is logged in)
  // ----------------------------------------------------------------------
  if (!userProfile) {
    return (
      <div className="space-y-6 max-w-md mx-auto px-1 pb-28 animate-in fade-in duration-300">
        {/* Welcome Banner Card */}
        <div className="stitch-card p-6 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-900 text-white shadow-xl relative overflow-hidden text-center space-y-4">
          <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center mx-auto shadow-inner text-3xl">
            🤝
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold tracking-tight leading-tight">
              {t('home.welcomeHeadline')}
            </h1>
            <p className="text-xs text-blue-100/90 max-w-xs mx-auto leading-relaxed">
              {isMultiUser()
                ? t('home.welcomeBodyMultiUser')
                : t('home.welcomeBodyLocal')}
            </p>
          </div>

          {/* Welcome Action Buttons */}
          <div className="pt-2 space-y-2.5 max-w-xs mx-auto">
            <form onSubmit={handleJoinWaitlist} className="w-full flex flex-col sm:flex-row gap-2 mt-4">
              <input 
                type="email" 
                value={waitlistEmail}
                onChange={e => setWaitlistEmail(e.target.value)}
                placeholder={t('home.waitlistPlaceholder')}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-500 shadow-sm"
              />
              <button
                type="submit"
                disabled={waitlistStatus === 'loading' || waitlistStatus === 'success'}
                className="w-full sm:w-auto py-3 px-5 rounded-xl bg-blue-600 text-white text-sm font-extrabold shadow-md shadow-blue-500/30 transition-all hover:bg-blue-700 active:scale-98 disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {waitlistStatus === 'loading' ? (
                  <Activity className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>{t('home.joinWaitlistBtn')}</span>
              </button>
            </form>

            {waitlistStatus === 'success' && (
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 text-center w-full mt-2">
                {waitlistMsg}
              </p>
            )}
            {waitlistStatus === 'error' && (
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400 text-center w-full mt-2">
                {waitlistMsg}
              </p>
            )}

            <Link
              href="/auth?mode=login"
              className="w-full py-3 rounded-xl border border-white/20 bg-blue-800/80 text-white text-sm font-bold text-center mt-3 shadow-xs transition-all hover:bg-blue-800"
            >
              {t('home.signIn')}
            </Link>
          </div>
        </div>

        {/* Key Features Cards */}
        <div className="space-y-3">
          <h3 className="font-extrabold text-slate-900 dark:text-white text-sm">
            {t('home.featuresTitle')}
          </h3>

          <div className="grid grid-cols-1 gap-2.5">
            <div className="stitch-card p-3.5 flex items-start gap-3 bg-white dark:bg-slate-800">
              <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">
                  {t('home.feature.sync.title')}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {isMultiUser()
                    ? t('home.feature.sync.bodyMultiUser')
                    : t('home.feature.sync.bodyLocal')}
                </p>
              </div>
            </div>

            <div className="stitch-card p-3.5 flex items-start gap-3 bg-white dark:bg-slate-800">
              <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">
                  {t('home.feature.ocr.title')}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('home.feature.ocr.body')}
                </p>
              </div>
            </div>

            <div className="stitch-card p-3.5 flex items-start gap-3 bg-white dark:bg-slate-800">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">
                  {t('home.feature.native.title')}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('home.feature.native.body')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // AUTHENTICATED USER WORKSPACE FEED
  // ----------------------------------------------------------------------
    return (
      <div className="space-y-5 max-w-md mx-auto px-1 pb-28">
      {/* User Greeting Bar */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-extrabold flex items-center justify-center text-lg overflow-hidden border border-blue-200/50">
            {userProfile.avatar_url && userProfile.avatar_url.startsWith('data:image') ? (
              <img src={userProfile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span>{userProfile.avatar_url || '👤'}</span>
            )}
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider block">
              {t('home.loggedInAs')}
            </span>
            <h3 className="font-extrabold text-slate-900 dark:text-white text-sm">{userProfile.full_name}</h3>
          </div>
        </div>
        <Link
          href="/auth"
          className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all"
        >
          {t('home.switchProfile')}
        </Link>
      </div>

      {/* Top User Financial Overview Card */}
      <div className="stitch-card p-5 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-36 h-36 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {t('home.totalSpentLabel')}
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
              <span className="block text-[11px] text-slate-400 font-medium">{t('home.activeGroups')}</span>
              <span className="text-sm font-bold text-emerald-400">{groups.length}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div>
              <span className="block text-[11px] text-slate-400 font-medium">{t('home.balance')}</span>
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
            placeholder={t('home.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all placeholder:text-slate-400 shadow-sm"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'all', label: t('home.filter.all') },
            { id: 'trip', label: t('home.filter.trip') },
            { id: 'home', label: t('home.filter.home') },
            { id: 'restaurant', label: t('home.filter.restaurant') },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                filterCategory === cat.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events List Header */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
          <span>{t('home.myGroups')}</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-extrabold">
            {filteredGroups.length}
          </span>
        </h3>
        <Link
          href={routes.eventNew()}
          className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1"
        >
          <span>{t('home.create')}</span>
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
                href={routes.eventDetail(group.id)}
                className="stitch-card p-4 flex items-center justify-between hover:border-blue-300 transition-all block bg-white dark:bg-slate-800"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center">
                    {categoryIcons[group.category] || categoryIcons.trip}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">{group.name}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
                      <Users className="w-3 h-3 text-slate-400" />
                      <span>{t('home.membersCount', { count: group.members?.length || 1 })}</span>
                      <span>•</span>
                      <span>{t('home.expensesCount', { count: expenseCount })}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-right">
                  <div>
                    <span className="block font-extrabold text-slate-900 dark:text-white text-sm">
                      {formatMoney(groupSum, group.currency || 'RUB')}
                    </span>
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">{t('home.openEvent')}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 stitch-card bg-white dark:bg-slate-800 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 mx-auto flex items-center justify-center shadow-xs">
            <Sparkles className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h4 className="font-extrabold text-slate-900 dark:text-white text-base">
              {t('home.noEventsTitle')}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
              {t('home.noEventsBody')}
            </p>
          </div>
          
          <div className="pt-2 flex flex-col gap-2 max-w-xs mx-auto">
            <Link
              href={routes.eventNew()}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{t('home.createEvent')}</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
