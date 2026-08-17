import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
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
    const isCapacitor = typeof window !== 'undefined' && (window as any).Capacitor?.isNative;
    if (!isCapacitor || !supabase) return;

    const listenerPromise = App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.includes('auth/callback')) return;

      await Browser.close().catch(() => {});

      const code = new URL(url).searchParams.get('code');
      if (!code) return;

      const { error } = await supabase!.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn('[SplitIT] Не удалось обменять код авторизации на сессию', error.message);
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
