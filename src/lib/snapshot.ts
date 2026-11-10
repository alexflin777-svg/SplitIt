/**
 * Снимки экранов для показа сразу (stale-while-revalidate): последний ответ
 * сервера в памяти и в localStorage, ключ — id пользователя. Экран рисует
 * снимок и тут же перечитывает данные. Снимок — только для просмотра: экраны
 * фиксации итога и отметки переводов его не читают.
 *
 * Чистка: при выходе и смене аккаунта (supabase.ts) и при удалении аккаунта
 * (префикс splitit_ стирается целиком).
 */

const PREFIX = 'splitit_snap:';
const memory = new Map<string, unknown>();

const keyOf = (uid: string, name: string) => `${PREFIX}${uid}:${name}`;

export function readSnap<T>(uid: string | null | undefined, name: string): T | null {
  if (!uid || typeof window === 'undefined') return null;
  const key = keyOf(uid, name);
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch (e) {
    console.warn('[SplitIT] снимок не прочитан, экран подождёт сервер', name, e);
    return null;
  }
}

export function writeSnap(uid: string | null | undefined, name: string, value: unknown): void {
  if (!uid || typeof window === 'undefined') return;
  const key = keyOf(uid, name);
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Переполненное хранилище: снимок останется только в памяти — это не ошибка данных.
    console.warn('[SplitIT] снимок не сохранён в localStorage', name, e);
  }
}

export function clearSnaps(): void {
  memory.clear();
  if (typeof window === 'undefined') return;
  for (const k of Object.keys(window.localStorage)) if (k.startsWith(PREFIX)) window.localStorage.removeItem(k);
}
