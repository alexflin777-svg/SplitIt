'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, CheckCircle2, ArrowRight, User, Sparkles, Camera, ShieldCheck } from 'lucide-react';
import { signUpUser, signInUser, resetPassword, getActiveSession, saveLocalSession, UserProfile } from '@/lib/supabase';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'register' | 'login' | 'reset'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('👤');
  const [customAvatarPreview, setCustomAvatarPreview] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const presetAvatars = ['👤', '👨‍💻', '👩‍🎨', '🦊', '🚀', '🐱', '🐼', '🕶️'];

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

  const handleAvatarFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomAvatarPreview(reader.result);
        setAvatarUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    if (mode === 'register') {
      const selectedAvatar = customAvatarPreview || avatarUrl;
      const { data } = await signUpUser(email, password, fullName || 'Пользователь', selectedAvatar);
      setLoading(false);
      setStatusMessage(`Аккаунт ${fullName || email} успешно зарегистрирован!`);
      setTimeout(() => {
        router.push('/');
      }, 800);
    } else if (mode === 'login') {
      const { data } = await signInUser(email, password);
      setLoading(false);
      setStatusMessage(`С возвращением, ${data.full_name}!`);
      setTimeout(() => {
        router.push('/');
      }, 800);
    } else if (mode === 'reset') {
      const res = await resetPassword(email);
      setLoading(false);
      setStatusMessage(res.message);
    }
  };

  const handleGuestLogin = () => {
    setLoading(true);
    const guestUser: UserProfile = {
      id: 'guest-' + Date.now(),
      email: 'guest@splitit.app',
      full_name: 'Демо Аккаунт',
      avatar_url: customAvatarPreview || avatarUrl || '👤',
    };
    saveLocalSession(guestUser);
    setStatusMessage('Вы вошли под демо-профилем');
    setTimeout(() => {
      router.push('/');
    }, 600);
  };

  return (
    <div className="space-y-5 max-w-md mx-auto px-1 pb-24">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white font-extrabold text-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20 overflow-hidden">
          {customAvatarPreview ? (
            <img src={customAvatarPreview} alt="Avatar" className="w-full h-full object-cover rounded-2xl" />
          ) : (
            <span>S</span>
          )}
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          {mode === 'login' && 'Вход в ваш профиль'}
          {mode === 'register' && 'Регистрация аккаунта'}
          {mode === 'reset' && 'Восстановление пароля'}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
          Авторизуйтесь на любых 2х и более устройствах для мгновенной синхронизации расходов без конфликтов.
        </p>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2 font-bold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Mode Selector Tabs */}
      <div className="stitch-card p-1.5 flex items-center bg-slate-100/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setMode('register')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
            mode === 'register' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          }`}
        >
          Регистрация
        </button>
        <button
          onClick={() => setMode('login')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
            mode === 'login' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          }`}
        >
          Вход
        </button>
        <button
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

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Электронная почта (Email)</label>
          <div className="relative flex items-center">
            <Mail className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
            <input
              type="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

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
              : 'Отправить ссылку для сброса'}
          </span>
          <ArrowRight className="w-4 h-4" />
        </button>

        {/* Guest Demo Login Button */}
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
      </form>
    </div>
  );
}
