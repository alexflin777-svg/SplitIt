/**
 * Снимки экранов для показа сразу (stale-while-revalidate): последний ответ
 * сервера в памяти и в localStorage, ключ — id пользователя. Экран рисует
 * снимок и тут же перечитывает данные. Снимок — только для просмотра: экраны
 * фиксации итога и отметки переводов его не читают.
 *
 * Поколение входа: счётчик растёт, когда на устройстве меняется аккаунт
 * (выход, вход другого, удаление). Ответ, запрошенный в прежнем поколении,
 * не показывается и не сохраняется: иначе поздний ответ A всплыл бы у B.
 *
 * Чистка: при выходе и смене аккаунта (supabase.ts) и при удалении аккаунта
 * (префикс splitit_ стирается целиком).
 */

const PREFIX = 'splitit_snap:';
/** Версия формата: запись другой версии или без версии удаляется, экран читает сервер. */
const VERSION = 2;
const memory = new Map<string, unknown>();

const keyOf = (uid: string, name: string) => `${PREFIX}${uid}:${name}`;

let generation = 0;
/** Ключ перемонтирования экранов (AuthScope): растёт не при каждом новом поколении. */
let scope = 0;
const listeners = new Set<() => void>();

export const authGeneration = () => generation;
export const authScope = () => scope;

/**
 * Аккаунт на устройстве сменился (любая смена uid, включая вход из пустой сессии):
 * новое поколение — прежние запросы недействительны, снимки стереть.
 * remount: false — первый вход: экран (/auth, онбординг) не перемонтируется,
 * на нём нет данных чужого аккаунта.
 */
export function authUserChanged(remount = true): void {
  generation++;
  if (remount) scope++;
  clearSnaps();
  for (const l of listeners) l();
}

export function onAuthUserChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** valid — минимальная проверка структуры: несовместимый снимок удаляется. */
export function readSnap<T>(uid: string | null | undefined, name: string, valid: (v: unknown) => boolean): T | null {
  if (!uid || typeof window === 'undefined') return null;
  const key = keyOf(uid, name);
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { v?: unknown; data?: unknown } | null;
    if (stored?.v !== VERSION || !valid(stored.data)) {
      window.localStorage.removeItem(key);
      return null;
    }
    memory.set(key, stored.data);
    return stored.data as T;
  } catch (e) {
    console.warn('[SplitIT] снимок не прочитан, экран подождёт сервер', name, e);
    try {
      window.localStorage.removeItem(key);
    } catch (removeError) {
      console.warn('[SplitIT] битый снимок не удалён: хранилище недоступно', name, removeError);
    }
    return null;
  }
}

/** gen — поколение входа на момент запроса: ответ прежнего поколения не сохраняется. */
export function writeSnap(uid: string | null | undefined, name: string, value: unknown, gen: number): void {
  if (!uid || typeof window === 'undefined' || gen !== generation) return;
  const key = keyOf(uid, name);
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: VERSION, data: value }));
  } catch (e) {
    // Переполненное хранилище: снимок останется только в памяти — это не ошибка данных.
    console.warn('[SplitIT] снимок не сохранён в localStorage', name, e);
  }
}

export function dropSnap(uid: string | null | undefined, name: string): void {
  if (!uid || typeof window === 'undefined') return;
  memory.delete(keyOf(uid, name));
  window.localStorage.removeItem(keyOf(uid, name));
}

/** Причина ошибки чтения: denied — нет прав или не найдено; network — сеть, таймаут, 5xx. */
export type ErrorReason = 'denied' | 'network';

/**
 * Ответ сервера для экрана со снимком:
 * fresh — свежие данные сохранены; denied — снимок стёрт, экран обнуляется;
 * kept — сбой связи или иная ошибка, снимок остаётся с «Повторить»;
 * stale — ответ прежнего поколения входа: не применять.
 */
export function settleSnap(
  uid: string | null | undefined,
  name: string | null,
  gen: number,
  r: { data: unknown; error: string | null; reason?: ErrorReason },
): 'fresh' | 'denied' | 'kept' | 'stale' {
  if (gen !== generation) return 'stale';
  if (r.data) {
    if (name) writeSnap(uid, name, r.data, gen);
    return 'fresh';
  }
  if (r.reason === 'denied') {
    if (name) dropSnap(uid, name);
    return 'denied';
  }
  return 'kept';
}

export function clearSnaps(): void {
  memory.clear();
  if (typeof window === 'undefined') return;
  for (const k of Object.keys(window.localStorage)) if (k.startsWith(PREFIX)) window.localStorage.removeItem(k);
}
