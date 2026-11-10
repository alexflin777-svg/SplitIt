/**
 * Логика страницы-моста /auth/telegram-native (payload виджета → token_hash → deep link).
 *
 * Совместимость (сайт выкатывается раньше приложения):
 * - приложение ≤ 1.1.0 открывает мост без ?attempt= и принимает deep link без него —
 *   мост отвечает как раньше, без attempt;
 * - приложение 1.1.1 передаёт ?attempt= и принимает callback только с ним — мост его возвращает.
 */

const DEEP_LINK = 'app.splitit.mobile://auth/callback';
const ATTEMPT = /^[0-9a-f-]{36}$/;

type Invoke = (body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export async function telegramBridgeAuth(
  user: Record<string, unknown>,
  search: string,
  invoke: Invoke,
): Promise<{ url: string; error?: undefined } | { error: string; url?: undefined }> {
  const attempt = new URLSearchParams(search).get('attempt');
  if (attempt !== null && !ATTEMPT.test(attempt)) {
    return { error: 'Страница открыта не из приложения SplitIT. Вернитесь в приложение и нажмите «Войти через Telegram».' };
  }
  const { data, error } = await invoke(user);
  const tokenHash = (data as { token_hash?: string } | null)?.token_hash;
  if (error || !tokenHash) {
    return { error: 'Не удалось подтвердить вход через Telegram. Закройте страницу и попробуйте ещё раз.' };
  }
  const q = new URLSearchParams({ tg_token_hash: tokenHash });
  if (attempt) q.set('attempt', attempt);
  return { url: `${DEEP_LINK}?${q}` };
}
