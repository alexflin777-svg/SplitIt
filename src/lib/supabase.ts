import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { APP_URL, SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured, warnIfMisconfigured } from './env';
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
  /** Регистрация создана, но Supabase ещё не выдал сессию до подтверждения email. */
  requiresEmailConfirmation?: boolean;
}

const LOCAL_SESSION_KEY = 'splitit_local_user_session';
const LOCAL_GROUPS_KEY = 'splitit_local_groups_data';
const USERS_REGISTRY_KEY = 'splitit_registered_users_registry';
const LOCAL_FRIENDS_KEY = 'splitit_saved_friends_list';

// Эти записи автоматически добавлялись старыми версиями приложения. Они
// нужны только как сигнатуры одноразовой миграции и никогда не возвращаются
// пользователю как настоящие контакты (инвариант И-14).
const LEGACY_DEMO_FRIENDS = new Set([
  'user-2|Максим Громов|maksim@example.com',
  'user-3|Елена Воронова|elena@example.com',
  'user-4|Анастасия Ким|anastasia@example.com',
]);

// ---------------------------------------------------------------------------
// Синхронизация между вкладками одного браузера
// ---------------------------------------------------------------------------

/**
 * В канал браузера уходит только сигнал «перечитать localStorage», без самих
 * групп, контактов или профиля. Между устройствами группы синхронизируются из
 * таблиц Supabase через PostgreSQL Changes в remote-store.ts. Клиентский
 * Realtime Broadcast без private channel и RLS для пользовательских данных не
 * используется (инварианты И-5 и И-17).
 */
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('splitit_sync_channel');
  } catch (e) {
    console.warn('BroadcastChannel не поддерживается, синхронизация между вкладками отключена', e);
  }
}

export function subscribeToLocalSync(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

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

  return () => {
    if (broadcastChannel) broadcastChannel.removeEventListener('message', handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function notifyLocalSync() {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'SPLITIT_DATA_UPDATED', timestamp: Date.now() });
    } catch (e) {
      console.warn('Не удалось оповестить соседние вкладки', e);
    }
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
  if (typeof window === 'undefined') return [];

  const saved = readLocal<any[]>(LOCAL_FRIENDS_KEY, []);
  const cleaned = saved.filter((friend) => {
    const signature = `${friend?.id ?? ''}|${friend?.name ?? ''}|${friend?.email ?? ''}`;
    return !LEGACY_DEMO_FRIENDS.has(signature);
  });

  // Удаляем только точные записи старого демо-набора, сохраняя все контакты,
  // которые пользователь добавил сам до обновления.
  if (cleaned.length !== saved.length) {
    writeLocal(LOCAL_FRIENDS_KEY, cleaned);
  }
  return cleaned;
}

export function saveFriends(friends: any[]): string | null {
  if (typeof window === 'undefined') return null;
  const error = writeLocal(LOCAL_FRIENDS_KEY, friends);
  if (!error) notifyLocalSync();
  return error;
}

export function getSavedGroups(): any[] {
  return readLocal<any[]>(LOCAL_GROUPS_KEY, []);
}

export function saveGroups(groups: any[]): string | null {
  if (typeof window === 'undefined') return null;
  const error = writeLocal(LOCAL_GROUPS_KEY, groups);
  if (!error) notifyLocalSync();
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
  notifyLocalSync();
  window.dispatchEvent(new Event('splitit_profile_changed'));
  return null;
}

export function getLocalSession(): UserProfile | null {
  return readLocal<UserProfile | null>(LOCAL_SESSION_KEY, null);
}

export function clearLocalSession() {
  if (typeof window !== 'undefined') {
    const hadSession = localStorage.getItem(LOCAL_SESSION_KEY) !== null;
    localStorage.removeItem(LOCAL_SESSION_KEY);
    if (hadSession) window.dispatchEvent(new Event('splitit_profile_changed'));
  }
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
    // При включённом Confirm email Supabase возвращает user без session. Раньше
    // это сохранялось как полноценный локальный вход, после чего любой запрос к
    // RLS падал: в интерфейсе пользователь есть, в JWT его ещё нет.
    if (!data.session) {
      clearLocalSession();
      return { data: profile, error: null, requiresEmailConfirmation: true };
    }

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

  // Recovery-ссылка должна возвращать именно на экран установки нового пароля.
  // Без redirectTo Supabase отправляет на Site URL: пользователь попадал на
  // главную/в уже открытую сессию и не видел способа сменить пароль.
  const redirectTo = APP_URL ? `${APP_URL}/auth?mode=update-password` : undefined;
  const { error } = await supabase.auth.resetPasswordForEmail(normEmail, { redirectTo });
  if (error) return { success: false, message: translateAuthError(error.message) };

  return { success: true, message: `Инструкция по сбросу пароля отправлена на ${normEmail}` };
}

export async function updatePassword(password: string): Promise<ResetResult> {
  const weak = validatePassword(password);
  if (weak) return { success: false, message: weak };
  if (!supabase) return { success: false, message: 'Смена пароля по email недоступна: бэкенд не настроен.' };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { success: false, message: translateAuthError(error.message) };
  return { success: true, message: 'Пароль изменён. Теперь войдите с новым паролем.' };
}

export async function signOutUser() {
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) console.warn('[SplitIT] Supabase signOut вернул ошибку', error.message);
  }
  clearLocalSession();
  notifyLocalSync();
}

export async function getActiveSession(): Promise<UserProfile | null> {
  if (!supabase) return getLocalSession();

  // В сетевом режиме источником истины служит Supabase Auth, а не произвольная
  // JSON-строка в localStorage. Это также очищает протухшую локальную сессию.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    clearLocalSession();
    return null;
  }

  const cached = getLocalSession();
  const sameUser = cached?.id === data.user.id ? cached : null;
  const { data: remoteProfile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, phone, default_currency')
    .eq('id', data.user.id)
    .maybeSingle();
  const profile: UserProfile = {
    id: data.user.id,
    email: data.user.email ?? sameUser?.email ?? '',
    full_name:
      remoteProfile?.full_name ||
      data.user.user_metadata?.full_name ||
      sameUser?.full_name ||
      data.user.email?.split('@')[0] ||
      'Пользователь',
    avatar_url: remoteProfile?.avatar_url || data.user.user_metadata?.avatar_url || sameUser?.avatar_url || '👤',
    phone: remoteProfile?.phone || sameUser?.phone,
    preferred_currency: remoteProfile?.default_currency || sameUser?.preferred_currency || 'RUB',
    created_at: sameUser?.created_at || data.user.created_at,
  };

  if (!sameUser || JSON.stringify(sameUser) !== JSON.stringify(profile)) {
    const saveError = saveLocalSession(profile);
    if (saveError) console.warn('[SplitIT] Не удалось обновить локальный кэш сессии', saveError);
  }
  return profile;
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
