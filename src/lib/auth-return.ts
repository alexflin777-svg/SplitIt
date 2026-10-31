/**
 * Куда вернуть человека после входа (SCENARIOS-AUDIT §4 п. 1).
 *
 * Google и Telegram уводят со страницы (веб — редирект, натив — системный
 * браузер и deep link), и `?next=` из адреса теряется. Поэтому путь
 * запоминается в localStorage до ухода и забирается один раз после входа.
 * Только относительные пути приложения: «//evil.com» и «https://…» — нет.
 */

const KEY = 'splitit_auth_next';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): KV | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

/** Запомнить путь; небезопасный не запоминается. */
export function rememberReturnPath(path: string | null | undefined, kv: KV | null = storage()): void {
  const safe = safeReturnPath(path);
  if (safe && kv) kv.setItem(KEY, safe);
}

/** Забрать запомненный путь (один раз) или fallback. */
export function takeReturnPath(fallback: string, kv: KV | null = storage()): string {
  if (!kv) return fallback;
  const saved = safeReturnPath(kv.getItem(KEY));
  kv.removeItem(KEY);
  return saved ?? fallback;
}
