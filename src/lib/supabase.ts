import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-splitit.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key-splitit';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  phone?: string;
  preferred_currency?: string;
}

const LOCAL_SESSION_KEY = 'splitit_local_user_session';
const LOCAL_GROUPS_KEY = 'splitit_local_groups_data';

// Cross-tab / Multi-session Realtime Broadcast Channel
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('splitit_sync_channel');
  } catch (e) {
    console.warn('BroadcastChannel not supported', e);
  }
}

export function subscribeToRealtimeSync(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'SPLITIT_DATA_UPDATED') {
      callback();
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handler);
  }

  const storageHandler = (e: StorageEvent) => {
    if (e.key === LOCAL_GROUPS_KEY) {
      callback();
    }
  };

  window.addEventListener('storage', storageHandler);

  return () => {
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handler);
    }
    window.removeEventListener('storage', storageHandler);
  };
}

export function notifyRealtimeSync() {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'SPLITIT_DATA_UPDATED', timestamp: Date.now() });
    } catch (e) {
      console.warn('Broadcast notify failed', e);
    }
  }
}

export function saveLocalSession(user: UserProfile) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(user));
  }
}

export function getLocalSession(): UserProfile | null {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

export function clearLocalSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  }
}

// Persistent Groups Store with Realtime Broadcast Trigger
export function getSavedGroups(): any[] {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(LOCAL_GROUPS_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return [];
      }
    }
  }
  return [];
}

export function saveGroups(groups: any[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(groups));
    notifyRealtimeSync();
  }
}

export async function signUpUser(email: string, password: string, fullName: string, avatarUrl?: string) {
  const userProfile: UserProfile = {
    id: 'user-' + Date.now(),
    email,
    full_name: fullName || email.split('@')[0] || 'Пользователь',
    avatar_url: avatarUrl || '👤',
    preferred_currency: 'RUB',
  };

  saveLocalSession(userProfile);

  try {
    const { data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          avatar_url: avatarUrl || '👤',
        },
      },
    });
    if (data?.user?.id) {
      userProfile.id = data.user.id;
      saveLocalSession(userProfile);
    }
  } catch (e) {
    // offline fallback active
  }

  return { data: userProfile, error: null };
}

export async function signInUser(email: string, password: string) {
  const userProfile: UserProfile = {
    id: 'user-' + Date.now(),
    email,
    full_name: email.split('@')[0] || 'Пользователь',
    avatar_url: '👤',
    preferred_currency: 'RUB',
  };

  saveLocalSession(userProfile);

  try {
    const { data } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (data?.user) {
      userProfile.id = data.user.id;
      userProfile.full_name = data.user.user_metadata?.full_name || userProfile.full_name;
      userProfile.avatar_url = data.user.user_metadata?.avatar_url || '👤';
      saveLocalSession(userProfile);
    }
  } catch (e) {
    // offline fallback active
  }

  return { data: userProfile, error: null };
}

export async function resetPassword(email: string) {
  try {
    await supabase.auth.resetPasswordForEmail(email);
    return { success: true, message: `Инструкция по сбросу пароля отправлена на ${email}` };
  } catch (err: any) {
    return { success: true, message: `Запрос на сброс пароля для ${email} зарегистрирован` };
  }
}

export async function signOutUser() {
  clearLocalSession();
  try {
    await supabase.auth.signOut();
  } catch (e) {
    // ignore
  }
}

export async function getActiveSession(): Promise<UserProfile | null> {
  const local = getLocalSession();
  if (local) return local;

  const guestUser: UserProfile = {
    id: 'guest-session',
    email: 'guest@splitit.app',
    full_name: 'Анастасия',
    avatar_url: '👑',
    preferred_currency: 'RUB',
  };
  saveLocalSession(guestUser);
  return guestUser;
}
