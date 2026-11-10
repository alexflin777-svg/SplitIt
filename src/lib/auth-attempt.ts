/**
 * Попытка входа через системный браузер (Telegram-мост, Google OAuth на Android/iOS).
 *
 * Deep link `app.splitit.mobile://auth/callback` может открыть кто угодно —
 * в том числе ссылкой со своим токеном, чтобы подменить аккаунт на чужом
 * устройстве. Поэтому callback принимается, только если на ЭТОМ устройстве
 * начат вход не раньше 10 минут назад; попытка гасится первым же callback'ом.
 * Telegram дополнительно сверяет случайный id: приложение передаёт его мосту
 * (?attempt=), мост возвращает его в deep link. Google связан PKCE-verifier'ом,
 * который supabase-js хранит на устройстве.
 */

const KEY = 'splitit_auth_attempt';
const TTL_MS = 10 * 60_000;

export type AuthAttemptKind = 'telegram' | 'google';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): KV | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

/** Начать вход; вернуть id попытки для адреса моста. */
export function beginAuthAttempt(kind: AuthAttemptKind, kv: KV | null = storage(), now = Date.now()): string {
  const id = crypto.randomUUID();
  kv?.setItem(KEY, JSON.stringify({ id, kind, at: now }));
  return id;
}

/** Отменённый вход (callback с error): попытка больше не годится. */
export function cancelAuthAttempt(kv: KV | null = storage()): void {
  kv?.removeItem(KEY);
}

/** Принять callback: своя незавершённая попытка не старше 10 минут (и для Telegram — тот же id). Гасит попытку. */
export function acceptAuthCallback(kind: AuthAttemptKind, attempt: string | null, kv: KV | null = storage(), now = Date.now()): boolean {
  if (!kv) return false;
  const raw = kv.getItem(KEY);
  kv.removeItem(KEY);
  let a: { id?: unknown; kind?: unknown; at?: unknown } | null;
  try {
    a = raw ? JSON.parse(raw) : null;
  } catch {
    return false; // испорченная запись — не попытка
  }
  if (!a || a.kind !== kind || typeof a.at !== 'number' || now < a.at || now - a.at > TTL_MS) return false;
  return kind === 'google' || (typeof a.id === 'string' && a.id === attempt);
}
