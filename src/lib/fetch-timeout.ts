/** Запрос к базе дольше этого — ошибка с «Повторить», а не бесконечная загрузка. */
export const DB_TIMEOUT_MS = 15_000;

/**
 * fetch с пределом времени. Свой signal запроса (отмена supabase-js) сохраняется:
 * где нет AbortSignal.any (старые WebView), побеждает он, а предел не ставится.
 */
export function fetchWithTimeout(base: typeof fetch, ms = DB_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const limit = AbortSignal.timeout(ms);
    const own = init?.signal;
    const signal = !own ? limit : typeof AbortSignal.any === 'function' ? AbortSignal.any([own, limit]) : own;
    return base(input, { ...init, signal });
  };
}
