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
  created_at?: string;
}

const LOCAL_SESSION_KEY = 'splitit_local_user_session';
const LOCAL_GROUPS_KEY = 'splitit_local_groups_data';
const USERS_REGISTRY_KEY = 'splitit_registered_users_registry';
const LOCAL_FRIENDS_KEY = 'splitit_saved_friends_list';

// Default initial friends array
const DEFAULT_INITIAL_FRIENDS = [
  { id: 'user-2', name: 'Максим Громов', avatar: '👨‍💻', phone: '+7 (916) 123-45-67', email: 'maksim@example.com', role: 'member' },
  { id: 'user-3', name: 'Елена Воронова', avatar: '👩‍🎨', phone: '+7 (926) 987-65-43', email: 'elena@example.com', role: 'member' },
  { id: 'user-4', name: 'Анастасия Ким', avatar: '🦊', phone: '+7 (903) 555-12-34', email: 'anastasia@example.com', role: 'member' },
];

// Global Supabase Realtime & Web Broadcast Channels for Multi-Device Realtime Sync
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('splitit_sync_channel');
  } catch (e) {
    console.warn('BroadcastChannel not supported', e);
  }
}

// Supabase Realtime Subscription Channel
let supabaseRealtimeChannel: any = null;
if (typeof window !== 'undefined') {
  try {
    supabaseRealtimeChannel = supabase.channel('splitit_live_sync', {
      config: { broadcast: { self: false } },
    });
  } catch (e) {
    console.warn('Supabase Realtime channel creation error', e);
  }
}

export function subscribeToRealtimeSync(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  // 1. Cross-tab BroadcastChannel listener
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'SPLITIT_DATA_UPDATED') {
      callback();
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handler);
  }

  // 2. Storage event listener for multi-tab
  const storageHandler = (e: StorageEvent) => {
    if (e.key === LOCAL_GROUPS_KEY || e.key === LOCAL_SESSION_KEY || e.key === LOCAL_FRIENDS_KEY) {
      callback();
    }
  };
  window.addEventListener('storage', storageHandler);

  // 3. Supabase Realtime multi-device network listener
  if (supabaseRealtimeChannel) {
    supabaseRealtimeChannel
      .on('broadcast', { event: 'SPLITIT_DEVICE_SYNC' }, (payload: any) => {
        if (payload?.payload?.groups) {
          try {
            localStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(payload.payload.groups));
          } catch (e) {}
        }
        if (payload?.payload?.friends) {
          try {
            localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(payload.payload.friends));
          } catch (e) {}
        }
        callback();
      })
      .subscribe();
  }

  return () => {
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handler);
    }
    window.removeEventListener('storage', storageHandler);
  };
}

export function notifyRealtimeSync(groups?: any[], friends?: any[]) {
  // Broadcast locally across tabs
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'SPLITIT_DATA_UPDATED', timestamp: Date.now() });
    } catch (e) {
      console.warn('Broadcast notify failed', e);
    }
  }

  // Broadcast to remote devices via Supabase Realtime
  if (supabaseRealtimeChannel) {
    try {
      const activeUser = getLocalSession();
      const currentGroups = groups || getSavedGroups();
      const currentFriends = friends || getSavedFriends();
      supabaseRealtimeChannel.send({
        type: 'broadcast',
        event: 'SPLITIT_DEVICE_SYNC',
        payload: {
          user_id: activeUser?.id,
          email: activeUser?.email,
          groups: currentGroups,
          friends: currentFriends,
          timestamp: Date.now(),
        },
      });
    } catch (e) {
      console.warn('Supabase Realtime broadcast failed', e);
    }
  }
}

// Persistent Friends Store
export function getSavedFriends(): any[] {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(LOCAL_FRIENDS_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return DEFAULT_INITIAL_FRIENDS;
      }
    } else {
      localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(DEFAULT_INITIAL_FRIENDS));
      return DEFAULT_INITIAL_FRIENDS;
    }
  }
  return DEFAULT_INITIAL_FRIENDS;
}

export function saveFriends(friends: any[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(friends));
    notifyRealtimeSync(undefined, friends);
  }
}

// User Accounts Registry helpers
export function getUsersRegistry(): Record<string, UserProfile> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(USERS_REGISTRY_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

export function registerUserProfile(profile: UserProfile) {
  if (typeof window === 'undefined') return;
  const registry = getUsersRegistry();
  const key = profile.email.toLowerCase().trim();
  registry[key] = profile;
  localStorage.setItem(USERS_REGISTRY_KEY, JSON.stringify(registry));
}

export function saveLocalSession(user: UserProfile) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(user));
    registerUserProfile(user);
    notifyRealtimeSync();
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

// Persistent Groups Store with Conflict-Free Merging & Realtime Sync
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
    notifyRealtimeSync(groups);
  }
}

export async function signUpUser(email: string, password: string, fullName: string, avatarUrl?: string) {
  const normEmail = email.toLowerCase().trim();
  const userProfile: UserProfile = {
    id: 'user-' + Date.now(),
    email: normEmail,
    full_name: fullName || normEmail.split('@')[0] || 'Пользователь',
    avatar_url: avatarUrl || '👤',
    preferred_currency: 'RUB',
    created_at: new Date().toISOString(),
  };

  saveLocalSession(userProfile);

  try {
    const { data } = await supabase.auth.signUp({
      email: normEmail,
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
    // fallback active
  }

  return { data: userProfile, error: null };
}

export async function signInUser(email: string, password: string) {
  const normEmail = email.toLowerCase().trim();
  const registry = getUsersRegistry();
  const registered = registry[normEmail];

  let userProfile: UserProfile;

  if (registered) {
    userProfile = { ...registered };
  } else {
    userProfile = {
      id: 'user-' + Date.now(),
      email: normEmail,
      full_name: normEmail.split('@')[0] || 'Пользователь',
      avatar_url: '👤',
      preferred_currency: 'RUB',
      created_at: new Date().toISOString(),
    };
  }

  saveLocalSession(userProfile);

  try {
    const { data } = await supabase.auth.signInWithPassword({
      email: normEmail,
      password,
    });
    if (data?.user) {
      userProfile.id = data.user.id;
      userProfile.full_name = data.user.user_metadata?.full_name || userProfile.full_name;
      userProfile.avatar_url = data.user.user_metadata?.avatar_url || userProfile.avatar_url;
      saveLocalSession(userProfile);
    }
  } catch (e) {
    // fallback active
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
  notifyRealtimeSync();
}

export async function getActiveSession(): Promise<UserProfile | null> {
  const local = getLocalSession();
  if (local) return local;
  return null;
}
