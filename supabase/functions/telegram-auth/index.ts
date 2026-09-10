/**
 * Edge Function: вход через Telegram Login Widget.
 *
 * Поток:
 *   1. Клиент шлёт сюда payload виджета (id, имя, auth_date, hash…).
 *   2. Функция проверяет HMAC-подпись ботовым токеном (verify.ts) — без этой
 *      серверной проверки вход подделывается тривиально, поэтому клиентская
 *      реализация была отвергнута ещё 2026-08-16.
 *   3. Находит/создаёт пользователя с синтетическим e-mail tg<id>@telegram.local
 *      (Telegram не отдаёт настоящий адрес) и подтверждённой почтой.
 *   4. Выпускает одноразовый magiclink-токен и возвращает его клиенту;
 *      клиент обменивает его на сессию через supabase.auth.verifyOtp.
 *
 * Секреты (supabase secrets): TELEGRAM_BOT_TOKEN.
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY функция получает от платформы.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyTelegramAuth, type TelegramAuthPayload } from './verify.ts';

const ALLOWED_ORIGINS = new Set([
  'https://www.splitit-apps.com',
  'https://splitit-apps.com',
  'http://localhost:3000',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://www.splitit-apps.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405, origin);
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  if (!botToken) {
    // Честный ответ вместо симуляции: канал не настроен.
    return json({ error: 'Telegram login is not configured on the server.' }, 503, origin);
  }

  let payload: TelegramAuthPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, origin);
  }

  const verdict = await verifyTelegramAuth(payload, botToken);
  if (!verdict.ok) {
    // Причина в лог, наружу — обезличенно: нечего дарить перебору.
    console.warn('telegram-auth rejected:', verdict.reason);
    return json({ error: 'Telegram signature check failed.' }, 401, origin);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const email = `tg${payload.id}@telegram.local`;
  const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(' ')
    || payload.username
    || `Telegram ${payload.id}`;

  // Создаём пользователя; если он уже есть (email_exists) — это штатный
  // повторный вход. generateLink ниже работает по e-mail и сам вернёт user.
  // Такой порядок избавляет от listUsers-фильтров, которых в supabase-js v2 нет.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      avatar_url: payload.photo_url ?? '✈️',
      telegram_id: payload.id,
      telegram_username: payload.username ?? null,
      auth_provider: 'telegram',
    },
  });
  const emailTaken =
    createError &&
    (createError.code === 'email_exists' ||
      /already.*(registered|exists)/i.test(createError.message ?? ''));
  if (createError && !emailTaken) {
    console.error('telegram-auth createUser failed:', createError.message);
    return json({ error: 'could not create user' }, 502, origin);
  }
  const userId = created?.user?.id ?? null;

  // Одноразовый токен входа; клиент обменяет его на сессию через verifyOtp.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !link?.properties?.hashed_token) {
    console.error('telegram-auth generateLink failed:', linkError?.message);
    return json({ error: 'could not issue login token' }, 502, origin);
  }

  return json(
    {
      token_hash: link.properties.hashed_token,
      user: { id: link.user?.id ?? userId, full_name: fullName },
    },
    200,
    origin,
  );
});
