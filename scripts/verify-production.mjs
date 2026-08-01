/**
 * Проверка многопользовательского режима на живом Supabase.
 *
 * Запуск:
 *   npm run verify:prod                                   # без уборки
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run verify:prod      # с уборкой
 *
 * По умолчанию берёт адрес и публикуемый ключ из .env.local; переменные
 * VERIFY_SUPABASE_URL и VERIFY_SUPABASE_ANON_KEY перекрывают их и направляют
 * прогон на отдельный проект-песочницу. Общая обвязка — в
 * `scripts/lib/supabase-verify.mjs`.
 *
 * Тестовые аккаунты создаёт сам, пароли генерирует случайно и никуда не пишет.
 *
 * Зачем это нужно. Локальный харнесс (`npm run test:rls`) проверяет политики
 * базы на настоящем PostgreSQL, но не трогает HTTP-обвязку PostgREST и GoTrue.
 * Проверить её можно только живым прогоном под настоящей сессией — ровно это
 * здесь и происходит. Realtime идёт по WebSocket и проверяется отдельно:
 * `npm run verify:realtime`.
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
 * в конце и проверяет результат тем же привилегированным контекстом.
 *
 * Ключ передавайте строкой запуска, а не через .env.local: он обходит RLS, и
 * ему нечего делать рядом с клиентской конфигурацией.
 */

import { randomUUID } from 'node:crypto';

import {
  cleanupAccounts,
  createApi,
  createReporter,
  makeAccount,
  resolveConfig,
  signUpAccount,
} from './lib/supabase-verify.mjs';

const config = resolveConfig();
const apiClient = createApi(config);
const { rest, rpc } = apiClient;
const report = createReporter();
const { ok, check, step } = report;

// --- сценарий ------------------------------------------------------------

async function runScenario(state) {
  console.log(`Проверка ${config.url}\n${'─'.repeat(60)}`);

  step('1. Регистрация двух аккаунтов');
  const accountA = makeAccount('a');
  const accountB = makeAccount('b');
  const A = await signUpAccount(apiClient, accountA);
  state.userIds.push(A.userId);
  state.emails.push(accountA.email);
  const B = await signUpAccount(apiClient, accountB);
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
  state.groupIds.push(groupId);
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
  const state = { userIds: [], emails: [], groupIds: [] };

  try {
    await runScenario(state);
  } finally {
    if (state.userIds.length > 0 || state.groupIds.length > 0) {
      step('9. Уборка');
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
