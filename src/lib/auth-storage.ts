/**
 * Ключ, под которым supabase-js хранит сессию. По умолчанию SDK строит его из первого сегмента
 * домена (`sb-<hostname.split('.')[0]>-auth-token`), поэтому смена адреса сервера
 * (jrarbbfsqrkjckujfpcz.supabase.co → api.splitit-apps.com, версия 1.0.3) молча разлогинивала
 * всех при обновлении. Ключ закреплён за проектом Supabase, а не за адресом.
 */
export const AUTH_STORAGE_KEY = 'sb-jrarbbfsqrkjckujfpcz-auth-token';

/** Ключи, под которыми сессию могли сохранить сборки с другим адресом (1.0.3 «RU edge»). */
const FORMER_KEYS = ['sb-api-auth-token'];
const SUFFIXES = ['', '-code-verifier', '-user'];

/**
 * Переносит сессию со старого ключа на закреплённый, если под закреплённым пусто.
 * Вызывается до создания клиента. Ничего не делает без localStorage (SSR, тесты без DOM).
 */
export function migrateAuthStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined =
  typeof localStorage === 'undefined' ? undefined : localStorage): void {
  if (!storage) return;
  try {
    if (storage.getItem(AUTH_STORAGE_KEY)) return;
    for (const old of FORMER_KEYS) {
      if (!storage.getItem(old)) continue;
      for (const s of SUFFIXES) {
        const v = storage.getItem(old + s);
        if (v !== null) {
          storage.setItem(AUTH_STORAGE_KEY + s, v);
          storage.removeItem(old + s);
        }
      }
      return;
    }
  } catch {
    // Хранилище недоступно (приватный режим и т. п.) — вход просто потребуется заново.
  }
}
