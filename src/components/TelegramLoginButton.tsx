'use client';

/**
 * Кнопка «Войти через Telegram» — официальный Login Widget.
 *
 * Виджет Telegram — это внешний <script>, который рисует кнопку в контейнере
 * и по успешной авторизации зовёт onauth-колбэк с подписанным payload.
 * Дальше payload уходит на серверную проверку (signInWithTelegram).
 *
 * Имя бота приходит из NEXT_PUBLIC_TELEGRAM_BOT — если переменная не задана,
 * компонент честно не рендерит ничего: показывать мёртвую кнопку хуже,
 * чем не показывать никакой (тот же принцип, что в app-updater).
 */
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { signInWithTelegram } from '@/lib/supabase';

const BOT_NAME = (process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '').trim();
const NATIVE_BRIDGE_URL = 'https://www.splitit-apps.com/auth/telegram-native';

interface Props {
  /** Вызывается после успешного входа (сессия уже установлена). */
  onSuccess: () => void;
  onError: (message: string) => void;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export function TelegramLoginButton({ onSuccess, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    // В нативном приложении виджет не рисуем: WebView живёт на localhost, и
    // Telegram отвергает домен. Вместо этого кнопка ниже открывает системный
    // браузер на /auth/telegram-native; возврат ловит useNativeAuthCallback.
    if (isNative || !BOT_NAME || !containerRef.current) return;

    // Колбэк глобальный: так требует data-onauth в самом виджете.
    window.onTelegramAuth = async (user) => {
      setBusy(true);
      const { error } = await signInWithTelegram(user);
      setBusy(false);
      if (error) {
        onError(error);
        return;
      }
      onSuccess();
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', BOT_NAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    const container = containerRef.current;
    container.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
      container.replaceChildren();
    };
  }, [onSuccess, onError, isNative]);

  if (!BOT_NAME) return null;

  // Нативное приложение: своя кнопка, открывающая мост в системном браузере.
  // Стилистика повторяет официальный виджет, но это НЕ он — вход завершится
  // возвратом deep link'а в приложение (useNativeAuthCallback).
  if (isNative) {
    return (
      <button
        type="button"
        onClick={() => {
          void Browser.open({ url: NATIVE_BRIDGE_URL });
        }}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#54a9eb] text-sm font-semibold text-white transition-all hover:bg-[#4a99d6]"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.994 2C6.475 2 2 6.475 2 11.994c0 5.52 4.475 9.995 9.994 9.995 5.52 0 9.995-4.475 9.995-9.995C21.99 6.475 17.514 2 11.994 2zm4.637 6.806c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.21-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.62-.2-1.12-.31-1.08-.65.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z" />
        </svg>
        Войти через Telegram
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div ref={containerRef} className="min-h-[46px]" />
      {busy && (
        <p className="text-[11px] font-semibold text-slate-400">Входим через Telegram…</p>
      )}
    </div>
  );
}
