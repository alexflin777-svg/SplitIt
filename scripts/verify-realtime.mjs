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
 * трогает: зелёный HTTP-прогон не является доказательством Realtime.
 *
 * ── Про прогрев, и почему без него тест врал ────────────────────────────
 *
 * Первый прогон на боевом проекте дал 17/18: запись участника не долетела до
 * владельца за 20 секунд, а всё остальное прошло. Вывод показал главное:
 * к моменту проверки у владельца не было НИ ОДНОГО события, включая
 * неотфильтрованные expense_splits, — канал молчал целиком. Позже, на той же
 * подписке, события пошли.
 *
 * Статус SUBSCRIBED подтверждает, что канал присоединён, но не гарантирует,
 * что серверная подписка на изменения уже установлена. Запись, сделанная в
 * этом окне, не долетает и не переигрывается: Postgres Changes не хранит
 * историю.
 *
 * Хуже, что при этом зеленела проверка «посторонний ничего не увидел».
 * Посторонний не увидел ничего потому, что события не увидел никто. Проверка,
 * которая проходит по той же причине, по которой падает соседняя, не проверяет
 * ничего — тот же дефект, что год назад дала anon-проверка уборки.
 *
 * Поэтому: сначала прогрев. Канал считается живым, только когда через него
 * реально прошло событие. До этого ни одно утверждение не проверяется. И у
 * постороннего есть собственная группа с собственным каналом — его молчание
 * на чужой группе засчитывается лишь тогда, когда его же сокет в тот же
 * промежуток доставляет события из своей.
 *
 * Что проверяется:
 *   1. подписка устанавливается и канал оживает (прогрев);
 *   2. запись участника долетает до владельца без перезагрузки;
 *   3. посторонний с заведомо живым сокетом не получает ничего из чужой
 *      группы — RLS применяется к Postgres Changes (инвариант И-5);
 *   4. изменение самой группы долетает до участника;
 *   5. функция очистки действительно снимает подписку.
 *
 * Отдельно сверяется список таблиц: если `subscribeToGroup` в
 * `src/lib/remote-store.ts` начнёт слушать другой набор, сценарий об этом
 * скажет, а не продолжит проверять устаревшую схему подписки.
 *
 * Про уборку — как в `verify-production.mjs`: аккаунты и обе группы удаляются
 * service-ключом, результат проверяется тем же привилегированным контекстом.
 * Ключ передавайте строкой запуска, а не через .env.local.
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

/** Сколько ждём события, которое обязано прийти. */
const EVENT_TIMEOUT_MS = Number(process.env.REALTIME_EVENT_TIMEOUT_MS || 20_000);
/** Сколько ждём после прихода ожидаемого события, прежде чем утверждать, что другой клиент молчал. */
const SILENCE_GRACE_MS = Number(process.env.REALTIME_SILENCE_GRACE_MS || 4_000);
/** Сколько ждём подтверждения самой подписки. */
const SUBSCRIBE_TIMEOUT_MS = 15_000;
/** Прогрев: сколько попыток и сколько ждать доставки в каждой. */
const WARMUP_ATTEMPTS = Number(process.env.REALTIME_WARMUP_ATTEMPTS || 8);
const WARMUP_WAIT_MS = Number(process.env.REALTIME_WARMUP_WAIT_MS || 4_000);

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

const startedAt = Date.now();
const since = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

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
 * Возвращает и функцию отписки — её отдельно проверяет последний шаг.
 */
function watchGroup(client, groupId, label) {
  const events = [];
  const record = (table) => (p) => events.push({ table, type: p.eventType, at: Date.now() });

  const channel = client
    .channel(`group:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups', filter: `id=eq.${groupId}` }, record('groups'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` }, record('expenses'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, record('expense_splits'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${groupId}` }, record('settlements'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, record('group_members'));

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
    /** Счётчик на момент вызова — от него отмеряются последующие ожидания. */
    mark: () => events.length,
    unsubscribe: () => client.removeChannel(channel),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const countFor = (watcher, table) => watcher.events.filter((e) => e.table === table).length;

/**
 * Ждёт, пока по таблице накопится `minCount` событий. Возвращает время ожидания
 * в миллисекундах или null, если не дождались.
 *
 * Считаем количество, а не факт наличия: у наблюдателя уже могут быть события
 * с прошлых шагов, и проверка «событие есть» прошла бы, не дождавшись нового.
 */
async function waitForTable(watcher, table, minCount = 1, timeoutMs = EVENT_TIMEOUT_MS) {
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < timeoutMs) {
    if (countFor(watcher, table) >= minCount) return Date.now() - waitStarted;
    await sleep(100);
  }
  return null;
}

/** Короткая расшифровка того, что наблюдатель успел получить. */
const digest = (watcher) =>
  watcher.events.map((e) => `${e.table}:${e.type}`).join(', ') || 'ничего';

/**
 * Гоняет действие, пока событие о нём не дойдёт до всех перечисленных
 * наблюдателей.
 *
 * Возвращает номер удачной попытки или null. Повтор нужен потому, что
 * серверная подписка может встать позже, чем канал ответил SUBSCRIBED, а
 * пропущенное событие не переигрывается.
 */
async function warmUp(label, action, watchers, table) {
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt += 1) {
    const marks = watchers.map((w) => countFor(w, table));
    const res = await action(attempt);
    if (res && res.ok === false) {
      throw new Error(`${label}: действие прогрева не выполнилось: ${JSON.stringify(res.data)}`);
    }

    const delivered = await Promise.all(
      watchers.map((w, i) => waitForTable(w, table, marks[i] + 1, WARMUP_WAIT_MS)),
    );
    if (delivered.every((d) => d !== null)) return attempt;
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

  const createGroup = async (name, token) => {
    const res = await rpc('create_group_with_owner', { p_name: name, p_category: 'trip', p_default_currency: 'RUB' }, token);
    if (!res.ok || typeof res.data !== 'string') {
      throw new Error(`create_group_with_owner: HTTP ${res.status} ${JSON.stringify(res.data)}`);
    }
    state.groupIds.push(res.data);
    return res.data;
  };

  step('2. Две группы: общая и своя у постороннего');
  const groupId = await createGroup('Проверка Realtime', sessions.a.token);
  ok('событие владельца создано', groupId);

  const code = `RT-${randomUUID().slice(0, 8).toUpperCase()}`;
  const invite = await rest('/group_invites', {
    token: sessions.a.token,
    method: 'POST',
    body: { group_id: groupId, invite_code: code, created_by: sessions.a.userId },
  });
  check('приглашение создано', invite.ok, JSON.stringify(invite.data));

  const redeem = await rpc('redeem_group_invite', { p_invite_code: code }, sessions.b.token);
  check('участник вступил', redeem.ok && redeem.data === groupId, JSON.stringify(redeem.data));

  // Своя группа постороннего — контрольная группа в прямом смысле слова.
  // Без неё его молчание на чужом канале ничего не доказывает: молчать можно
  // и из-за RLS, и из-за мёртвого сокета.
  const ownGroupId = await createGroup('Своя группа постороннего', sessions.c.token);
  ok('у постороннего есть своя группа', ownGroupId);

  step('3. Подписки');
  const clients = {
    a: await clientFor(sessions.a),
    b: await clientFor(sessions.b),
    c: await clientFor(sessions.c),
  };
  state.clients = clients;

  const watchers = {
    a: watchGroup(clients.a, groupId, 'владелец'),
    b: watchGroup(clients.b, groupId, 'участник'),
    cForeign: watchGroup(clients.c, groupId, 'посторонний на чужой группе'),
    cOwn: watchGroup(clients.c, ownGroupId, 'посторонний на своей группе'),
  };
  state.watchers = watchers;

  await Promise.all(Object.values(watchers).map((w) => w.subscribed));
  ok('четыре канала подтвердили подписку', `SUBSCRIBED, ${since()}`);

  step('4. Прогрев: канал считается живым только после реально прошедшего события');
  const renameShared = (attempt) =>
    rest(`/groups?id=eq.${groupId}`, {
      token: sessions.a.token,
      method: 'PATCH',
      body: { name: `Проверка Realtime — прогрев ${attempt}` },
    });
  const sharedWarm = await warmUp('общий канал', renameShared, [watchers.a, watchers.b], 'groups');
  check(
    'общий канал живой: изменение группы дошло до владельца и участника',
    sharedWarm !== null,
    `${WARMUP_ATTEMPTS} попыток по ${WARMUP_WAIT_MS} мс — событий по groups так и не было`,
  );

  const renameOwn = (attempt) =>
    rest(`/groups?id=eq.${ownGroupId}`, {
      token: sessions.c.token,
      method: 'PATCH',
      body: { name: `Своя группа постороннего — прогрев ${attempt}` },
    });
  const ownWarm = await warmUp('канал постороннего', renameOwn, [watchers.cOwn], 'groups');
  check(
    'сокет постороннего живой: своя группа события доставляет',
    ownWarm !== null,
    `${WARMUP_ATTEMPTS} попыток по ${WARMUP_WAIT_MS} мс — событий по groups так и не было`,
  );

  if (sharedWarm !== null) ok('прогрев общего канала', `попытка ${sharedWarm}, ${since()}`);
  if (ownWarm !== null) ok('прогрев канала постороннего', `попытка ${ownWarm}, ${since()}`);

  if (sharedWarm === null || ownWarm === null) {
    report.fail(
      'дальше проверять нечего',
      'на непрогретом канале и доставка, и тишина объясняются одним и тем же — мёртвой подпиской',
    );
    return;
  }

  step('5. Запись участника долетает до владельца');
  const expensesBefore = countFor(watchers.a, 'expenses');
  const foreignBefore = watchers.cForeign.events.length;

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

  const deliveredToOwner = await waitForTable(watchers.a, 'expenses', expensesBefore + 1);
  check(
    'владелец получил событие о чужом расходе без перезагрузки',
    deliveredToOwner !== null,
    `за ${EVENT_TIMEOUT_MS} мс события по expenses не пришло; у владельца сейчас: ${digest(watchers.a)}`,
  );
  if (deliveredToOwner !== null) ok('доставка заняла', `${deliveredToOwner} мс`);

  step('6. Посторонний не получает чужого — RLS работает и на Postgres Changes (И-5)');
  await sleep(SILENCE_GRACE_MS);
  check(
    'на чужой группе посторонний не увидел ни одного события',
    watchers.cForeign.events.length === foreignBefore,
    `посторонний получил: ${digest(watchers.cForeign)}`,
  );

  // Тишина засчитывается только вместе с доказательством, что сокет жив
  // именно сейчас, а не умер где-то между шагами.
  const ownBefore = countFor(watchers.cOwn, 'expenses');
  const ownExpense = await rpc(
    'add_expense_with_splits',
    {
      p_group_id: ownGroupId,
      p_title: 'Своя трата',
      p_amount: 100,
      p_currency: 'RUB',
      p_amount_in_group_currency: 100,
      p_category: 'other',
      p_paid_by_id: sessions.c.userId,
      p_splits: [{ user_id: sessions.c.userId, amount_owed: 100 }],
    },
    sessions.c.token,
  );
  check('посторонний записал расход в свою группу', ownExpense.ok, JSON.stringify(ownExpense.data));

  const ownDelivered = await waitForTable(watchers.cOwn, 'expenses', ownBefore + 1);
  check(
    'в ту же минуту его сокет доставляет события из своей группы',
    ownDelivered !== null,
    'сокет постороннего молчит вообще — тишина на чужой группе ничего не доказывает',
  );

  step('7. Отписка действительно отписывает');
  const memberBefore = watchers.b.events.length;
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
    `событий по expenses ${countFor(watchers.a, 'expenses')}, ожидалось ${ownerExpensesBefore + 1}`,
  );

  await sleep(SILENCE_GRACE_MS);
  check(
    'отписавшийся участник больше событий не получает',
    watchers.b.events.length === memberBefore,
    `после отписки пришло ещё ${watchers.b.events.length - memberBefore}`,
  );

  step('Что получил каждый канал');
  for (const watcher of Object.values(watchers)) {
    console.log(`  ${watcher.label}: ${digest(watcher)}`);
  }
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
