import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { APP_URL, SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured, warnIfMisconfigured } from './env';
import { createCredential, verifyCredential, validatePassword, StoredCredential } from './credentials';
import { t } from './i18n/t';

/**
 * Кастомная схема для deep-link обратно в приложение после OAuth на нативных
 * платформах (Android/iOS). Должна совпадать с applicationId в
 * capacitor.config.json и с intent-filter в AndroidManifest.xml — иначе
 * система не знает, каким приложением открыть редирект от Supabase.
 */
const NATIVE_AUTH_REDIRECT_URL = 'app.splitit.mobile://auth/callback';

/**
 * Клиент создаётся только при настоящей конфигурации (инвариант И-3).
 * Плейсхолдерных дефолтов здесь больше нет: клиент, который молча ходит в
 * несуществующий домен, хуже отсутствующего клиента — он маскирует поломку.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce' },
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
  has_completed_onboarding?: boolean;
  created_at?: string;
}

export interface AuthResult {
  data: UserProfile | null;
  error: string | null;
  /** Регистрация создана, но Supabase ещё не выдал сессию до подтверждения email. */
  requiresEmailConfirmation?: boolean;
  /** Аккаунт создан и вход выполнен, но выбранный аватар не записался в profiles. */
  profileSyncError?: string;
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
      ? t('errors.localStorageQuotaExceeded')
      : t('errors.localSaveFailed', { message: String(e?.message ?? e) });
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
  if (!error) {
    notifyLocalSync();
    // BroadcastChannel не доставляет сообщение своей же вкладке.
    window.dispatchEvent(new Event(FRIENDS_CHANGED_EVENT));
  }
  return error;
}

// ---------------------------------------------------------------------------
// Список друзей как внешнее хранилище для useSyncExternalStore (P1-6).
// Снимок обязан быть стабильным между вызовами, поэтому кэшируется по сырой
// строке из localStorage. Чтение чистое: чистка старого демо-набора остаётся
// в getSavedFriends().
// ---------------------------------------------------------------------------

const FRIENDS_CHANGED_EVENT = 'splitit_friends_changed';
const NO_FRIENDS: any[] = [];
let friendsSnapshot: { raw: string | null; value: any[] } | null = null;

export function subscribeToFriends(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const unsubscribeSync = subscribeToLocalSync(callback);
  window.addEventListener(FRIENDS_CHANGED_EVENT, callback);
  return () => {
    unsubscribeSync();
    window.removeEventListener(FRIENDS_CHANGED_EVENT, callback);
  };
}

export function getFriendsSnapshot(): any[] {
  if (typeof window === 'undefined') return NO_FRIENDS;
  const raw = localStorage.getItem(LOCAL_FRIENDS_KEY);
  if (friendsSnapshot?.raw === raw) return friendsSnapshot.value;
  let parsed: any[] = NO_FRIENDS;
  if (raw) {
    try {
      const value = JSON.parse(raw);
      parsed = Array.isArray(value) ? value : NO_FRIENDS;
    } catch (e) {
      console.warn(`[SplitIT] Повреждены данные в ${LOCAL_FRIENDS_KEY}, использую пустой список`, e);
    }
  }
  const value = parsed.filter((friend) => {
    const signature = `${friend?.id ?? ''}|${friend?.name ?? ''}|${friend?.email ?? ''}`;
    return !LEGACY_DEMO_FRIENDS.has(signature);
  });
  friendsSnapshot = { raw, value };
  return value;
}

export function getServerFriendsSnapshot(): any[] {
  return NO_FRIENDS;
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
    full_name: fullName || email.split('@')[0] || t('auth.defaultUserName'),
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
  if (!normEmail.includes('@')) return { data: null, error: t('errors.invalidEmail') };

  const weak = validatePassword(password);
  if (weak) return { data: null, error: weak };

  if (supabase) {
    // Фото (data URL до 200 КБ) в user_metadata не кладём: GoTrue копирует
    // метаданные в JWT, и токен раздувается на каждый запрос. В метаданные —
    // только эмодзи, фото уходит ниже прямой записью в profiles.
    const metadataAvatar = avatarUrl && !avatarUrl.startsWith('data:') ? avatarUrl : '👤';
    const { data, error } = await supabase.auth.signUp({
      email: normEmail,
      password,
      options: { data: { full_name: fullName, avatar_url: metadataAvatar } },
    });

    // Ошибка возвращается наверх, а не проглатывается: раньше провал регистрации
    // выглядел для пользователя точно так же, как успех.
    if (error) return { data: null, error: translateAuthError(error.message) };
    if (!data.user) return { data: null, error: t('errors.noUserReturned') };

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

    // Выбранный при регистрации аватар раньше уходил только в user_metadata, и
    // в profiles оставался '👤' (F4, iPhone 2026-10-09). Пишем профиль явно,
    // как только есть сессия. Сбой не отменяет регистрацию, но и не скрывается.
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: profile.id,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      email: normEmail,
      updated_at: new Date().toISOString(),
    });

    const saveError = saveLocalSession(profile);
    if (saveError) return { data: null, error: saveError };
    return profileError
      ? { data: profile, error: null, profileSyncError: profileError.message }
      : { data: profile, error: null };
  }

  // Локальный режим: аккаунт заводится на устройстве, пароль хранится хешем.
  const registry = getUsersRegistry();
  if (registry[normEmail]) {
    return { data: null, error: t('errors.emailAlreadyRegisteredLocal') };
  }

  const profile = profileFromEmail(normEmail, fullName, avatarUrl);
  const credential = await createCredential(password);
  registerUserProfile(profile, credential);
  const saveError = saveLocalSession(profile);
  return saveError ? { data: null, error: saveError } : { data: profile, error: null };
}

export async function signInUser(email: string, password: string): Promise<AuthResult> {
  const normEmail = email.toLowerCase().trim();
  if (!normEmail || !password) return { data: null, error: t('errors.emailPasswordRequired') };

  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: normEmail, password });
    if (error) return { data: null, error: translateAuthError(error.message) };
    if (!data.user) return { data: null, error: t('errors.invalidCredentials') };

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
    return { data: null, error: t('errors.accountNotFoundLocal') };
  }
  if (!registered.credential) {
    return {
      data: null,
      error: t('errors.noPasswordSetLocal'),
    };
  }
  if (!(await verifyCredential(registered.credential, password))) {
    return { data: null, error: t('errors.invalidCredentials') };
  }

  const { credential: _omit, ...profile } = registered;
  const saveError = saveLocalSession(profile);
  return saveError ? { data: null, error: saveError } : { data: profile, error: null };
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  if (!supabase) return { error: t('errors.syncDisabledNoBackend') };

  const isNative = Capacitor.isNativePlatform();

  // На вебе редирект на `${origin}/auth/callback` — реальный HTTPS-адрес.
  // В Capacitor WebView `window.location.origin` — это `https://localhost`,
  // недостижимый снаружи: Google и Supabase редиректят через системный
  // браузер, а не внутри WebView. Поэтому на нативных платформах используем
  // кастомную схему и открываем URL авторизации через @capacitor/browser;
  // обратно приложение ловит deep link в useNativeAuthCallback.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: isNative ? NATIVE_AUTH_REDIRECT_URL : `${window.location.origin}/auth/callback`,
      skipBrowserRedirect: isNative,
    },
  });

  if (error) return { error: translateAuthError(error.message) };

  if (isNative && data?.url) {
    await Browser.open({ url: data.url });
  }

  return { error: null };
}

/**
 * Вход через Telegram Login Widget.
 *
 * Payload виджета уходит в Edge Function `telegram-auth`, которая проверяет
 * HMAC-подпись ботовым токеном на сервере (клиентская проверка бессмысленна:
 * подделывается) и возвращает одноразовый token_hash. Здесь мы обмениваем его
 * на полноценную сессию через verifyOtp — дальше пользователь неотличим от
 * вошедшего любым другим способом.
 */
export async function signInWithTelegram(
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: t('errors.syncDisabledNoBackend') };

  const { data, error } = await supabase.functions.invoke('telegram-auth', {
    body: payload,
  });

  if (error) {
    // Ошибка функции не маскируется под успех; типовые случаи переводим.
    return { error: translateAuthError(error.message || 'Telegram auth failed') };
  }

  const tokenHash = (data as { token_hash?: string } | null)?.token_hash;
  if (!tokenHash) {
    return { error: t('errors.invalidCredentials') };
  }

  const { error: otpError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (otpError) return { error: translateAuthError(otpError.message) };

  return { error: null };
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
      message: t('errors.passwordResetUnavailable'),
    };
  }

  // Recovery-ссылка должна возвращать именно на экран установки нового пароля.
  // Без redirectTo Supabase отправляет на Site URL: пользователь попадал на
  // главную/в уже открытую сессию и не видел способа сменить пароль.
  const redirectTo = APP_URL ? `${APP_URL}/auth?mode=update-password` : undefined;
  const { error } = await supabase.auth.resetPasswordForEmail(normEmail, { redirectTo });
  if (error) return { success: false, message: translateAuthError(error.message) };

  return { success: true, message: t('errors.passwordResetInstructionsSent', { email: normEmail }) };
}

export async function updatePassword(password: string): Promise<ResetResult> {
  const weak = validatePassword(password);
  if (weak) return { success: false, message: weak };
  if (!supabase) return { success: false, message: t('errors.passwordChangeUnavailable') };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { success: false, message: translateAuthError(error.message) };
  return { success: true, message: t('errors.passwordChangedSuccess') };
}

export async function signOutUser() {
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) console.warn('[SplitIT] Supabase signOut вернул ошибку', error.message);
  }
  clearLocalSession();
  notifyLocalSync();
}

/**
 * Удаление аккаунта (требование Google Play и App Store).
 *
 * Сетевой режим: Edge Function delete-account удаляет данные (RPC
 * delete_my_account) и вход (auth.users). Пока она не ответила успехом,
 * пользователь остаётся в аккаунте и видит ошибку — успех не симулируется.
 *
 * В обоих режимах затем стираются локальные данные splitit_* на устройстве.
 * Выбранный язык остаётся (это настройка устройства, а не личные данные), а из
 * общего реестра локальных аккаунтов удаляется только своя запись — чужие
 * локальные профили на этом же устройстве не трогаются.
 */
export async function deleteAccount(): Promise<{ error: string | null }> {
  if (typeof window === 'undefined') return { error: t('errors.accountDeleteFailed') };
  const session = getLocalSession();

  if (supabase) {
    const { error } = await supabase.functions.invoke('delete-account', { body: {} });
    if (error) {
      console.error('[SplitIT] Удаление аккаунта не удалось', error.message);
      return { error: t('errors.accountDeleteFailed') };
    }
  }

  await signOutUser();

  const registry = getUsersRegistry();
  const ownKey = session?.email?.toLowerCase().trim();
  if (ownKey && registry[ownKey]) {
    delete registry[ownKey];
    writeLocal(USERS_REGISTRY_KEY, registry);
  }

  const keep = new Set(['splitit_locale', USERS_REGISTRY_KEY]);
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
    (key): key is string => Boolean(key && key.startsWith('splitit_') && !keep.has(key)),
  );
  keys.forEach((key) => localStorage.removeItem(key));
  notifyLocalSync();
  window.dispatchEvent(new Event('splitit_profile_changed'));
  return { error: null };
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
    .select('full_name, avatar_url, phone, default_currency, has_completed_onboarding')
    .eq('id', data.user.id)
    .maybeSingle();
  const profile: UserProfile = {
    id: data.user.id,
    email: data.user.email ?? sameUser?.email ?? '',
    has_completed_onboarding: remoteProfile?.has_completed_onboarding ?? sameUser?.has_completed_onboarding ?? false,
    full_name:
      remoteProfile?.full_name ||
      data.user.user_metadata?.full_name ||
      sameUser?.full_name ||
      data.user.email?.split('@')[0] ||
      t('auth.defaultUserName'),
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
  if (m.includes('invalid login credentials')) return t('errors.invalidCredentials');
  if (m.includes('email not confirmed')) return t('errors.emailNotConfirmed');
  if (m.includes('user already registered')) return t('errors.emailAlreadyRegistered');
  if (m.includes('rate limit') || m.includes('too many')) return t('errors.rateLimited');
  if (m.includes('fetch') || m.includes('network')) return t('errors.noServerConnectionCheck');
  return message;
}

export async function completeOnboarding(): Promise<{ error: string | null }> {
  const session = getLocalSession();
  if (!session) return { error: t('errors.noActiveSession') };

  // Update local session immediately
  const updatedSession = { ...session, has_completed_onboarding: true };
  saveLocalSession(updatedSession);

  if (!supabase) return { error: null }; // Silent success for local-only

  const { error } = await supabase
    .from('profiles')
    .update({ has_completed_onboarding: true })
    .eq('id', session.id);

  if (error) return { error: translateAuthError(error.message) };
  return { error: null };
}
