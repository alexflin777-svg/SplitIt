'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, CheckCircle2, ArrowRight, User, Sparkles, Camera, ShieldCheck, AlertTriangle, Info } from 'lucide-react';
import { signUpUser, signInUser, resetPassword, updatePassword, getActiveSession, saveLocalSession, UserProfile } from '@/lib/supabase';
import { getConfigProblem } from '@/lib/env';
import { processAvatarFile } from '@/lib/avatar';
import { routes } from '@/lib/routes';

type AuthMode = 'register' | 'login' | 'reset' | 'update-password';

const AUTH_MODES: AuthMode[] = ['register', 'login', 'reset', 'update-password'];

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

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
        setStatusMessage(`Вы вошли как ${user.full_name || user.email}`);
      }
    });

    // Detect Telegram WebApp
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      if (tg.initDataUnsafe?.user) {
        if (!getConfigProblem()) {
          setErrorMessage('Вход через Telegram для общего пространства пока не настроен. Используйте email и пароль.');
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
        setStatusMessage(`Telegram WebApp: @${tgUser.username || tgUser.first_name}`);
        setTimeout(() => router.push('/'), 1000);
      }
    }
  }, [router]);

  const handleAvatarFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);

    // Изображение проверяется и сжимается до записи — иначе фото с телефона
    // пробивает квоту localStorage и обрывает регистрацию без объяснений.
    const { dataUrl, error } = await processAvatarFile(file);
    if (error || !dataUrl) {
      setErrorMessage(error ?? 'Не удалось обработать изображение');
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
        fullName || 'Пользователь',
        selectedAvatar,
      );
      setLoading(false);
      if (error || !data) {
        setErrorMessage(error ?? 'Не удалось зарегистрировать аккаунт');
        return;
      }
      if (requiresEmailConfirmation) {
        setStatusMessage(`Аккаунт ${data.full_name} создан. Подтвердите email, затем войдите.`);
        setMode('login');
        return;
      }
      setStatusMessage(`Аккаунт ${data.full_name} успешно зарегистрирован!`);
      setTimeout(() => router.push(getSafeReturnPath(searchParams.get('next'))), 800);
    } else if (mode === 'login') {
      const { data, error } = await signInUser(email, password);
      setLoading(false);
      if (error || !data) {
        setErrorMessage(error ?? 'Не удалось войти');
        return;
      }
      setStatusMessage(`С возвращением, ${data.full_name}!`);
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
        setErrorMessage('Пароли не совпадают');
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
      setErrorMessage('Демо-вход доступен только в локальном режиме. Для общего пространства войдите через Supabase.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    const guestUser: UserProfile = {
      id: 'guest-' + Date.now(),
      email: 'guest@splitit.app',
      full_name: 'Демо Аккаунт',
      avatar_url: customAvatarPreview || avatarUrl || '👤',
    };
    const saveError = saveLocalSession(guestUser);
    if (saveError) {
      setLoading(false);
      setErrorMessage(saveError);
      return;
    }
    setStatusMessage('Вы вошли под демо-профилем');
    setTimeout(() => router.push(routes.home()), 600);
  };

  return (
    <div className="space-y-4 max-w-md mx-auto px-1">
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
          {mode === 'login' && 'Вход в ваш профиль'}
          {mode === 'register' && 'Регистрация аккаунта'}
          {mode === 'reset' && 'Восстановление пароля'}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
          {configProblem
            ? 'Аккаунт хранится на этом устройстве. Синхронизация между устройствами появится, когда будет подключён бэкенд.'
            : 'Авторизуйтесь на любых 2х и более устройствах для мгновенной синхронизации расходов без конфликтов.'}
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
          Регистрация
        </button>
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
            mode === 'login' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          }`}
        >
          Вход
        </button>
        <button
          type="button"
          onClick={() => setMode('reset')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
            mode === 'reset' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          }`}
        >
          Сброс пароля
        </button>
      </div>

      {/* Auth Form with Aligned Input Fields */}
      <form onSubmit={handleSubmit} className="stitch-card p-5 space-y-4 bg-white dark:bg-slate-800">
        {mode === 'register' && (
          <>
            {/* Avatar Picker & Upload */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Выбор или загрузка аватара
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

                <label className="w-9 h-9 rounded-xl border border-dashed border-blue-400 bg-blue-50/50 dark:bg-blue-900/30 hover:bg-blue-100/50 flex items-center justify-center text-blue-600 dark:text-blue-400 cursor-pointer flex-shrink-0 transition-all" title="Загрузить свое фото">
                  <Camera className="w-4 h-4" />
                  <input type="file" accept="image/*" onChange={handleAvatarFileUpload} className="hidden" />
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Ваше имя или никнейм</label>
              <div className="relative flex items-center">
                <User className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  required
                  placeholder="Иван Иванов"
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
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Электронная почта (Email)</label>
            <div className="relative flex items-center">
              <Mail className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
              <input type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
        )}

        {mode !== 'reset' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Пароль</label>
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
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Повторите новый пароль</label>
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
              ? 'Обработка...'
              : mode === 'register'
              ? 'Зарегистрироваться и Войти'
              : mode === 'login'
              ? 'Войти в аккаунт'
              : mode === 'reset'
              ? 'Отправить ссылку для сброса'
              : 'Сохранить новый пароль'}
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
              <span>Быстрый демо-вход</span>
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
      fallback={<div className="p-8 text-center text-xs font-bold text-slate-400">Загрузка…</div>}
    >
      <AuthForm />
    </Suspense>
  );
}
