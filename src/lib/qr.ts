/**
 * QR-код ссылки приглашения: матрица считается локально (qrcode-generator, без
 * сети). Рисуем только абсолютную http(s)-ссылку — иначе код вёл бы в никуда.
 */
import qrcode from 'qrcode-generator';

export function qrMatrix(link: string | null | undefined): boolean[][] | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null; // не URL — QR не рисуем, экран показывает текст
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Библиотека кодирует символ одним байтом: не-ASCII дал бы QR другой ссылки.
  if (/[^\x20-\x7e]/.test(link)) return null;
  const qr = qrcode(0, 'M');
  qr.addData(link, 'Byte');
  try {
    qr.make();
  } catch {
    return null; // ссылка не влезает в QR (> ~2 КБ) — экран показывает текст вместо падения
  }
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** SVG-путь: тёмный модуль — квадрат 1×1 в координатах матрицы. */
export function qrPath(m: boolean[][]): string {
  return m.flatMap((row, r) => row.flatMap((dark, c) => (dark ? [`M${c} ${r}h1v1h-1z`] : []))).join('');
}
