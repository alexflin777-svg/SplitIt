'use client';

/**
 * Мост Telegram-входа для нативного приложения.
 *
 * В Capacitor WebView виджет Telegram не работает: он сверяет домен страницы
 * с /setdomain, а WebView живёт на https://localhost. Поэтому APK открывает
 * ЭТУ страницу в системном браузере (настоящий www-домен), пользователь
 * проходит виджет здесь, страница обменивает payload на token_hash через
 * Edge Function и возвращает управление приложению deep link'ом
 * app.splitit.mobile://auth/callback?tg_token_hash=…
 * Сессию из token_hash создаёт уже само приложение (useNativeAuthCallback) —
 * токен одноразовый, и тратить его в браузере нельзя.
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { telegramBridgeAuth } from '@/lib/telegram-bridge';

const BOT_NAME = (process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '').trim();

type Phase = 'widget' | 'exchanging' | 'redirecting' | 'error';

declare global {
  interface Window {
    onTelegramNativeAuth?: (user: Record<string, unknown>) => void;
  }
}

export default function TelegramNativeBridgePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('widget');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!BOT_NAME || !containerRef.current) return;

    window.onTelegramNativeAuth = async (user) => {
      setPhase('exchanging');
      const client = supabase;
      if (!client) {
        setPhase('error');
        setMessage('Бэкенд не настроен.');
        return;
      }
      // attempt из адреса (приложение 1.1.1) возвращается в deep link; без него — как для старых версий.
      const r = await telegramBridgeAuth(user, window.location.search, (body) => client.functions.invoke('telegram-auth', { body }));
      if (r.error !== undefined) {
        setPhase('error');
        setMessage(r.error);
        return;
      }
      setPhase('redirecting');
      // Возврат в приложение. Если deep link не сработал (открыто не из APK) —
      // показываем это честно, а не бесконечный спиннер.
      // Custom-scheme deep link в приложение (app.splitit.mobile://): router сюда не применим.
      window.location.href = r.url;
      setTimeout(() => {
        setPhase('error');
        setMessage('Похоже, страница открыта не из приложения SplitIT. Вернитесь в приложение и попробуйте снова.');
      }, 3000);
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', BOT_NAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onTelegramNativeAuth(user)');
    script.setAttribute('data-request-access', 'write');
    const container = containerRef.current;
    container.appendChild(script);

    return () => {
      delete window.onTelegramNativeAuth;
      container.replaceChildren();
    };
  }, []);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 pb-28 text-center">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        Вход через Telegram
      </h1>
      {phase === 'widget' && (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Нажмите кнопку ниже — после подтверждения вы автоматически вернётесь в приложение SplitIT.
          </p>
          <div ref={containerRef} className="min-h-[46px]" />
          {!BOT_NAME && (
            <p className="text-xs font-bold text-rose-600">Вход через Telegram не настроен.</p>
          )}
        </>
      )}
      {phase === 'exchanging' && (
        <p className="text-sm text-slate-500">Проверяем подпись Telegram…</p>
      )}
      {phase === 'redirecting' && (
        <p className="text-sm text-slate-500">Возвращаемся в приложение…</p>
      )}
      {phase === 'error' && (
        <p className="text-sm font-bold text-rose-600">{message}</p>
      )}
    </main>
  );
}
