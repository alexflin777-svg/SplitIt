/**
 * Общая обвязка для живых проверок Supabase.
 *
 * Здесь лежит то, что одинаково у любого прогона по настоящему проекту:
 * чтение конфигурации, HTTP-транспорт к PostgREST и GoTrue, создание временных
 * аккаунтов, вывод результатов и уборка за собой.
 *
 * Модуль появился, когда к `verify-production.mjs` добавился
 * `verify-realtime.mjs`: два скрипта должны заводить аккаунты и убирать их
 * одинаково, иначе второй повторит дефект, который в первом уже починили.
 * Тот дефект стоил ложного зелёного: уборка проверялась anon-запросом, который
 * из-за RLS не видит остатка и потому всегда рапортует об успехе.
 *
 * Секреты: пароли генерируются случайно и живут только в памяти процесса,
 * service-ключ берётся из окружения и никуда не печатается.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Читает `.env.local`. Отсутствие файла — не ошибка: конфигурация может прийти из окружения. */
function loadEnvFile() {
  let raw;
  try {
    raw = readFileSync(path.join(ROOT, '.env.local'), 'utf-8');
  } catch {
    return {};
  }

  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    env[key] = rest.join('=').trim();
  }
  return env;
}

/**
 * Куда направлен прогон.
 *
 * По умолчанию — проект из `.env.local`. Переменные VERIFY_SUPABASE_URL и
 * VERIFY_SUPABASE_ANON_KEY перекрывают их и уводят прогон в песочницу:
 *
 *   VERIFY_SUPABASE_URL=https://... VERIFY_SUPABASE_ANON_KEY=... npm run verify:prod
 *
 * SUPABASE_SERVICE_ROLE_KEY передаётся строкой запуска и нужен только уборке:
 * он обходит RLS, и ему нечего делать рядом с клиентской конфигурацией.
 */
export function resolveConfig() {
  const fileEnv = loadEnvFile();
  const url = process.env.VERIFY_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.VERIFY_SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !anonKey) {
    console.error('Нет адреса проекта или публикуемого ключа.');
    console.error('Задайте VERIFY_SUPABASE_URL и VERIFY_SUPABASE_ANON_KEY либо заполните .env.local.');
    process.exit(1);
  }

  return { url, anonKey, serviceKey };
}

// --- вывод ---------------------------------------------------------------

/**
 * Счётчик проверок. Возвращается объектом, а не модульными переменными: два
 * скрипта в одном процессе не должны делить состояние.
 */
export function createReporter() {
  const state = { passed: 0, failed: 0 };

  const ok = (label, detail = '') => {
    state.passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  };

  const fail = (label, detail = '') => {
    state.failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  };

  return {
    ok,
    fail,
    check: (label, condition, detail) => (condition ? ok(label) : fail(label, detail)),
    step: (title) => console.log(`\n${title}`),
    get passed() {
      return state.passed;
    },
    get failed() {
      return state.failed;
    },
    summary() {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Пройдено: ${state.passed}   Провалено: ${state.failed}`);
      return state.failed === 0 ? 0 : 1;
    },
  };
}

// --- транспорт -----------------------------------------------------------

/** HTTP-обёртки вокруг конкретного проекта: PostgREST, RPC и привилегированный доступ. */
export function createApi(config) {
  async function api(pathname, { token, apiKey = config.anonKey, method = 'GET', body, prefer } = {}) {
    const headers = {
      apikey: apiKey,
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;

    const res = await fetch(`${config.url}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, ok: res.ok, data };
  }

  return {
    api,
    rest: (p, opts) => api(`/rest/v1${p}`, opts),
    rpc: (fn, args, token) => api(`/rest/v1/rpc/${fn}`, { token, method: 'POST', body: args }),
    adminRest: (p, opts = {}) =>
      api(`/rest/v1${p}`, { ...opts, token: config.serviceKey, apiKey: config.serviceKey }),
  };
}

// --- аккаунты ------------------------------------------------------------

/** Пароль генерируется случайно и живёт только в памяти этого процесса. */
export function makeAccount(tag) {
  return {
    tag,
    email: `splitit-verify-${tag}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`,
    password: `Pv-${randomUUID()}`,
  };
}

/**
 * Регистрирует временный аккаунт и возвращает его сессию.
 *
 * Возвращается и refresh_token: клиенту supabase-js нужна полная сессия, иначе
 * WebSocket Realtime подключается без пользовательского токена и RLS отдаёт
 * пустой поток вместо ожидаемых событий.
 */
export async function signUpAccount(apiClient, account) {
  const res = await apiClient.api('/auth/v1/signup', {
    method: 'POST',
    body: {
      email: account.email,
      password: account.password,
      data: { full_name: `Проверка ${account.tag}` },
    },
  });

  if (!res.ok || !res.data?.access_token) {
    const hint =
      res.data?.msg?.includes('confirm') || res.data?.error_description?.includes('confirm')
        ? ' (похоже, подтверждение email всё ещё включено)'
        : '';
    throw new Error(
      `регистрация ${account.tag} не удалась: HTTP ${res.status} ${JSON.stringify(res.data)}${hint}`,
    );
  }

  return {
    token: res.data.access_token,
    refreshToken: res.data.refresh_token,
    userId: res.data.user?.id,
  };
}

// --- уборка --------------------------------------------------------------

/**
 * Удаляет созданные события привилегированным Data API запросом, а затем
 * созданные аккаунты через Auth Admin API. Каскад группы уносит расходы, доли
 * и погашения.
 *
 * Результат проверяется тем же привилегированным контекстом. Проверять удаление
 * anon-запросом нельзя: RLS не покажет остаток даже если он есть, и уборка
 * отрапортует об успехе на живых строках — так уже случилось однажды.
 *
 * Без service-ключа уборка невозможна: клиент не может удалять пользователей,
 * и это правильно. Тогда печатается, что осталось удалить руками.
 */
export async function cleanupAccounts(config, apiClient, reporter, { userIds = [], emails = [], groupIds = [] }) {
  if (!config.serviceKey) {
    reporter.fail(
      'аккаунты остались в проекте',
      'нет SUPABASE_SERVICE_ROLE_KEY — удалите вручную в Authentication → Users',
    );
    if (emails.length) console.log(`      ${emails.join('\n      ')}`);
    for (const id of groupIds) console.log(`      событие: ${id}`);
    return;
  }

  for (const groupId of groupIds) {
    const deleted = await apiClient.adminRest(`/groups?id=eq.${groupId}`, {
      method: 'DELETE',
      prefer: 'return=representation',
    });
    reporter.check(
      'тестовое событие удалено service-role запросом',
      deleted.ok && deleted.data?.length === 1,
      JSON.stringify(deleted.data),
    );
  }

  let removed = 0;
  for (const id of userIds) {
    const res = await fetch(`${config.url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
    });
    if (res.ok) removed += 1;
  }

  if (removed === userIds.length) {
    reporter.ok('тестовые аккаунты удалены', 'проект остался чистым');
  } else {
    reporter.fail('удалить удалось не все аккаунты', `${removed} из ${userIds.length}`);
    console.log(`      ${emails.join('\n      ')}`);
  }

  for (const groupId of groupIds) {
    const left = await apiClient.adminRest(`/groups?id=eq.${groupId}&select=id`);
    reporter.check(
      'данные события действительно отсутствуют',
      left.ok && !left.data?.length,
      JSON.stringify(left.data),
    );
  }
}
