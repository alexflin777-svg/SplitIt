/**
 * «Поделиться» без внешних зависимостей.
 *
 * Порядок: системный share-sheet (Web Share API — есть в Android WebView
 * Capacitor, iOS WKWebView, мобильных Chrome/Safari) → буфер обмена.
 * Результат возвращается явно: UI обязан сказать «скопировано», а не
 * притворяться, что сообщение отправлено.
 */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareText(text: string, url?: string): Promise<ShareOutcome> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
  if (!nav) return 'failed';

  if (typeof nav.share === 'function') {
    try {
      await nav.share(url ? { text, url } : { text });
      return 'shared';
    } catch (e) {
      // Пользователь закрыл шторку — это не ошибка и не повод копировать молча.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Иначе (NotAllowedError на десктопе и т. п.) — пробуем буфер обмена.
    }
  }

  try {
    await nav.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
