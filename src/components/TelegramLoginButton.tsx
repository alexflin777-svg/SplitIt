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
import { signInWithTelegram } from '@/lib/supabase';

const BOT_NAME = (process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '').trim();

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

  useEffect(() => {
    if (!BOT_NAME || !containerRef.current) return;

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
  }, [onSuccess, onError]);

  if (!BOT_NAME) return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <div ref={containerRef} className="min-h-[46px]" />
      {busy && (
        <p className="text-[11px] font-semibold text-slate-400">Входим через Telegram…</p>
      )}
    </div>
  );
}
