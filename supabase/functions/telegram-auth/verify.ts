/**
 * Проверка подписи Telegram Login Widget.
 *
 * Чистый модуль на Web Crypto (работает и в Deno Edge Function, и в Node-тестах
 * через tsx): никакой Deno-специфики, чтобы алгоритм был покрыт обычным гейтом.
 *
 * Алгоритм по документации Telegram (https://core.telegram.org/widgets/login):
 *   secret_key        = SHA256(bot_token)
 *   data_check_string = отсортированные "key=value" всех полей, кроме hash,
 *                       соединённые '\n'
 *   ожидаемый hash    = hex(HMAC_SHA256(data_check_string, secret_key))
 * Плюс проверка свежести auth_date: просроченный payload не принимается,
 * иначе перехваченные данные можно было бы переигрывать бесконечно.
 */

export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  [key: string]: unknown;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Сравнение за постоянное время: длина и все байты, без раннего выхода. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function buildDataCheckString(payload: Record<string, unknown>): string {
  return Object.keys(payload)
    .filter((k) => k !== 'hash' && payload[k] !== undefined && payload[k] !== null)
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join('\n');
}

export async function computeTelegramHash(
  payload: Record<string, unknown>,
  botToken: string,
): Promise<string> {
  const secretKey = await crypto.subtle.digest('SHA-256', encoder.encode(botToken));
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    encoder.encode(buildDataCheckString(payload)),
  );
  return toHex(signature);
}

export async function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
  maxAgeSeconds = 600,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!botToken) return { ok: false, reason: 'bot token is not configured' };
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'empty payload' };
  if (typeof payload.hash !== 'string' || payload.hash.length !== 64) {
    return { ok: false, reason: 'malformed hash' };
  }
  if (!Number.isInteger(payload.id) || payload.id <= 0) {
    return { ok: false, reason: 'malformed telegram id' };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: 'malformed auth_date' };
  }
  if (nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'auth_date is too old' };
  }
  // Небольшой допуск на рассинхрон часов; сильно «из будущего» — подделка.
  if (authDate - nowSeconds > 60) {
    return { ok: false, reason: 'auth_date is in the future' };
  }

  const expected = await computeTelegramHash(payload, botToken);
  if (!timingSafeEqualHex(expected, payload.hash.toLowerCase())) {
    return { ok: false, reason: 'signature mismatch' };
  }

  return { ok: true };
}
