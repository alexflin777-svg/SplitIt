/**
 * Edge Function: удаление аккаунта (требование Google Play и App Store).
 *
 * Поток:
 *   1. Клиент вызывает функцию со своим access token (supabase.functions.invoke
 *      подставляет его в Authorization). Платформа проверяет подпись JWT
 *      (функция деплоится БЕЗ --no-verify-jwt), здесь он проверяется ещё раз
 *      через auth.getUser — удалить можно только того, чей это токен.
 *   2. От имени этого же пользователя вызывается RPC public.delete_my_account():
 *      профиль и личные данные удаляются или обезличиваются в одной транзакции
 *      (миграция 20261009000000).
 *   3. Строка auth.users удаляется service-ролью. Повтор после сбоя безопасен:
 *      RPC идемпотентна, а уже удалённый пользователь не получит токен.
 *
 * Ошибка любого шага возвращается честно — клиент не выходит из аккаунта и
 * не сообщает «удалено», пока функция не ответила 200.
 *
 * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY функция
 * получает от платформы.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://www.splitit-apps.com',
  'https://splitit-apps.com',
  'http://localhost:3000',
  // WebView Capacitor: androidScheme и iosScheme = https (capacitor.config.json).
  'https://localhost',
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

  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) {
    return json({ error: 'missing access token' }, 401, origin);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Кто вызывает — решает токен, а не тело запроса: id из тела не читается.
  const { data: caller, error: callerError } = await admin.auth.getUser(jwt);
  if (callerError || !caller?.user) {
    return json({ error: 'invalid access token' }, 401, origin);
  }
  const userId = caller.user.id;

  // RPC выполняется от имени пользователя: auth.uid() внутри = его id.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { error: rpcError } = await asUser.rpc('delete_my_account');
  if (rpcError) {
    console.error('delete-account rpc failed:', userId, rpcError.message);
    return json({ error: 'could not delete account data' }, 500, origin);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    // Данные уже удалены/обезличены, но вход ещё возможен — повтор безопасен.
    console.error('delete-account deleteUser failed:', userId, deleteError.message);
    return json({ error: 'could not delete login' }, 502, origin);
  }

  return json({ status: 'deleted' }, 200, origin);
});
