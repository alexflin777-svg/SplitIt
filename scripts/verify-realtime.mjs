/**
 * Проверка Realtime на живом Supabase — единственный слой, который нельзя
 * подтвердить ни локальным PostgreSQL, ни HTTP-прогоном.
 *
 * Запуск:
 *   npm run verify:realtime                                    # без уборки
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run verify:realtime       # с уборкой
 *
 * Адрес и публикуемый ключ берутся из .env.local; VERIFY_SUPABASE_URL и
 * VERIFY_SUPABASE_ANON_KEY уводят прогон в песочницу. Обвязка общая с
 * `verify-production.mjs` — см. `scripts/lib/supabase-verify.mjs`.
 *
 * Почему отдельный скрипт. Postgres Changes идут по WebSocket и требуют
 * второго живого клиента. `npm run verify:prod` работает по HTTP и их не
 * трогает: зелёный HTTP-прогон не является доказательством Realtime. Здесь
 * поднимаются три настоящих клиента supabase-js с настоящими сессиями.
 *
 * Что проверяется:
 *   1. подписка участника действительно устанавливается (SUBSCRIBED);
 *   2. запись одного участника долетает до другого без перезагрузки;
 *   3. посторонний, подписанный на тот же канал, не получает ничего —
 *      RLS применяется к Postgres Changes (инвариант И-5);
 *   4. изменение самой группы долетает до участника;
 *   5. функция очистки действительно снимает подписку: после неё события
 *      перестают приходить.
 *
 * Отдельно сверяется список таблиц: если `subscribeToGroup` в
 * `src/lib/remote-store.ts` начнёт слушать другой набор, сценарий об этом
 * скажет, а не продолжит проверять устаревшую схему подписки.
 *
 * Про уборку — как в `verify-production.mjs`: три аккаунта и одно событие
 * удаляются service-ключом, результат проверяется тем же привилегированным
 * контекстом. Ключ передавайте строкой запуска, а не через .env.local.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';

import {
  ROOT,
  cleanupAccounts,
  createApi,
  createReporter,
  makeAccount,
  resolveConfig,
  signUpAccount,
} from './lib/supabase-verify.mjs';

/** Сколько ждём события, которое обязано прийти. Realtime на холодном канале не мгновенный. */
const EVENT_TIMEOUT_MS = Number(process.env.REALTIME_EVENT_TIMEOUT_MS || 20_000);
/** Сколько ждём после прихода ожидаемого события, прежде чем утверждать, что другой клиент тишину сохранил. */
const SILENCE_GRACE_MS = Number(process.env.REALTIME_SILENCE_GRACE_MS || 4_000);
/** Сколько ждём подтверждения самой подписки. */
const SUBSCRIBE_TIMEOUT_MS = 15_000;

/**
 * Таблицы, которые слушает `subscribeToGroup`. Держится синхронно с
 * `src/lib/remote-store.ts` — расхождение ловится проверкой ниже.
 */
const SUBSCRIBED_TABLES = ['groups', 'expenses', 'expense_splits', 'settlements', 'group_members'];

const config = resolveConfig();
const apiClient = createApi(config);
const { rest, rpc } = apiClient;
const report = createReporter();
const { ok, check, step } = report;

// --- сверка со сценарием подписки в приложении ---------------------------

/**
 * Вытаскивает имена таблиц из тела `subscribeToGroup`.
 *
 * Проверка нужна ровно затем, зачем нужен любой тест: чтобы он падал, когда
 * проверяемое поведение изменилось. Скрипт воспроизводит подписку приложения,
 * а не импортирует её (модуль завязан на браузерное окружение), поэтому копия
 * обязана сверяться с оригиналом.
 */
function tablesFromRemoteStore() {
  const source = readFileSync(path.join(ROOT, 'src', 'lib', 'remote-store.ts'), 'utf-8');
  const start = source.indexOf('export function subscribeToGroup');
  if (start === -1) throw new Error('в remote-store.ts не найдена subscribeToGroup');

  const body = source.slice(start);
  const end = body.indexOf('\n}');
  const scope = end === -1 ? body : body.slice(0, end);

  return [...scope.matchAll(/table:\s*'([^']+)'/g)].map((m) => m[1]);
}

// --- клиенты и сбор событий ----------------------------------------------

/** Клиент supabase-js с настоящей пользовательской сессией — как в браузере. */
async function clientFor(session) {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error } = await client.auth.setSession({
    access_token: session.token,
    refresh_token: session.refreshToken,
  });
  if (error) throw new Error(`не удалось установить сессию: ${error.message}`);

  // Явно, не полагаясь на порядок событий auth: без пользовательского токена
  // на сокете RLS отдаёт пустой поток, и сценарий провалился бы по причине,
  // не имеющей отношения к проверяемому поведению.
  await client.realtime.setAuth(session.token);

  return client;
}

/**
 * Повторяет подписку `subscribeToGroup` и складывает события в массив.
 *
 * Возвращает и функцию отписки — её отдельно проверяет шаг 5.
 */
function watchGroup(client, groupId, label) {
  const events = [];
  const channel = client
    .channel(`group:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups', filter: `id=eq.${groupId}` }, (p) =>
      events.push({ table: 'groups', type: p.eventType }),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` }, (p) =>
      events.push({ table: 'expenses', type: p.eventType }),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, (p) =>
      events.push({ table: 'expense_splits', type: p.eventType }),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${groupId}` }, (p) =>
      events.push({ table: 'settlements', type: p.eventType }),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, (p) =>
      events.push({ table: 'group_members', type: p.eventType }),
    );

  const subscribed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: подписка не подтвердилась за ${SUBSCRIBE_TIMEOUT_MS} мс`)),
      SUBSCRIBE_TIMEOUT_MS,
    );

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`${label}: канал не открылся (${status}${err ? `: ${err.message}` : ''})`));
      }
    });
  });

  return {
    label,
    events,
    subscribed,
    unsubscribe: () => client.removeChannel(channel),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const countFor = (watcher, table) => watcher.events.filter((e) => e.table === table).length;

/**
 * Ждёт, пока по таблице накопится `minCount` событий. Возвращает время ожидания
 * в миллисекундах или null, если не дождались.
 *
 * Считаем именно количество, а не факт наличия: на шаге 7 у владельца уже есть
 * событие с шага 4, и проверка «событие есть» прошла бы, не дождавшись нового.
 */
async function waitForTable(watcher, table, minCount = 1, timeoutMs = EVENT_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (countFor(watcher, table) >= minCount) return Date.now() - startedAt;
    await sleep(100);
  }
  return null;
}

// --- сценарий ------------------------------------------------------------

async function runScenario(state) {
  console.log(`Проверка Realtime ${config.url}\n${'─'.repeat(60)}`);

  step('0. Сценарий подписки совпадает с приложением');
  const appTables = tablesFromRemoteStore();
  check(
    'скрипт слушает те же таблицы, что и subscribeToGroup',
    appTables.length === SUBSCRIBED_TABLES.length && appTables.every((t) => SUBSCRIBED_TABLES.includes(t)),
    `в приложении: ${appTables.join(', ')} | в скрипте: ${SUBSCRIBED_TABLES.join(', ')}`,
  );

  step('1. Три аккаунта: владелец, участник, посторонний');
  const accounts = { a: makeAccount('rt-a'), b: makeAccount('rt-b'), c: makeAccount('rt-c') };
  const sessions = {};
  for (const key of ['a', 'b', 'c']) {
    sessions[key] = await signUpAccount(apiClient, accounts[key]);
    state.userIds.push(sessions[key].userId);
    state.emails.push(accounts[key].email);
  }
  ok('все три аккаунта получили рабочую сессию');

  step('2. Владелец создаёт событие, участник вступает по коду');
  const created = await rpc(
    'create_group_with_owner',
    { p_name: 'Проверка Realtime', p_category: 'trip', p_default_currency: 'RUB' },
    sessions.a.token,
  );
  if (!created.ok || typeof created.data !== 'string') {
    throw new Error(`create_group_with_owner: HTTP ${created.status} ${JSON.stringify(created.data)}`);
  }
  const groupId = created.data;
  state.groupIds.push(groupId);
  ok('событие создано', groupId);

  const code = `RT-${randomUUID().slice(0, 8).toUpperCase()}`;
  const invite = await rest('/group_invites', {
    token: sessions.a.token,
    method: 'POST',
    body: { group_id: groupId, invite_code: code, created_by: sessions.a.userId },
  });
  check('приглашение создано', invite.ok, JSON.stringify(invite.data));

  const redeem = await rpc('redeem_group_invite', { p_invite_code: code }, sessions.b.token);
  check('участник вступил', redeem.ok && redeem.data === groupId, JSON.stringify(redeem.data));

  step('3. Все трое открывают WebSocket-подписку на событие');
  const clients = {
    a: await clientFor(sessions.a),
    b: await clientFor(sessions.b),
    c: await clientFor(sessions.c),
  };
  state.clients = clients;

  const watchers = {
    a: watchGroup(clients.a, groupId, 'владелец'),
    b: watchGroup(clients.b, groupId, 'участник'),
    c: watchGroup(clients.c, groupId, 'посторонний'),
  };
  state.watchers = watchers;

  await Promise.all([watchers.a.subscribed, watchers.b.subscribed, watchers.c.subscribed]);
  ok('три канала подтвердили подписку', 'SUBSCRIBED');

  step('4. Запись участника долетает до владельца');
  const expense = await rpc(
    'add_expense_with_splits',
    {
      p_group_id: groupId,
      p_title: 'Заправка',
      p_amount: 3400,
      p_currency: 'RUB',
      p_amount_in_group_currency: 3400,
      p_category: 'transport',
      p_paid_by_id: sessions.b.userId,
      p_splits: [{ user_id: sessions.b.userId, amount_owed: 3400 }],
    },
    sessions.b.token,
  );
  check('участник записал расход', expense.ok, JSON.stringify(expense.data));

  const deliveredToOwner = await waitForTable(watchers.a, 'expenses');
  check(
    'владелец получил событие о чужом расходе без перезагрузки',
    deliveredToOwner !== null,
    `за ${EVENT_TIMEOUT_MS} мс события по expenses не пришло — проверьте публикацию supabase_realtime`,
  );

  step('5. Посторонний не получает ничего — RLS работает и на Postgres Changes (И-5)');
  await sleep(SILENCE_GRACE_MS);
  check(
    'посторонний подписан на тот же канал и не увидел ни одного события',
    watchers.c.events.length === 0,
    `посторонний получил: ${JSON.stringify(watchers.c.events)}`,
  );
  ok(
    'у владельца при этом события есть',
    watchers.a.events.map((e) => `${e.table}:${e.type}`).join(', ') || 'пусто',
  );

  step('6. Изменение самой группы долетает до участника');
  const renamed = await rest(`/groups?id=eq.${groupId}`, {
    token: sessions.a.token,
    method: 'PATCH',
    body: { name: 'Проверка Realtime — переименовано' },
  });
  check('владелец переименовал событие', renamed.ok, JSON.stringify(renamed.data));

  const deliveredToMember = await waitForTable(watchers.b, 'groups');
  check(
    'участник получил событие по таблице groups',
    deliveredToMember !== null,
    `за ${EVENT_TIMEOUT_MS} мс события по groups не пришло`,
  );

  step('7. Отписка действительно отписывает');
  const seenByMemberBefore = watchers.b.events.length;
  const ownerExpensesBefore = countFor(watchers.a, 'expenses');
  watchers.b.unsubscribe();
  await sleep(1_000);

  const secondExpense = await rpc(
    'add_expense_with_splits',
    {
      p_group_id: groupId,
      p_title: 'Кофе',
      p_amount: 800,
      p_currency: 'RUB',
      p_amount_in_group_currency: 800,
      p_category: 'food',
      p_paid_by_id: sessions.a.userId,
      p_splits: [{ user_id: sessions.a.userId, amount_owed: 800 }],
    },
    sessions.a.token,
  );
  check('владелец записал второй расход', secondExpense.ok, JSON.stringify(secondExpense.data));

  const ownerGotSecond = await waitForTable(watchers.a, 'expenses', ownerExpensesBefore + 1);
  check(
    'владелец, оставшийся подписанным, получил и второй расход',
    ownerGotSecond !== null,
    `событий по expenses осталось ${countFor(watchers.a, 'expenses')}, ожидалось ${ownerExpensesBefore + 1}`,
  );

  await sleep(SILENCE_GRACE_MS);
  check(
    'отписавшийся участник больше событий не получает',
    watchers.b.events.length === seenByMemberBefore,
    `после отписки пришло ещё ${watchers.b.events.length - seenByMemberBefore}`,
  );
}

// --- запуск --------------------------------------------------------------

async function main() {
  const state = { userIds: [], emails: [], groupIds: [], clients: null, watchers: null };

  try {
    await runScenario(state);
  } finally {
    // Сокеты закрываются раньше уборки: незакрытый WebSocket держит процесс,
    // и прогон, отработавший корректно, всё равно висел бы до таймаута CI.
    if (state.watchers) {
      for (const watcher of Object.values(state.watchers)) {
        try {
          watcher.unsubscribe();
        } catch {
          // Канал мог уже закрыться сам — на результат прогона это не влияет.
        }
      }
    }
    if (state.clients) {
      for (const client of Object.values(state.clients)) {
        await client.removeAllChannels();
        client.realtime.disconnect();
      }
    }

    if (state.userIds.length > 0 || state.groupIds.length > 0) {
      step('8. Уборка');
      try {
        await cleanupAccounts(config, apiClient, report, state);
      } catch (cleanupError) {
        report.fail('аварийная уборка завершилась ошибкой', cleanupError.message);
      }
    }
  }

  return report.summary();
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((e) => {
    console.error(`\nПрогон оборвался: ${e.message}`);
    process.exitCode = 1;
  });
