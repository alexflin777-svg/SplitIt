/**
 * Canary — проверка того, что задеплоенное приложение живо и собрано правильно.
 *
 * Запуск:
 *   npm run canary                                  # боевой адрес по умолчанию
 *   CANARY_URL=https://превью.vercel.app npm run canary
 *
 * Проверка только читающая: ни одного запроса, который что-то создаёт или
 * меняет. Её можно гонять по расписанию и после каждого деплоя.
 *
 * Зачем. Два реальных сбоя этого проекта — деплой без переменных Supabase
 * (приложение молча уходило в локальный режим) и деплой без применённых
 * миграций (RPC не существует, а сборка при этом зелёная). Оба видны снаружи
 * обычными GET-запросами; до сих пор их никто не делал.
 *
 * Что проверяется:
 *   1. каждый маршрут статического экспорта отдаёт 200 — И-2;
 *   2. все чанки страниц загружаются;
 *   3. в конфигурации сборки нет плейсхолдеров — И-3;
 *   4. в бандле настоящий адрес проекта Supabase и ключ, то есть сборка
 *      в сетевом режиме, а не в тихом локальном;
 *   5. GoTrue отвечает;
 *   6. все таблицы схемы существуют — миграции доехали;
 *   7. аноним не видит ни одной строки — И-9;
 *   8. все RPC существуют и анониму недоступны — И-19.
 *
 * Про ключи. Публикуемый ключ и так лежит в клиентском бандле — тем он и
 * публикуемый. Скрипт достаёт его оттуда, чтобы не требовать конфигурации, и
 * никуда не печатает: в выводе только статусы и коды ошибок.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { ROOT, createReporter } from './lib/supabase-verify.mjs';

const BASE_URL = (process.env.CANARY_URL || 'https://split-it-ere9.vercel.app').replace(/\/$/, '');

/** Таблицы, у которых обязана быть и схема, и закрывающая политика. */
const TABLES = [
  'profiles',
  'groups',
  'group_members',
  'group_invites',
  'expenses',
  'expense_splits',
  'settlements',
];

/**
 * RPC и их параметры. Имена параметров обязательны: PostgREST ищет функцию по
 * ним, и вызов с пустым телом вернёт «функция не найдена» даже для
 * существующей функции — то есть даст ложную тревогу.
 *
 * Вызовы безопасны: `create_group_with_owner` первым делом требует
 * `auth.uid()`, остальные объявлены SECURITY INVOKER и упираются в RLS.
 * Аноним до тела функции не доходит вовсе — PostgreSQL отказывает на праве
 * EXECUTE, что и проверяется.
 */
const RPCS = [
  { name: 'create_group_with_owner', args: { p_name: 'canary', p_category: 'trip', p_default_currency: 'RUB' } },
  {
    name: 'add_expense_with_splits',
    args: {
      p_group_id: '00000000-0000-0000-0000-000000000000',
      p_title: 'canary',
      p_amount: 1,
      p_currency: 'RUB',
      p_amount_in_group_currency: 1,
      p_category: 'other',
      p_paid_by_id: '00000000-0000-0000-0000-000000000000',
      p_splits: [],
    },
  },
  {
    name: 'update_expense_with_splits',
    args: {
      p_expense_id: '00000000-0000-0000-0000-000000000000',
      p_title: 'canary',
      p_amount: 1,
      p_currency: 'RUB',
      p_amount_in_group_currency: 1,
      p_category: 'other',
      p_paid_by_id: '00000000-0000-0000-0000-000000000000',
      p_splits: [],
    },
  },
  { name: 'redeem_group_invite', args: { p_invite_code: 'canary-nonexistent' } },
];

const report = createReporter();
const { ok, fail, check, step } = report;

// --- маршруты ------------------------------------------------------------

/**
 * Маршруты берутся из `src/app`, а не из зашитого списка: добавленная страница
 * попадает под проверку сама, без правки canary.
 */
function routesFromSource() {
  const appDir = path.join(ROOT, 'src', 'app');
  const routes = [];

  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (entry === 'page.tsx') routes.push(prefix || '/');
      else if (statSync(full).isDirectory() && !entry.startsWith('_') && !entry.startsWith('(')) {
        walk(full, `${prefix}/${entry}`);
      }
    }
  };

  walk(appDir, '');
  return routes.sort();
}

/** Статический экспорт отдаёт `/auth/` как `auth/index.html`. */
const pageUrl = (route) => (route === '/' ? `${BASE_URL}/` : `${BASE_URL}${route}/`);

// --- проверки ------------------------------------------------------------

async function checkRoutes() {
  step('1. Маршруты статического экспорта');
  const routes = routesFromSource();
  const chunks = new Set();
  let broken = 0;

  for (const route of routes) {
    const res = await fetch(pageUrl(route));
    const html = res.ok ? await res.text() : '';
    if (!res.ok) {
      broken += 1;
      fail(`маршрут ${route}`, `HTTP ${res.status}`);
      continue;
    }
    for (const m of html.matchAll(/\/_next\/static\/[^"']+?\.js/g)) chunks.add(m[0]);
  }

  if (broken === 0) ok(`все маршруты отвечают 200`, `${routes.length} шт.`);
  return chunks;
}

async function checkBundle(chunkPaths) {
  step('2. Содержимое сборки');

  const sources = [];
  let failedToLoad = 0;
  for (const chunk of chunkPaths) {
    const res = await fetch(`${BASE_URL}${chunk}`);
    if (!res.ok) {
      failedToLoad += 1;
      fail(`чанк не загрузился ${chunk}`, `HTTP ${res.status}`);
      continue;
    }
    sources.push(await res.text());
  }
  if (failedToLoad === 0) ok('все чанки страниц загрузились', `${sources.length} шт.`);

  /**
   * Плейсхолдер ищется в конфигурации, а не по всему тексту.
   *
   * Дословный `grep placeholder` из И-3 на этой сборке даёт шесть совпадений и
   * все ложные: это атрибут placeholder у полей ввода и внутренняя переменная
   * роутера Next. Дефект S1-1 выглядел иначе — адресом вида
   * `https://placeholder-splitit.supabase.co` в вызове createClient.
   */
  const configPlaceholder = /(placeholder|example|your-project)[a-z0-9-]*\.supabase\.co/i;
  const withPlaceholder = sources.filter((s) => configPlaceholder.test(s));
  check(
    'в сборке нет плейсхолдерного адреса Supabase (И-3)',
    withPlaceholder.length === 0,
    `совпадений: ${withPlaceholder.length}`,
  );

  const url = sources.map((s) => s.match(/https:\/\/[a-z0-9]{15,}\.supabase\.co/)).find(Boolean)?.[0] || null;
  check(
    'в сборке настоящий адрес проекта Supabase (сетевой режим)',
    Boolean(url),
    'адреса нет — прод собран без NEXT_PUBLIC_SUPABASE_URL и работает локальным режимом',
  );

  const key =
    sources.map((s) => s.match(/sb_publishable_[A-Za-z0-9_-]{10,}/)).find(Boolean)?.[0] ||
    sources.map((s) => s.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/)).find(Boolean)?.[0] ||
    null;
  check(
    'в сборке есть публикуемый ключ',
    Boolean(key),
    'ключа нет — прод собран без NEXT_PUBLIC_SUPABASE_ANON_KEY',
  );

  if (url) ok('проект', url);
  return { url, key };
}

async function checkBackend({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  step('3. Бэкенд отвечает');
  const health = await fetch(`${url}/auth/v1/health`, { headers });
  check('GoTrue отвечает', health.status === 200, `HTTP ${health.status}`);

  step('4. Миграции применены и данные закрыты');
  for (const table of TABLES) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
    const body = await res.json().catch(() => null);

    if (res.status === 404) {
      fail(`таблица ${table}`, `нет в схеме (${body?.code}) — миграции не применены`);
      continue;
    }
    if (!res.ok) {
      fail(`таблица ${table}`, `HTTP ${res.status} ${JSON.stringify(body)}`);
      continue;
    }
    check(
      `таблица ${table} существует и закрыта для анонима`,
      Array.isArray(body) && body.length === 0,
      `аноним получил строк: ${Array.isArray(body) ? body.length : '?'}`,
    );
  }

  step('5. RPC существуют и анониму недоступны');
  for (const { name, args } of RPCS) {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => null);

    if (body?.code === 'PGRST202') {
      fail(`RPC ${name}`, 'функции нет в схеме — миграции не применены');
      continue;
    }
    check(
      `RPC ${name} существует и закрыт для анонима (И-19)`,
      body?.code === '42501',
      `HTTP ${res.status} ${JSON.stringify(body)}`,
    );
  }
}

// --- запуск --------------------------------------------------------------

async function main() {
  console.log(`Canary ${BASE_URL}\n${'─'.repeat(60)}`);

  const chunks = await checkRoutes();
  const bundle = await checkBundle(chunks);

  if (bundle.url && bundle.key) {
    await checkBackend(bundle);
  } else {
    step('3-5. Бэкенд не проверяется');
    fail('в сборке нет конфигурации Supabase', 'проверять бэкенд по чужим ключам бессмысленно');
  }

  return report.summary();
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((e) => {
    console.error(`\nCanary оборвался: ${e.message}`);
    process.exitCode = 1;
  });
