'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CURRENCIES } from '@/lib/currency';
import { getActiveSession, saveLocalSession, signOutUser, UserProfile } from '@/lib/supabase';
import { checkForAppUpdates, getCurrentInstalledVersion, UpdateCheckResult } from '@/lib/app-updater';
import { requestNotificationPermission, sendInAppNotification } from '@/lib/notifications';
import { useRouter } from 'next/navigation';
import { processAvatarFile } from '@/lib/avatar';
import {
  User,
  Bell,
  Moon,
  Volume2,
  Send,
  Shield,
  CheckCircle2,
  Globe,
  Smartphone,
  LogOut,
  Camera,
  RefreshCw,
  Sparkles,
  Download,
} from 'lucide-react';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile>({
    id: 'user-me',
    email: 'user@example.com',
    full_name: 'Пользователь',
    avatar_url: '👤',
    phone: '',
    preferred_currency: 'RUB',
  });

  const [defaultCurrency, setDefaultCurrency] = useState('RUB');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [telegramNotify, setTelegramNotify] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // App updater state
  const [currentVersion, setCurrentVersion] = useState<string>('v2.3.0');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    setCurrentVersion(getCurrentInstalledVersion());

    getActiveSession().then((u) => {
      if (u) {
        setUser(u);
        if (u.preferred_currency) setDefaultCurrency(u.preferred_currency);
        if (u.avatar_url && u.avatar_url.startsWith('data:image')) {
          setCustomAvatar(u.avatar_url);
        }
      }
    });

    if (typeof document !== 'undefined') {
      setDarkMode(document.documentElement.classList.contains('dark'));
    }
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);

    // Проверка и сжатие до записи — см. src/lib/avatar.ts.
    const { dataUrl, error } = await processAvatarFile(file);
    if (error || !dataUrl) {
      setAvatarError(error ?? 'Не удалось обработать изображение');
      e.target.value = '';
      return;
    }
    setCustomAvatar(dataUrl);
    setUser((prev) => ({ ...prev, avatar_url: dataUrl }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: UserProfile = {
      ...user,
      preferred_currency: defaultCurrency,
      avatar_url: customAvatar || user.avatar_url || '👤',
    };
    saveLocalSession(updated);
    setUser(updated);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2500);
  };

  const handleLogout = async () => {
    await signOutUser();
    router.push('/auth');
  };

  const toggleDarkMode = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    if (typeof document !== 'undefined') {
      if (nextDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateResult(null);
    // checkForAppUpdates не бросает: сетевые сбои возвращаются как status: 'error'
    // с текстом для пользователя.
    setUpdateResult(await checkForAppUpdates());
    setIsCheckingUpdate(false);
  };

  const handleEnablePushNotifications = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      setPushEnabled(true);
      sendInAppNotification('Уведомления включены!', 'Вы будете получать оповещения о новых транзакциях и обновлениях.');
    } else {
      alert('Запрос на push-уведомления был отклонен браузером.');
    }
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Профиль и Настройки</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Управление личными данными, уведомлениями и версией
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 font-bold text-xs flex items-center gap-1.5 transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span>Выйти</span>
        </button>
      </div>

      {savedMessage && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Профиль и настройки успешно сохранены!</span>
        </div>
      )}

      {avatarError && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-bold"
        >
          {avatarError}
        </div>
      )}

      {/* Main Profile Info Card with Avatar Upload */}
      <div className="stitch-card p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center text-3xl shadow-md overflow-hidden">
              {customAvatar ? (
                <img src={customAvatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{user.avatar_url || '👤'}</span>
              )}
            </div>
            <label
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center cursor-pointer shadow-md border-2 border-white dark:border-slate-800 hover:bg-blue-700 transition-all"
              title="Загрузить новое фото"
            >
              <Camera className="w-3.5 h-3.5" />
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>
          </div>

          <div>
            <h3 className="font-extrabold text-slate-900 dark:text-white text-base">{user.full_name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{user.email}</p>
            <span className="inline-block mt-1 text-[10px] font-extrabold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
              Версия {currentVersion}
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* Personal Details & Default Currency */}
        <div className="stitch-card p-5 space-y-4">
          <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">
            Личные данные
          </h4>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Имя и Фамилия</label>
            <input
              type="text"
              value={user.full_name}
              onChange={(e) => setUser({ ...user, full_name: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Номер телефона (СБП)</label>
            <input
              type="tel"
              placeholder="+7 (999) 000-00-00"
              value={user.phone || ''}
              onChange={(e) => setUser({ ...user, phone: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              <span>Основная валюта аккаунта</span>
            </label>
            <select
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Notifications & Toggles */}
        <div className="stitch-card p-5 space-y-4">
          <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">
            Настройки уведомлений и приложения
          </h4>

          <div className="space-y-3">
            {/* Push Notifications */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2.5">
                <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <div>
                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">Push-уведомления</span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">О новых расходах и релизах</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={pushEnabled}
                onChange={handleEnablePushNotifications}
                className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer bg-white dark:bg-slate-800"
              />
            </div>

            {/* Telegram Notify */}
            <div className="flex items-center justify-between py-1 border-t border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <Send className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                <div>
                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">Бот в Telegram</span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Уведомления о расчетах долгов</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={telegramNotify}
                onChange={() => setTelegramNotify(!telegramNotify)}
                className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer bg-white dark:bg-slate-800"
              />
            </div>

            {/* Dark Mode */}
            <div className="flex items-center justify-between py-1 border-t border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <Moon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                <div>
                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">Темная тема (Dark Mode)</span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Высокий контраст кнопок</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={darkMode}
                onChange={toggleDarkMode}
                className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer bg-white dark:bg-slate-800"
              />
            </div>
          </div>
        </div>

        {/* App Version & Auto-Updater Section */}
        <div className="stitch-card p-5 space-y-3 bg-gradient-to-br from-slate-900 to-indigo-950 text-white border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Версия SplitIT: {currentVersion}
              </span>
            </div>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
              История сохранена
            </span>
          </div>

          <p className="text-xs text-slate-300 font-medium">
            Новая сборка устанавливается вручную поверх текущей. Локальные данные при этом
            не стираются: группы, участники и история расходов остаются на устройстве.
          </p>

          <button
            type="button"
            onClick={handleCheckForUpdates}
            disabled={isCheckingUpdate}
            className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs border border-white/20 flex items-center justify-center gap-2 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
            <span>{isCheckingUpdate ? 'Проверка...' : 'Проверить обновления приложения'}</span>
          </button>

          {/* Кнопка «обновить прямо сейчас» убрана намеренно. Приложение не может
              установить себя само: в вебе это делает браузер, в Capacitor —
              нативный плагин, которого в зависимостях нет. Прошлая версия
              крутила прогресс на таймерах и рапортовала об успешной установке,
              не скачав ни байта. */}
          {updateResult && (
            <div
              role="status"
              className="p-4 rounded-xl bg-white/10 border border-white/20 text-xs space-y-3 animate-in fade-in duration-200"
            >
              <div className="flex items-center justify-between font-bold gap-2">
                <span>{updateResult.message}</span>
                {updateResult.latestVersion && (
                  <span className="text-amber-300 flex-shrink-0">{updateResult.latestVersion}</span>
                )}
              </div>

              {updateResult.releaseNotes && (
                <p className="text-[11px] text-slate-300">{updateResult.releaseNotes}</p>
              )}

              {updateResult.status === 'available' && updateResult.downloadUrl && (
                <a
                  href={updateResult.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    Скачать {updateResult.latestVersion}
                    {updateResult.downloadSize ? ` (${updateResult.downloadSize})` : ''}
                  </span>
                </a>
              )}

              {updateResult.status === 'available' && !updateResult.downloadUrl && (
                <p className="text-[11px] text-amber-200">
                  В манифесте нет ссылки на скачивание — обратитесь к владельцу сборки.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Save button */}
        <button
          type="submit"
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98"
        >
          Сохранить настройки
        </button>
      </form>
    </div>
  );
}
