/**
 * Web Push & In-App Notification Manager for SplitIT
 */

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  type: 'update' | 'expense' | 'system';
}

const NOTIFICATIONS_STORAGE_KEY = 'splitit_user_notifications_v1';

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
}

export function sendInAppNotification(title: string, body: string, type: 'update' | 'expense' | 'system' = 'system') {
  if (typeof window === 'undefined') return;

  // 1. Store in local history
  const existing = getNotificationHistory();
  const newItem: NotificationItem = {
    id: 'notif-' + Date.now(),
    title,
    body,
    timestamp: new Date().toISOString(),
    read: false,
    type,
  };
  localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify([newItem, ...existing]));

  // 2. Trigger System Notification if permitted
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
      });
    } catch (e) {
      console.warn('Browser system notification failed', e);
    }
  }
}

export function getNotificationHistory(): NotificationItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}
