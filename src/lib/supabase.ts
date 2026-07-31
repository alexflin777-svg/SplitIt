import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured, warnIfMisconfigured } from './env';
import { createCredential, verifyCredential, validatePassword, StoredCredential } from './credentials';

/**
 * Клиент создаётся только при настоящей конфигурации (инвариант И-3).
 * Плейсхолдерных дефолтов здесь больше нет: клиент, который молча ходит в
 * несуществующий домен, хуже отсутствующего клиента — он маскирует поломку.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

warnIfMisconfigured();

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  phone?: string;
  preferred_currency?: string;
  created_at?: string;
}

export interface AuthResult {
  data: UserProfile | null;
  error: string | null;
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

// ---------------------------------------------------------------------------
// Синхронизация между вкладками и устройствами
// ---------------------------------------------------------------------------

/**
 * Раньше здесь был один канал 'splitit_live_sync' на всё приложение: каждый
 * клиент рассылал в него ВСЕ свои группы и весь список друзей, а приёмник писал
 * полученное к себе в localStorage без проверки отправителя. Два пользователя с
 * настоящим Supabase затёрли бы данные друг друга и увидели чужие расходы.
 *
 * Теперь канал скоупится на пользователя, отправитель проверяется, состояние
 * сливается по времени изменения, а подписка снимается в функции очистки
 * (инвариант И-5).
 */
function userChannelName(userId: string): string {
  return `splitit:user:${userId}`;
}

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('splitit_sync_channel');
  } catch (e) {
    console.warn('BroadcastChannel не поддерживается, синхронизация между вкладками отключена', e);
  }
}

type RealtimeChannel = ReturnType<NonNullable<typeof supabase>['channel']>;

function openUserChannel(userId: string, onPayload: (payload: any) => void): RealtimeChannel | null {
  if (!supabase) return null;
  try {
    const channel = supabase.channel(userChannelName(userId), {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'SPLITIT_DEVICE_SYNC' }, onPayload).subscribe();
    return channel;
  } catch (e) {
    console.warn('Не удалось открыть канал синхронизации Supabase', e);
    return null;
  }
}

export function subscribeToRealtimeSync(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const session = getLocalSession();

  // 1. Между вкладками одного браузера
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'SPLITIT_DATA_UPDATED') callback();
  };
  if (broadcastChannel) broadcastChannel.addEventListener('message', handler);

  // 2. Событие storage — вкладки, до которых не дошёл BroadcastChannel
  const storageHandler = (e: StorageEvent) => {
    if (e.key === LOCAL_GROUPS_KEY || e.key === LOCAL_SESSION_KEY || e.key === LOCAL_FRIENDS_KEY) {
      callback();
    }
  };
  window.addEventListener('storage', storageHandler);

  // 3. Между устройствами одного пользователя — только при настроенном Supabase
  const channel = session
    ? openUserChannel(session.id, (payload) => {
        // Чужой отправитель игнорируется, даже если пробился в канал.
        if (payload?.payload?.user_id !== session.id) return;
        mergeIncomingState(payload.payload);
        callback();
      })
    : null;

  return () => {
    if (broadcastChannel) broadcastChannel.removeEventListener('message', handler);
    window.removeEventListener('storage', storageHandler);
    // Канал снимается вместе с подпиской — раньше он оставался жить, и каждая
    // новая подписка вешала ещё один обработчик поверх старых.
    if (channel && supabase) {
      try {
        supabase.removeChannel(channel);
      } catch (e) {
        console.warn('Не удалось закрыть канал синхронизации', e);
      }
    }
  };
}

/**
 * Входящее состояние сливается с локальным по времени изменения, а не
 * перезаписывает его целиком. Перезапись теряла всё, что устройство успело
 * записать между двумя событиями.
 */
function mergeIncomingState(payload: { groups?: any[]; friends?: any[] }): void {
  if (Array.isArray(payload.groups)) {
    const merged = mergeById(getSavedGroups(), payload.groups);
    localStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(merged));
  }
  if (Array.isArray(payload.friends)) {
    const merged = mergeById(getSavedFriends(), payload.friends);
    localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(merged));
  }
}

function mergeById(local: any[], incoming: any[]): any[] {
  const byId = new Map<string, any>();
  for (const item of local) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of incoming) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const localAt = Date.parse(existing.updatedAt ?? existing.createdAt ?? '') || 0;
    const remoteAt = Date.parse(item.updatedAt ?? item.createdAt ?? '') || 0;
    byId.set(item.id, remoteAt >= localAt ? item : existing);
  }
  return Array.from(byId.values());
}

export function notifyRealtimeSync(groups?: any[], friends?: any[]) {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'SPLITIT_DATA_UPDATED', timestamp: Date.now() });
    } catch (e) {
      console.warn('Не удалось оповестить соседние вкладки', e);
    }
  }

  if (!supabase) return;

  const activeUser = getLocalSession();
  if (!activeUser) return;

  try {
    supabase.channel(userChannelName(activeUser.id)).send({
      type: 'broadcast',
      event: 'SPLITIT_DEVICE_SYNC',
      payload: {
        user_id: activeUser.id,
        groups: groups || getSavedGroups(),
        friends: friends || getSavedFriends(),
        timestamp: Date.now(),
      },
    });
  } catch (e) {
    console.warn('Не удалось разослать состояние на другие устройства', e);
  }
}

// ---------------------------------------------------------------------------
// Локальные хранилища
// ---------------------------------------------------------------------------

/**
 * Единая точка записи в localStorage. Квота — около 5 МБ на всё приложение,
 * и её превышение раньше приводило к необработанному QuotaExceededError прямо
 * внутри обработчика формы (инвариант И-6).
 */
function writeLocal(key: string, value: unknown): string | null {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch (e: any) {
    const isQuota = e?.name === 'QuotaExceededError' || e?.code === 22;
    const message = isQuota
      ? 'Закончилось место в локальном хранилище. Уменьшите размер аватара или удалите старые события.'
      : `Не удалось сохранить данные локально: ${e?.message ?? e}`;
    console.error('[SplitIT]', message, e);
    return message;
  }
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[SplitIT] Повреждены данные в ${key}, использую значение по умолчанию`, e);
    return fallback;
  }
}

export function getSavedFriends(): any[] {
  if (typeof window === 'undefined') return DEFAULT_INITIAL_FRIENDS;
  const raw = localStorage.getItem(LOCAL_FRIENDS_KEY);
  if (raw === null) {
    writeLocal(LOCAL_FRIENDS_KEY, DEFAULT_INITIAL_FRIENDS);
    return DEFAULT_INITIAL_FRIENDS;
  }
  return readLocal<any[]>(LOCAL_FRIENDS_KEY, DEFAULT_INITIAL_FRIENDS);
}

export function saveFriends(friends: any[]): string | null {
  if (typeof window === 'undefined') return null;
  const error = writeLocal(LOCAL_FRIENDS_KEY, friends);
  if (!error) notifyRealtimeSync(undefined, friends);
  return error;
}

export function getSavedGroups(): any[] {
  return readLocal<any[]>(LOCAL_GROUPS_KEY, []);
}

export function saveGroups(groups: any[]): string | null {
  if (typeof window === 'undefined') return null;
  const error = writeLocal(LOCAL_GROUPS_KEY, groups);
  if (!error) notifyRealtimeSync(groups);
  return error;
}

// ---------------------------------------------------------------------------
// Реестр аккаунтов и сессия
// ---------------------------------------------------------------------------

interface RegistryEntry extends UserProfile {
  credential?: StoredCredential;
}

export function getUsersRegistry(): Record<string, RegistryEntry> {
  return readLocal<Record<string, RegistryEntry>>(USERS_REGISTRY_KEY, {});
}

export function registerUserProfile(profile: UserProfile, credential?: StoredCredential): void {
  if (typeof window === 'undefined') return;
  const registry = getUsersRegistry();
  const key = profile.email.toLowerCase().trim();
  // Существующий пароль не затирается, если новый не передан.
  const existing = registry[key];
  registry[key] = { ...profile, credential: credential ?? existing?.credential };
  writeLocal(USERS_REGISTRY_KEY, registry);
}

export function saveLocalSession(user: UserProfile): string | null {
  if (typeof window === 'undefined') return null;
  const error = writeLocal(LOCAL_SESSION_KEY, user);
  if (error) return error;
  registerUserProfile(user);
  notifyRealtimeSync();
  return null;
}

export function getLocalSession(): UserProfile | null {
  return readLocal<UserProfile | null>(LOCAL_SESSION_KEY, null);
}

export function clearLocalSession() {
  if (typeof window !== 'undefined') localStorage.removeItem(LOCAL_SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Авторизация
// ---------------------------------------------------------------------------

function profileFromEmail(email: string, fullName?: string, avatarUrl?: string): UserProfile {
  return {
    id: 'user-' + Date.now(),
    email,
    full_name: fullName || email.split('@')[0] || 'Пользователь',
    avatar_url: avatarUrl || '👤',
    preferred_currency: 'RUB',
    created_at: new Date().toISOString(),
  };
}

export async function signUpUser(
  email: string,
  password: string,
  fullName: string,
  avatarUrl?: string,
): Promise<AuthResult> {
  const normEmail = email.toLowerCase().trim();
  if (!normEmail.includes('@')) return { data: null, error: 'Введите корректный адрес электронной почты' };

  const weak = validatePassword(password);
  if (weak) return { data: null, error: weak };

  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      email: normEmail,
      password,
      options: { data: { full_name: fullName, avatar_url: avatarUrl || '👤' } },
    });

    // Ошибка возвращается наверх, а не проглатывается: раньше провал регистрации
    // выглядел для пользователя точно так же, как успех.
    if (error) return { data: null, error: translateAuthError(error.message) };
    if (!data.user) return { data: null, error: 'Supabase не вернул пользователя. Попробуйте ещё раз.' };

    const profile: UserProfile = {
      ...profileFromEmail(normEmail, fullName, avatarUrl),
      id: data.user.id,
    };
    const saveError = saveLocalSession(profile);
    return saveError ? { data: null, error: saveError } : { data: profile, error: null };
  }

  // Локальный режим: аккаунт заводится на устройстве, пароль хранится хешем.
  const registry = getUsersRegistry();
  if (registry[normEmail]) {
    return { data: null, error: 'Аккаунт с таким email уже зарегистрирован на этом устройстве' };
  }

  const profile = profileFromEmail(normEmail, fullName, avatarUrl);
  const credential = await createCredential(password);
  registerUserProfile(profile, credential);
  const saveError = saveLocalSession(profile);
  return saveError ? { data: null, error: saveError } : { data: profile, error: null };
}

export async function signInUser(email: string, password: string): Promise<AuthResult> {
  const normEmail = email.toLowerCase().trim();
  if (!normEmail || !password) return { data: null, error: 'Введите email и пароль' };

  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: normEmail, password });
    if (error) return { data: null, error: translateAuthError(error.message) };
    if (!data.user) return { data: null, error: 'Неверный email или пароль' };

    const registry = getUsersRegistry();
    const known = registry[normEmail];
    const profile: UserProfile = {
      id: data.user.id,
      email: normEmail,
      full_name: data.user.user_metadata?.full_name || known?.full_name || normEmail.split('@')[0],
      avatar_url: data.user.user_metadata?.avatar_url || known?.avatar_url || '👤',
      preferred_currency: known?.preferred_currency || 'RUB',
      created_at: known?.created_at || new Date().toISOString(),
    };
    const saveError = saveLocalSession(profile);
    return saveError ? { data: null, error: saveError } : { data: profile, error: null };
  }

  // Локальный режим. Раньше эта ветка была единственной и не смотрела на пароль
  // вообще: любой email с любым паролем создавал сессию, а если email уже был в
  // реестре — отдавал чужой профиль целиком (дефект S0-1).
  const registry = getUsersRegistry();
  const registered = registry[normEmail];

  if (!registered) {
    return { data: null, error: 'Аккаунт не найден на этом устройстве. Зарегистрируйтесь или войдите как гость.' };
  }
  if (!registered.credential) {
    return {
      data: null,
      error: 'Для этого аккаунта не задан пароль. Зарегистрируйте его заново или войдите как гость.',
    };
  }
  if (!(await verifyCredential(registered.credential, password))) {
    return { data: null, error: 'Неверный email или пароль' };
  }

  const { credential: _omit, ...profile } = registered;
  const saveError = saveLocalSession(profile);
  return saveError ? { data: null, error: saveError } : { data: profile, error: null };
}

export interface ResetResult {
  success: boolean;
  message: string;
}

export async function resetPassword(email: string): Promise<ResetResult> {
  const normEmail = email.toLowerCase().trim();

  // Раньше catch возвращал success: true — пользователь ждал письмо, которого
  // не могло быть в принципе, потому что бэкенд не настроен (дефект S2-2).
  if (!supabase) {
    return {
      success: false,
      message: 'Восстановление пароля по email недоступно: бэкенд не настроен. Войдите как гость или зарегистрируйтесь заново.',
    };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normEmail);
  if (error) return { success: false, message: translateAuthError(error.message) };

  return { success: true, message: `Инструкция по сбросу пароля отправлена на ${normEmail}` };
}

export async function signOutUser() {
  clearLocalSession();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) console.warn('[SplitIT] Supabase signOut вернул ошибку', error.message);
  }
  notifyRealtimeSync();
}

export async function getActiveSession(): Promise<UserProfile | null> {
  return getLocalSession();
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Неверный email или пароль';
  if (m.includes('email not confirmed')) return 'Email не подтверждён — проверьте почту';
  if (m.includes('user already registered')) return 'Аккаунт с таким email уже зарегистрирован';
  if (m.includes('rate limit') || m.includes('too many')) return 'Слишком много попыток. Подождите минуту.';
  if (m.includes('fetch') || m.includes('network')) return 'Нет связи с сервером. Проверьте подключение.';
  return message;
}
