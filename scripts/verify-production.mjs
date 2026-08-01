/**
 * Проверка многопользовательского режима на живом Supabase.
 *
 * Запуск:
 *   npm run verify:prod                                   # без уборки
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run verify:prod      # с уборкой
 *
 * По умолчанию берёт адрес и публикуемый ключ из .env.local; переменные
 * VERIFY_SUPABASE_URL и VERIFY_SUPABASE_ANON_KEY перекрывают их и направляют
 * прогон на отдельный проект-песочницу.
 *
 * Тестовые аккаунты создаёт сам, пароли генерирует случайно и никуда не пишет.
 *
 * Зачем это нужно. Локальный харнесс (`npm run test:rls`) проверяет политики
 * базы на настоящем PostgreSQL, но не трогает HTTP-обвязку PostgREST и GoTrue.
 * Проверить её можно только живым прогоном под настоящей сессией — ровно это
 * здесь и происходит. Realtime требует отдельного WebSocket-сценария.
 *
 * Что проверяется:
 *   1. регистрация выдаёт рабочую сессию;
 *   2. профиль создаётся триггером на auth.users;
 *   3. создание группы атомарно, автор становится владельцем;
 *   4. посторонний не видит чужую группу и её расходы;
 *   5. посторонний не может открыть группу по прямому id;
 *   6. вступление по коду работает, и данные становятся видны;
 *   7. код одноразовый: повторное использование отклоняется;
 *   8. вступивший не становится владельцем;
 *   9. выход из группы возвращает данные в недоступное состояние.
 *
 * Про уборку. Прогон создаёт два аккаунта и одно событие в той базе, на
 * которую направлен. С переданным SUPABASE_SERVICE_ROLE_KEY скрипт удаляет их
 * в конце. Событие удаляется отдельным service-role запросом, затем Admin API
 * удаляет пользователей, а внешние ключи уносят расходы, доли и погашения —
 * база остаётся чистой. Без ключа удалить пользователей нельзя (клиенту это и
 * не положено), и скрипт печатает, что осталось удалить руками.
 *
 * Ключ передавайте строкой запуска, а не через .env.local: он обходит RLS, и
 * ему нечего делать рядом с клиентской конфигурацией.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const raw = readFileSync(path.join(ROOT, '.env.local'), 'utf-8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    env[key] = rest.join('=').trim();
  }
  return env;
}

const fileEnv = loadEnv();

/**
 * Переменные окружения перекрывают .env.local — так прогон направляется на
 * отдельный проект-песочницу, не трогая боевой:
 *
 *   VERIFY_SUPABASE_URL=https://... VERIFY_SUPABASE_ANON_KEY=... npm run verify:prod
 */
const SUPABASE_URL = process.env.VERIFY_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.VERIFY_SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Ключ для уборки. Скрипт его не хранит и не пишет никуда — берёт из окружения
 * текущего процесса и использует один раз, чтобы удалить созданные аккаунты.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run verify:prod
 *
 * Передавайте его строкой запуска, а не через .env.local: этот ключ обходит
 * RLS, и ему нечего делать рядом с клиентской конфигурацией.
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Нет адреса проекта или публикуемого ключа.');
  console.error('Задайте VERIFY_SUPABASE_URL и VERIFY_SUPABASE_ANON_KEY либо заполните .env.local.');
  process.exit(1);
}

// --- вывод ---------------------------------------------------------------

let passed = 0;
let failed = 0;

function ok(label, detail = '') {
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  failed += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function check(label, condition, detail) {
  condition ? ok(label) : fail(label, detail);
}

function step(title) {
  console.log(`\n${title}`);
}

// --- транспорт -----------------------------------------------------------

async function api(pathname, { token, apiKey = ANON_KEY, method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: apiKey,
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
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

const rest = (p, opts) => api(`/rest/v1${p}`, opts);
const rpc = (fn, args, token) => api(`/rest/v1/rpc/${fn}`, { token, method: 'POST', body: args });
const adminRest = (p, opts = {}) =>
  api(`/rest/v1${p}`, { ...opts, token: SERVICE_KEY, apiKey: SERVICE_KEY });

/** Пароль генерируется случайно и живёт только в памяти этого процесса. */
function makeAccount(tag) {
  return {
    tag,
    email: `splitit-verify-${tag}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`,
    password: `Pv-${randomUUID()}`,
  };
}

async function signUp(account) {
  const res = await api('/auth/v1/signup', {
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

  return { token: res.data.access_token, userId: res.data.user?.id };
}

// --- сценарий ------------------------------------------------------------

async function runScenario(state) {
  console.log(`Проверка ${SUPABASE_URL}\n${'─'.repeat(60)}`);

  step('1. Регистрация двух аккаунтов');
  const accountA = makeAccount('a');
  const accountB = makeAccount('b');
  const A = await signUp(accountA);
  state.userIds.push(A.userId);
  state.emails.push(accountA.email);
  const B = await signUp(accountB);
  state.userIds.push(B.userId);
  state.emails.push(accountB.email);
  ok('оба аккаунта получили рабочую сессию');
  check('идентификаторы различаются', A.userId !== B.userId);

  step('2. Профиль создаётся триггером при регистрации');
  const profileA = await rest(`/profiles?id=eq.${A.userId}&select=id,full_name`, { token: A.token });
  check(
    'профиль A существует',
    profileA.data?.length === 1,
    'без профиля RLS не найдёт пользователя — проверьте триггер on_auth_user_created',
  );

  step('3. A создаёт событие и расход');
  const created = await rpc(
    'create_group_with_owner',
    { p_name: 'Проверка сетевого режима', p_category: 'trip', p_default_currency: 'RUB' },
    A.token,
  );
  if (!created.ok || typeof created.data !== 'string') {
    throw new Error(`create_group_with_owner: HTTP ${created.status} ${JSON.stringify(created.data)}`);
  }
  const groupId = created.data;
  state.groupId = groupId;
  ok('событие создано', groupId);

  const members = await rest(`/group_members?group_id=eq.${groupId}&select=user_id,role`, {
    token: A.token,
  });
  check(
    'автор сразу владелец',
    members.data?.length === 1 && members.data[0].role === 'owner',
    JSON.stringify(members.data),
  );

  const expense = await rpc(
    'add_expense_with_splits',
    {
      p_group_id: groupId,
      p_title: 'Аренда дома',
      p_amount: 9000,
      p_currency: 'RUB',
      p_amount_in_group_currency: 9000,
      p_category: 'lodging',
      p_paid_by_id: A.userId,
      p_splits: [{ user_id: A.userId, amount_owed: 9000 }],
    },
    A.token,
  );
  check('расход записан вместе с долями', expense.ok, JSON.stringify(expense.data));

  step('4. B не видит чужое');
  const bGroups = await rest('/groups?select=id', { token: B.token });
  check('список событий у B пуст', bGroups.data?.length === 0, JSON.stringify(bGroups.data));

  const bExpenses = await rest('/expenses?select=id', { token: B.token });
  check('расходы у B не видны', bExpenses.data?.length === 0, JSON.stringify(bExpenses.data));

  const bDirect = await rest(`/groups?id=eq.${groupId}&select=id,name`, { token: B.token });
  check(
    'прямой доступ по id закрыт',
    bDirect.data?.length === 0,
    'RLS пропустил чужую группу по прямому идентификатору',
  );

  const bInvites = await rest('/group_invites?select=invite_code', { token: B.token });
  check('коды приглашений не видны', bInvites.data?.length === 0, JSON.stringify(bInvites.data));

  step('5. Приглашение');
  const code = `VERIFY-${randomUUID().slice(0, 8).toUpperCase()}`;
  const invite = await rest('/group_invites', {
    token: A.token,
    method: 'POST',
    body: { group_id: groupId, invite_code: code, created_by: A.userId },
  });
  check('владелец создал приглашение', invite.ok, JSON.stringify(invite.data));

  const bSelfInsert = await rest('/group_members', {
    token: B.token,
    method: 'POST',
    body: { group_id: groupId, user_id: B.userId, role: 'member' },
  });
  check(
    'прямая самозапись в чужую группу отклонена',
    !bSelfInsert.ok,
    'B смог вписать себя без приглашения',
  );

  const redeem = await rpc('redeem_group_invite', { p_invite_code: code }, B.token);
  check('вступление по коду сработало', redeem.ok && redeem.data === groupId, JSON.stringify(redeem.data));

  const repeat = await rpc('redeem_group_invite', { p_invite_code: code }, B.token);
  check('код одноразовый', !repeat.ok, 'повторное использование прошло — код не расходуется');

  step('6. После вступления данные видны');
  const bGroupsAfter = await rest('/groups?select=id,name', { token: B.token });
  check('B видит событие', bGroupsAfter.data?.length === 1, JSON.stringify(bGroupsAfter.data));

  const bExpensesAfter = await rest('/expenses?select=id,amount', { token: B.token });
  check('B видит расход', bExpensesAfter.data?.length === 1, JSON.stringify(bExpensesAfter.data));

  const bProfiles = await rest('/profiles?select=full_name', { token: B.token });
  check(
    'B видит участников группы, но не посторонних',
    bProfiles.data?.length === 2,
    `видно профилей: ${bProfiles.data?.length}`,
  );

  step('7. Участник не становится владельцем');
  const rename = await rest(`/groups?id=eq.${groupId}`, {
    token: B.token,
    method: 'PATCH',
    body: { name: 'Переименовано участником' },
    prefer: 'return=representation',
  });
  const nameNow = await rest(`/groups?id=eq.${groupId}&select=name`, { token: A.token });
  check(
    'участник не переименовал чужое событие',
    nameNow.data?.[0]?.name === 'Проверка сетевого режима',
    `имя стало: ${nameNow.data?.[0]?.name} (ответ PATCH: ${rename.status})`,
  );

  const foreignSettlement = await rest('/settlements', {
    token: B.token,
    method: 'POST',
    body: { group_id: groupId, payer_id: A.userId, payee_id: B.userId, amount: 500 },
  });
  check('перевод от чужого имени отклонён', !foreignSettlement.ok, JSON.stringify(foreignSettlement.data));

  step('8. Выход из группы');
  const leave = await rest(`/group_members?group_id=eq.${groupId}&user_id=eq.${B.userId}`, {
    token: B.token,
    method: 'DELETE',
  });
  check('B вышел из группы', leave.ok, JSON.stringify(leave.data));

  const bAfterLeave = await rest('/expenses?select=id', { token: B.token });
  check(
    'после выхода расходы снова недоступны',
    bAfterLeave.data?.length === 0,
    JSON.stringify(bAfterLeave.data),
  );
}

async function main() {
  const state = { userIds: [], emails: [], groupId: null };

  try {
    await runScenario(state);
  } finally {
    if (state.userIds.length > 0 || state.groupId) {
      step('9. Уборка');
      try {
        await cleanup(state.userIds, state.emails, state.groupId);
      } catch (cleanupError) {
        fail('аварийная уборка завершилась ошибкой', cleanupError.message);
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Пройдено: ${passed}   Провалено: ${failed}`);

  return failed === 0 ? 0 : 1;
}

/**
 * Удаляет созданное событие привилегированным Data API запросом, а затем
 * созданные аккаунты через Auth Admin API. Каскад группы уносит расходы, доли
 * и погашения.
 *
 * Без service-ключа уборка невозможна: клиент не может удалять пользователей,
 * и это правильно. Тогда скрипт печатает, что осталось, чтобы удалить руками.
 */
async function cleanup(userIds, emails, groupId) {
  if (!SERVICE_KEY) {
    fail(
      'аккаунты остались в проекте',
      'нет SUPABASE_SERVICE_ROLE_KEY — удалите вручную в Authentication → Users',
    );
    console.log(`      ${emails.join('\n      ')}`);
    if (groupId) console.log(`      событие: ${groupId}`);
    return;
  }

  if (groupId) {
    const deletedGroup = await adminRest(`/groups?id=eq.${groupId}`, {
      method: 'DELETE',
      prefer: 'return=representation',
    });
    check(
      'тестовое событие удалено service-role запросом',
      deletedGroup.ok && deletedGroup.data?.length === 1,
      JSON.stringify(deletedGroup.data),
    );
  }

  let removed = 0;
  for (const id of userIds) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (res.ok) removed += 1;
  }

  if (removed === userIds.length) {
    ok('тестовые аккаунты удалены', 'проект остался чистым');
  } else {
    fail('удалить удалось не все аккаунты', `${removed} из ${userIds.length}`);
    console.log(`      ${emails.join('\n      ')}`);
  }

  // Проверяем остаток тем же привилегированным контекстом. Anon-запрос здесь
  // всегда видит пусто из-за RLS и способен дать ложноположительный результат.
  if (groupId) {
    const left = await adminRest(`/groups?id=eq.${groupId}&select=id`);
    check(
      'данные события действительно отсутствуют',
      left.ok && !left.data?.length,
      JSON.stringify(left.data),
    );
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((e) => {
    console.error(`\nПрогон оборвался: ${e.message}`);
    process.exitCode = 1;
  });
