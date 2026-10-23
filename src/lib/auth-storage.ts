/**
 * Ключ, под которым supabase-js хранит сессию. По умолчанию SDK строит его из первого сегмента
 * домена (`sb-<hostname.split('.')[0]>-auth-token`), поэтому смена адреса сервера
 * (jrarbbfsqrkjckujfpcz.supabase.co → api.splitit-apps.com, версия 1.0.3) молча разлогинивала
 * всех при обновлении. Ключ закреплён за проектом Supabase, а не за адресом.
 */
export const AUTH_STORAGE_KEY = 'sb-jrarbbfsqrkjckujfpcz-auth-token';

/** Ключ сборки 1.0.3 «RU edge» (адрес api.splitit-apps.com). */
export const FORMER_KEY = 'sb-api-auth-token';
const SUFFIXES = ['', '-code-verifier', '-user'];

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Переносит данные входа 1.0.3 на закреплённый ключ. Всё, что лежит под ключом 1.0.3, записано позже
 * любой записи 1.0.2: 1.0.3 ставится поверх 1.0.2 и ключа 1.0.2 не видит. Поэтому при наличии записи 1.0.3
 * она заменяет запись 1.0.2 (иначе после «1.0.2 → 1.0.3 → повторный вход → 1.0.4» вернулся бы прежний
 * аккаунт или протухший refresh token). Каждый суффикс переносится отдельно: незавершённый PKCE-вход
 * в 1.0.3 оставляет code-verifier без сессии. Если пользователь вышел в 1.0.3 (основной записи нет),
 * сессия 1.0.2 тоже удаляется. Ограничение: полный выход в 1.0.3 не оставляет следов, поэтому
 * такой случай неотличим от «1.0.3 не открывали» и запись 1.0.2 остаётся (signOut в 1.0.3 по умолчанию
 * global и отзывает refresh token того же пользователя — запись 1.0.2 того же аккаунта не оживёт).
 * Ничего не делает без localStorage (SSR, тесты без DOM).
 */
export function migrateAuthStorage(storage: KV | undefined =
  typeof localStorage === 'undefined' ? undefined : localStorage): void {
  if (!storage) return;
  try {
    // После переноса ключи 1.0.3 удалены — повторный вызов ничего не делает.
    if (!SUFFIXES.some((s) => storage.getItem(FORMER_KEY + s) !== null)) return;
    const hadFormerSession = storage.getItem(FORMER_KEY) !== null;
    for (const s of SUFFIXES) {
      const v = storage.getItem(FORMER_KEY + s);
      if (v !== null) {
        storage.setItem(AUTH_STORAGE_KEY + s, v);
        storage.removeItem(FORMER_KEY + s);
      } else if (s === '' || s === '-user') {
        // 1.0.3 использовалась, но основной записи нет: вход в 1.0.3 не выполнен или был выход.
        if (!hadFormerSession) storage.removeItem(AUTH_STORAGE_KEY + s);
      }
    }
  } catch {
    // Хранилище недоступно (приватный режим и т. п.) — вход просто потребуется заново.
  }
}
