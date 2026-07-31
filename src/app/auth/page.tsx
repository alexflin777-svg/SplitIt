'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Shield, CheckCircle2, ArrowRight, Smartphone, User, AlertCircle, Sparkles, Camera, KeyRound } from 'lucide-react';
import { signUpUser, signInUser, resetPassword, getActiveSession, saveLocalSession, UserProfile } from '@/lib/supabase';
import ProfileTesterBar from '@/components/ProfileTesterBar';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'register' | 'login' | 'reset'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('👤');
  const [customAvatarPreview, setCustomAvatarPreview] = useState<string | null>(null);
  const [isTelegramWebApp, setIsTelegramWebApp] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const presetAvatars = ['👤', '👨‍💻', '👩‍🎨', '🦊', '🚀', '🐱', '🐼', '🕶️'];

  useEffect(() => {
    // Check existing session
    getActiveSession().then((user) => {
      if (user) {
        setStatusMessage(`Авторизован как ${user.full_name || user.email}`);
      }
    });

    // Detect Telegram WebApp
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      if (tg.initDataUnsafe?.user) {
        setIsTelegramWebApp(true);
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
      const { data, error } = await signUpUser(email, password, fullName || 'Пользователь', selectedAvatar);
      setLoading(false);
      setStatusMessage(`Аккаунт ${fullName || email} создан! Профиль сохранен.`);
      setTimeout(() => {
        router.push('/');
      }, 1000);
    } else if (mode === 'login') {
      const { data, error } = await signInUser(email, password);
      setLoading(false);
      setStatusMessage(`Успешный вход в аккаунт!`);
      setTimeout(() => {
        router.push('/');
      }, 1000);
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
      full_name: 'Тестовый Пользователь',
      avatar_url: customAvatarPreview || avatarUrl || '👤',
    };
    saveLocalSession(guestUser);
    setStatusMessage('Вы вошли в систему под демо-профилем!');
    setTimeout(() => {
      router.push('/');
    }, 800);
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1 pb-24">
      {/* Quick Profile Tester Switcher Bar */}
      <ProfileTesterBar
        onProfileChanged={(p) => {
          setStatusMessage(`Переключен профиль на: ${p.full_name}`);
          setTimeout(() => router.push('/'), 600);
        }}
      />

      {/* Header */}
      <div className="text-center space-y-2">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white font-extrabold text-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20">
          {customAvatarPreview ? (
            <img src={customAvatarPreview} alt="Avatar" className="w-full h-full object-cover rounded-2xl" />
          ) : (
            <span>S</span>
          )}
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          {mode === 'login' && 'Вход в SplitIt'}
          {mode === 'register' && 'Регистрация нового пользователя'}
          {mode === 'reset' && 'Восстановление пароля'}
        </h2>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          Создайте профиль с аватаром для учета совместных расходов и синхронизации с друзьями.
        </p>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-bold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Mode Selector Tabs */}
      <div className="stitch-card p-1.5 flex items-center bg-slate-100/70 border-slate-200">
        <button
          onClick={() => setMode('register')}
          className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
            mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Регистрация
        </button>
        <button
          onClick={() => setMode('login')}
          className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
            mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Вход
        </button>
        <button
          onClick={() => setMode('reset')}
          className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
            mode === 'reset' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Сброс пароля
        </button>
      </div>

      {/* Auth Form */}
      <form onSubmit={handleSubmit} className="stitch-card p-5 space-y-4">
        {mode === 'register' && (
          <>
            {/* Avatar Picker & Upload */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">Выбор или загрузка аватара</label>
              
              <div className="flex items-center gap-2">
                {presetAvatars.map((av) => (
                  <button
                    key={av}
                    type="button"
                    onClick={() => {
                      setAvatarUrl(av);
                      setCustomAvatarPreview(null);
                    }}
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center text-base transition-all ${
                      avatarUrl === av && !customAvatarPreview
                        ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    {av}
                  </button>
                ))}

                <label className="w-9 h-9 rounded-xl border border-dashed border-blue-400 bg-blue-50/50 hover:bg-blue-100/50 flex items-center justify-center text-blue-600 cursor-pointer transition-all" title="Загрузить свое фото">
                  <Camera className="w-4 h-4" />
                  <input type="file" accept="image/*" onChange={handleAvatarFileUpload} className="hidden" />
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Ваше имя или никнейм</label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="Иван Иванов"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700">Электронная почта (Email)</label>
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
            <input
              type="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        {mode !== 'reset' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Пароль</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
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
        <div className="pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleGuestLogin}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition-all"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>Быстрый вход без пароля (Гостевой профиль)</span>
          </button>
        </div>
      </form>
    </div>
  );
}
