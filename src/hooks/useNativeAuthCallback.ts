import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { getActiveSession, supabase } from '@/lib/supabase';
import { ownAuthCallback, takeReturnPath } from '@/lib/auth-return';
import { acceptAuthCallback } from '@/lib/auth-attempt';
import { t } from '@/lib/i18n/t';

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
      const params = ownAuthCallback(url);
      if (!params) return;

      await Browser.close().catch((e) => console.warn('[SplitIT] системный браузер не закрылся', e));

      // Ветка Telegram: браузерная страница /auth/telegram-native вернула
      // одноразовый token_hash — обмениваем его на сессию прямо здесь.
      const tgTokenHash = params.get('tg_token_hash');
      if (tgTokenHash) {
        // Чужая ссылка с токеном атакующего подменила бы аккаунт: только своя свежая попытка.
        if (!acceptAuthCallback('telegram', params.get('attempt'))) {
          console.warn('[SplitIT] Telegram: callback без начатой на устройстве попытки входа отклонён');
          router.replace(`/auth?oauth_error=${encodeURIComponent(t('auth.callbackRejected'))}`);
          return;
        }
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
        if (profile) router.replace(takeReturnPath('/friends'));
        return;
      }

      const oauthError = params.get('error_description') || params.get('error');
      if (oauthError) {
        router.replace(`/auth?oauth_error=${encodeURIComponent(oauthError)}`);
        return;
      }

      const code = params.get('code');
      if (!code) return;
      // Код меняется на сессию по PKCE-verifier этого устройства; плюс — только из начатого входа.
      if (!acceptAuthCallback('google', null)) {
        console.warn('[SplitIT] Google: callback без начатой на устройстве попытки входа отклонён');
        router.replace(`/auth?oauth_error=${encodeURIComponent(t('auth.callbackRejected'))}`);
        return;
      }

      const { error } = await supabase!.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn('[SplitIT] Не удалось обменять код авторизации на сессию', error.message);
        router.replace(`/auth?oauth_error=${encodeURIComponent(error.message)}`);
        return;
      }

      const profile = await getActiveSession();
      // Приглашение, запомненное до ухода в системный браузер, — туда; иначе как раньше.
      if (profile) router.replace(takeReturnPath('/friends'));
    });

    return () => {
      listenerPromise.then((sub) => sub.remove());
    };
  }, [router]);
}
