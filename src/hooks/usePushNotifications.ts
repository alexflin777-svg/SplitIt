import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { getActiveSession } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

export function usePushNotifications() {
  useEffect(() => {
    // Only run in browser if Capacitor is injected, safely checking window.Capacitor
    // В Capacitor 8 свойства `Capacitor.isNative` нет — только isNativePlatform().
    // Старая проверка всегда давала undefined, и обработчик не подключался.
    const isCapacitor = Capacitor.isNativePlatform();
    if (!isCapacitor) return;

    const setupPush = async () => {
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== 'granted') return;

      await PushNotifications.register();

      PushNotifications.addListener('registration', async (token) => {
        const session = await getActiveSession();
        if (session && supabase) {
          console.log(`Push token for user ${session.id}: ${token.value}`);
          // TODO: supabase.from('push_tokens').upsert(...)
        }
      });
    };

    setupPush();

    return () => {
      if (isCapacitor) PushNotifications.removeAllListeners();
    };
  }, []);
}
