import { useEffect } from 'react';
import { PUSH_ENABLED } from '@/lib/env';
import { shouldSetupPush } from '@/lib/push-policy';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { getActiveSession } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

export function usePushNotifications() {
  useEffect(() => {
    const isNative = Capacitor.isNativePlatform();
    if (!shouldSetupPush({ isNative, enabled: PUSH_ENABLED })) return;

    const setupPush = async () => {
      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') return;

        await PushNotifications.register();

        PushNotifications.addListener('registration', async (token) => {
          const session = await getActiveSession();
          if (session && supabase) {
            // Сам токен и id в лог не пишутся: логи устройства читают сторонние приложения и отчёты о сбоях.
            console.info(`[push] токен получен (${token.value.length} символов)`);
            // TODO: supabase.from('push_tokens').upsert(...)
          }
        });
      } catch (error) {
        console.warn('[push] Не удалось настроить уведомления', error);
      }
    };

    setupPush();

    return () => {
      if (isNative) PushNotifications.removeAllListeners();
    };
  }, []);
}
