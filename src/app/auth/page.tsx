'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, CheckCircle2, ArrowRight, User, Sparkles, Camera, ShieldCheck, AlertTriangle, Info } from 'lucide-react';
import { signUpUser, signInUser, signInWithGoogle, resetPassword, updatePassword, getActiveSession, saveLocalSession, UserProfile } from '@/lib/supabase';
import { getConfigProblem } from '@/lib/env';
import { processAvatarFile } from '@/lib/avatar';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';

type AuthMode = 'register' | 'login' | 'reset' | 'update-password';

const AUTH_MODES: AuthMode[] = ['register', 'login', 'reset', 'update-password'];

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  // Раньше режим всегда стартовал с 'register', а query-строка не читалась
  // вовсе: ссылка /auth?mode=login открывала форму регистрации.
  const requestedMode = searchParams.get('mode');
  const initialMode: AuthMode = AUTH_MODES.includes(requestedMode as AuthMode)
    ? (requestedMode as AuthMode)
    : 'register';

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('👤');
  const [customAvatarPreview, setCustomAvatarPreview] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const presetAvatars = ['👤', '👨‍💻', '👩‍🎨', '🦊', '🚀', '🐱', '🐼', '🕶️'];
  const configProblem = getConfigProblem();

  useEffect(() => {
    // Check existing session
    getActiveSession().then((user) => {
      if (user) {
        setStatusMessage(t('auth.loggedInAs', { name: user.full_name || user.email }));
      }
    });

    // Detect Telegram WebApp
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      if (tg.initDataUnsafe?.user) {
        if (!getConfigProblem()) {
          setErrorMessage(t('auth.telegramNotConfigured'));
          return;
        }
        const tgUser = tg.initDataUnsafe.user;
        const profile: UserProfile = {
          id: 'tg-' + tgUser.id,
          email: `${tgUser.username || 'tg_' + tgUser.id}@telegram.org`,
          full_name: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || 'Telegram User',
          avatar_url: '📱',
        };
        saveLocalSession(profile);
        setStatusMessage(t('auth.telegramWebApp', { name: tgUser.username || tgUser.first_name }));
        setTimeout(() => router.push('/'), 1000);
      }
    }
  }, [router, t]);

  const handleAvatarFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);

    // Изображение проверяется и сжимается до записи — иначе фото с телефона
    // пробивает квоту localStorage и обрывает регистрацию без объяснений.
    const { dataUrl, error } = await processAvatarFile(file);
    if (error || !dataUrl) {
      setErrorMessage(error ?? t('auth.avatarProcessError'));
      e.target.value = '';
      return;
    }
    setCustomAvatarPreview(dataUrl);
    setAvatarUrl(dataUrl);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    // Ошибка каждой ветки доходит до пользователя. Раньше результат просто
    // игнорировался: провал и успех выглядели одинаково, а вход пускал кого
    // угодно под любым email.
    if (mode === 'register') {
      const selectedAvatar = customAvatarPreview || avatarUrl;
      const { data, error, requiresEmailConfirmation } = await signUpUser(
        email,
        password,
        fullName || t('auth.defaultUserName'),
        selectedAvatar,
      );
      setLoading(false);
      if (error || !data) {
        setErrorMessage(error ?? t('auth.errorRegisterFailed'));
        return;
      }
      if (requiresEmailConfirmation) {
        setStatusMessage(t('auth.confirmEmailPrompt', { name: data.full_name }));
        setMode('login');
        return;
      }
      setStatusMessage(t('auth.registerSuccess', { name: data.full_name }));
      setTimeout(() => router.push(getSafeReturnPath(searchParams.get('next'))), 800);
    } else if (mode === 'login') {
      const { data, error } = await signInUser(email, password);
      setLoading(false);
      if (error || !data) {
        setErrorMessage(error ?? t('auth.errorSignInFailed'));
        return;
      }
      setStatusMessage(t('auth.welcomeBack', { name: data.full_name }));
      setTimeout(() => router.push(getSafeReturnPath(searchParams.get('next'))), 800);
    } else if (mode === 'reset') {
      const res = await resetPassword(email);
      setLoading(false);
      if (!res.success) {
        setErrorMessage(res.message);
        return;
      }
      setStatusMessage(res.message);
    } else if (mode === 'update-password') {
      if (password !== passwordConfirmation) {
        setLoading(false);
        setErrorMessage(t('auth.passwordsMismatch'));
        return;
      }
      const res = await updatePassword(password);
      setLoading(false);
      if (!res.success) {
        setErrorMessage(res.message);
        return;
      }
      setStatusMessage(res.message);
      setPassword('');
      setPasswordConfirmation('');
      setMode('login');
    }
  };

  const handleGuestLogin = () => {
    if (!configProblem) {
      setErrorMessage(t('auth.demoOnlyLocal'));
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    const guestUser: UserProfile = {
      id: 'guest-' + Date.now(),
      email: 'guest@splitit.app',
      full_name: t('auth.demoAccountName'),
      avatar_url: customAvatarPreview || avatarUrl || '👤',
    };
    const saveError = saveLocalSession(guestUser);
    if (saveError) {
      setLoading(false);
      setErrorMessage(saveError);
      return;
    }
    setStatusMessage(t('auth.loggedInAsDemo'));
    setTimeout(() => router.push(routes.home()), 600);
  };

  return (
    <div className="space-y-4 max-w-md mx-auto px-1 pb-24">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white font-extrabold text-xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20 overflow-hidden">
          {customAvatarPreview ? (
            <img src={customAvatarPreview} alt="Avatar" className="w-full h-full object-cover rounded-2xl" />
          ) : (
            <span>S</span>
          )}
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          {mode === 'login' && t('auth.headerLogin')}
          {mode === 'register' && t('auth.headerRegister')}
          {mode === 'reset' && t('auth.headerReset')}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
          {configProblem
            ? t('auth.descConfigured')
            : t('auth.descBackend')}
        </p>
      </div>

      {/* Конфигурация окружения: отсутствие бэкенда должно быть видно, а не
          подменяться тихим локальным режимом. */}
      {configProblem && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2 font-medium">
          <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{configProblem}</span>
        </div>
      )}

      {/* Status Message */}
      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2 font-bold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="auth-error"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2 font-bold animate-in fade-in"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Mode Selector Tabs */}
      <div className="stitch-card p-1.5 flex items-center bg-slate-100/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setMode('register')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
            mode === 'register' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          }`}
        >
          {t('auth.tab.register')}
        </button>
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
            mode === 'login' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          }`}
        >
          {t('auth.tab.login')}
        </button>
        <button
          type="button"
          onClick={() => setMode('reset')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
            mode === 'reset' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          }`}
        >
          {t('auth.tab.reset')}
        </button>
      </div>

      {/* Auth Form with Aligned Input Fields */}
      <form onSubmit={handleSubmit} className="stitch-card p-5 space-y-4 bg-white dark:bg-slate-800">
        {mode === 'login' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={async () => {
                const res = await signInWithGoogle();
                if (res.error) setErrorMessage(res.error);
              }}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-sm transition-all hover:bg-slate-50 hover:border-slate-300"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>{t('auth.googleLogin')}</span>
            </button>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-slate-400 font-medium">{t('auth.orEmail')}</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        )}

        {mode === 'register' && (
          <>
            {/* Avatar Picker & Upload */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                {t('auth.avatarLabel')}
              </label>
              
              <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                {presetAvatars.map((av) => (
                  <button
                    key={av}
                    type="button"
                    onClick={() => {
                      setAvatarUrl(av);
                      setCustomAvatarPreview(null);
                    }}
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center text-base flex-shrink-0 transition-all ${
                      avatarUrl === av && !customAvatarPreview
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/50 ring-2 ring-blue-500/20'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    {av}
                  </button>
                ))}

                <label className="w-9 h-9 rounded-xl border border-dashed border-blue-400 bg-blue-50/50 dark:bg-blue-900/30 hover:bg-blue-100/50 flex items-center justify-center text-blue-600 dark:text-blue-400 cursor-pointer flex-shrink-0 transition-all" title={t('auth.uploadPhotoTitle')}>
                  <Camera className="w-4 h-4" />
                  <input type="file" accept="image/*" onChange={handleAvatarFileUpload} className="hidden" />
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('auth.nameLabel')}</label>
              <div className="relative flex items-center">
                <User className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  required
                  placeholder={t('auth.namePlaceholder')}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
            </div>
          </>
        )}

        {mode !== 'update-password' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('auth.emailLabel')}</label>
            <div className="relative flex items-center">
              <Mail className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
              <input type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
        )}

        {mode !== 'reset' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('auth.passwordLabel')}</label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
        )}

        {mode === 'update-password' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('auth.confirmPasswordLabel')}</label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
              <input type="password" required value={passwordConfirmation} onChange={(e) => setPasswordConfirmation(e.target.value)} className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
        >
          <span>
            {loading
              ? t('auth.submit.processing')
              : mode === 'register'
              ? t('auth.submit.register')
              : mode === 'login'
              ? t('auth.submit.login')
              : mode === 'reset'
              ? t('auth.submit.reset')
              : t('auth.submit.updatePassword')}
          </span>
          <ArrowRight className="w-4 h-4" />
        </button>

        {/* Локальный демо-профиль нельзя смешивать с настоящей Supabase-сессией. */}
        {configProblem && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              onClick={handleGuestLogin}
              className="w-full h-10 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition-all"
            >
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>{t('auth.quickDemoLogin')}</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function getSafeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return routes.home();
  return value;
}

/**
 * useSearchParams требует Suspense-границы при output: 'export' — без неё
 * Next не может собрать страницу статически.
 */
export default function AuthPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-xs font-bold text-slate-400">Loading…</div>}
    >
      <AuthForm />
    </Suspense>
  );
}
