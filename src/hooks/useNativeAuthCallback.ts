import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { getActiveSession, supabase } from '@/lib/supabase';

/**
 * Ловит deep link `app.splitit.mobile://auth/callback?code=...`, которым
 * Supabase возвращает управление приложению после Google OAuth на Android/iOS
 * (см. signInWithGoogle в lib/supabase.ts и intent-filter в
 * AndroidManifest.xml). WebView при этом не перезагружается — страница
 * /auth/callback не подхватывает код сама, обмен кода на сессию делается
 * здесь вручную через exchangeCodeForSession.
 */
export function useNativeAuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // В Capacitor 8 свойства `Capacitor.isNative` нет — только isNativePlatform().
    // Старая проверка всегда давала undefined, и обработчик не подключался.
    const isCapacitor = Capacitor.isNativePlatform();
    if (!isCapacitor || !supabase) return;

    const listenerPromise = App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.includes('auth/callback')) return;

      await Browser.close().catch(() => {});

      const params = new URL(url).searchParams;

      // Ветка Telegram: браузерная страница /auth/telegram-native вернула
      // одноразовый token_hash — обмениваем его на сессию прямо здесь.
      const tgTokenHash = params.get('tg_token_hash');
      if (tgTokenHash) {
        const { error } = await supabase!.auth.verifyOtp({
          type: 'magiclink',
          token_hash: tgTokenHash,
        });
        if (error) {
          console.warn('[SplitIT] Telegram: token_hash не обменялся на сессию', error.message);
          router.replace(`/auth?oauth_error=${encodeURIComponent(error.message)}`);
          return;
        }
        const profile = await getActiveSession();
        if (profile) router.replace('/friends');
        return;
      }

      const oauthError = params.get('error_description') || params.get('error');
      if (oauthError) {
        router.replace(`/auth?oauth_error=${encodeURIComponent(oauthError)}`);
        return;
      }

      const code = params.get('code');
      if (!code) return;

      const { error } = await supabase!.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn('[SplitIT] Не удалось обменять код авторизации на сессию', error.message);
        router.replace(`/auth?oauth_error=${encodeURIComponent(error.message)}`);
        return;
      }

      const profile = await getActiveSession();
      if (profile) router.replace('/friends');
    });

    return () => {
      listenerPromise.then((sub) => sub.remove());
    };
  }, [router]);
}
