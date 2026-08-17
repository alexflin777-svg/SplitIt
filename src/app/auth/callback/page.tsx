'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getActiveSession, supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n/provider';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        if (!supabase) throw new Error('Supabase client not initialized');
        
        // supabase-js обрабатывает ?code= из URL автоматически при инициализации
        // клиента (detectSessionInUrl, PKCE-flow) — здесь просто ждём сессию.
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;

        if (session) {
          // Verify profile exists/active
          const profile = await getActiveSession();
          if (profile) {
            router.replace('/friends');
            return;
          }
        }
        
        // If no session, wait a bit and retry
        setTimeout(async () => {
           const { data: { session: retrySession } } = await supabase!.auth.getSession();
           if (retrySession) {
             const profile = await getActiveSession();
             if (profile) {
                router.replace('/friends');
                return;
             }
           }
           setError(t('auth.error.general'));
        }, 1500);
        
      } catch (err) {
        console.error(err);
        setError(t('auth.error.general'));
      }
    }

    handleCallback();
  }, [router, t]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4 text-red-500">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">{error}</h2>
        <button
          onClick={() => router.replace('/auth')}
          className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-medium"
        >
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
    </div>
  );
}
