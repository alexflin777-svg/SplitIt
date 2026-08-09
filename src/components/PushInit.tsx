'use client';

import { usePushNotifications } from '@/hooks/usePushNotifications';

export function PushInit() {
  usePushNotifications();
  return null;
}
