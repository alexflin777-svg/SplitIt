import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { getActiveSession, supabase } from '@/lib/supabase';
import { handleNativeAuthUrl } from '@/lib/native-auth-callback';

/**
 * Ловит deep link `app.splitit.mobile://auth/callback?code=...`, которым
 * Supabase возвращает управление приложению после Google OAuth на Android/iOS
 * (см. signInWithGoogle в lib/supabase.ts и intent-filter в
 * AndroidManifest.xml). WebView при этом не перезагружается — страница
 * /auth/callback не подхватывает код сама, обмен кода на сессию делается
 * в handleNativeAuthUrl (lib/native-auth-callback.ts).
 */
export function useNativeAuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // В Capacitor 8 свойства `Capacitor.isNative` нет — только isNativePlatform().
    // Старая проверка всегда давала undefined, и обработчик не подключался.
    const isCapacitor = Capacitor.isNativePlatform();
    if (!isCapacitor || !supabase) return;
    const auth = supabase.auth;

    const listenerPromise = App.addListener('appUrlOpen', ({ url }) =>
      handleNativeAuthUrl(url, {
        auth,
        replace: (path) => router.replace(path),
        closeBrowser: () => Browser.close().catch((e) => console.warn('[SplitIT] системный браузер не закрылся', e)),
        activeSession: getActiveSession,
      }),
    );

    return () => {
      listenerPromise.then((sub) => sub.remove());
    };
  }, [router]);
}
