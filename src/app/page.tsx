'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getActiveSession, UserProfile, saveLocalSession } from '@/lib/supabase';
import { isMultiUser, joinWaitlist } from '@/lib/store';
import { useGroups } from '@/lib/data-hooks';
import { useI18n } from '@/lib/i18n/provider';
import { OnboardingTour } from '@/components/OnboardingTour';
import { LifeSituations } from '@/components/LifeSituations';
import QuickProfileEditor from '@/components/QuickProfileEditor';
import { isPhotoAvatar } from '@/lib/avatar';
import HomeFeed from '@/components/v1/HomeFeed';
import {
  ShieldCheck,
  Zap,
  Smartphone,
  Camera,
  ArrowRight,
  UserCheck,
  KeyRound,
  LogOut,
  Activity,
  Mail,
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { t } = useI18n();
  const { groups, error: loadError, refresh: refreshGroups } = useGroups();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const closeProfileEditor = useCallback(() => setProfileEditorOpen(false), []);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);

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

    // Результат записи больше не игнорируется. Раньше здесь стоял голый
    // `await joinWaitlist(...)`, после которого статус безусловно становился
    // 'success': без бэкенда или при ошибке RLS пользователь видел «Спасибо!»,
    // хотя его email никуда не попал. Это прямое нарушение инварианта
    // «ошибка не маскируется под успех» из AGENTS.md.
    const { error } = await joinWaitlist(waitlistEmail);

    if (error) {
      setWaitlistStatus('error');
      setWaitlistMsg(t('home.waitlistFailed', { error }));
      return;
    }

    setWaitlistStatus('success');
    setWaitlistMsg(t('home.waitlistSuccess'));

    // Автоскачивание APK убрано 2026-08-15.
    // Раздавалась debug-сборка (public/SplitIT-Beta.apk был байт в байт равен
    // SplitIT-debug.apk): подписана общеизвестным отладочным ключом, старше
    // сайта на день функциональности, версия не отличима от следующей.
    // Раздача сборок вернётся только release-подписью, с checksum и SHA —
    // задача P1-3 в todo.md.
  };

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

  if (!isLoaded) {
    // Заглушки той же формы, а не спиннер на весь экран (SCREENS-V1 §1).
    return (
      <div className="font-v1 bg-v1-bg -mx-4 -mt-4 px-4 pt-6 min-h-[50vh]" aria-label={t('home.loading')}>
        <div className="h-9 w-40 rounded-xl bg-v1-fill animate-pulse mb-4" />
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-card bg-v1-fill animate-pulse" />
          ))}
        </div>
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
          <div className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />
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
                  <Mail className="w-4 h-4" />
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

        {/* Жизненные ситуации: контент-блок для гостей (RU-тест) */}
        <LifeSituations />

        <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
          <Link href="/privacy" className="underline">Конфиденциальность</Link>
          {' · '}
          <Link href="/terms" className="underline">Условия</Link>
          {' · '}
          <Link href="/feedback" className="underline">Обратная связь</Link>
        </p>
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // AUTHENTICATED USER WORKSPACE FEED
  // ----------------------------------------------------------------------
    return (
      <>
      {!userProfile.has_completed_onboarding && (
        <OnboardingTour 
          onComplete={() => {
            setUserProfile(prev => prev ? { ...prev, has_completed_onboarding: true } : prev);
          }} 
        />
      )}
      {profileEditorOpen && (
        <QuickProfileEditor
          user={userProfile}
          onClose={closeProfileEditor}
          onSaved={(updated) => setUserProfile(updated)}
          returnFocusRef={avatarButtonRef}
        />
      )}
      {/* Лента V1: «Тебе должны / Ты должен» вместо зашитого «Баланс 0 ₽» (SCENARIOS-AUDIT §4 п. 4). */}
      <HomeFeed
        groups={groups}
        userId={userProfile.id}
        currency={userProfile.preferred_currency || 'RUB'}
        loadError={loadError}
        onRetry={() => void refreshGroups()}
        avatar={
          <div className="flex items-center gap-3 min-w-0">
          {/* Кто вошёл — виден на главной, как и раньше (e2e profile-avatar F3). */}
          <h2 className="text-base font-semibold text-v1-ink2 truncate">{userProfile.full_name}</h2>
          <button
            type="button"
            ref={avatarButtonRef}
            onClick={() => setProfileEditorOpen(true)}
            aria-label={t('quickProfile.open')}
            data-testid="home-avatar-button"
            className="w-14 h-14 rounded-full bg-v1-trip text-v1-ink font-extrabold grid place-items-center text-xl overflow-hidden focus:outline-none focus-visible:ring-[3px] focus-visible:ring-v1-accent"
          >
            {isPhotoAvatar(userProfile.avatar_url) ? (
              <img src={userProfile.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{userProfile.avatar_url || '👤'}</span>
            )}
          </button>
          </div>
        }
      />
    </>
  );
}
