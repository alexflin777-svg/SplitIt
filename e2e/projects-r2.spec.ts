import { test, expect, Page } from '@playwright/test';

/**
 * Круг 2 этапа 3в (ревью Codex 3c-r1): ошибки сырого ввода в конструкторе и
 * мутации UI, которые прежние тесты не ловили. e2e-фейк store, как projects.spec.ts.
 */

async function loginAnya(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'splitit_local_user_session',
      JSON.stringify({ id: 'u-anya', email: 'anya@example.com', full_name: 'Аня', avatar_url: '👩' }),
    );
  });
}

async function fill(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.fill('');
  await input.fill(value);
}

/** Проект из одной Ани с шаблоном «Свои»; возвращает id. */
async function createSolo(page: Page, name: string): Promise<string> {
  await page.goto('/projects/new');
  await page.getByTestId('project-name').fill(name);
  await page.getByTestId('project-new-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(/\/projects\/invite/);
  return new URL(page.url()).searchParams.get('id')!;
}

async function addOp(page: Page, projectId: string, type: string, amount: string, title: string) {
  await page.goto(`/projects/add?id=${projectId}&type=${type}`);
  await page.getByTestId('op-amount').fill(amount);
  await page.getByTestId('op-title').fill(title);
  await page.getByTestId('op-save').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${projectId}`));
}

test('конструктор: ошибка сырого ввода блокирует «Готово» и уход назад, старое значение не прячется', async ({ page }) => {
  await loginAnya(page);
  await page.goto('/projects/new');
  await page.getByTestId('project-name').fill('Фотостудия');
  await page.getByTestId('project-new-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('method-percent').click();
  await page.getByTestId('member-row-0').click();
  await page.getByTestId('rate-hourly').click();

  await fill(page, 'rate-0', '1500');
  await expect(page.getByTestId('member-done')).toBeEnabled();
  await fill(page, 'rate-0', '1500,123');
  await expect(page.getByTestId('member-done')).toBeDisabled();
  await expect(page.getByTestId('terms-raw-error')).toBeVisible();
  await page.getByTestId('nav-back').click();
  await expect(page.getByTestId('terms-member')).toBeVisible(); // уйти с ошибкой нельзя
  await fill(page, 'rate-0', '1500');
  await expect(page.getByTestId('member-done')).toBeEnabled();

  await fill(page, 'share-0', '10o');
  await expect(page.getByTestId('member-done')).toBeDisabled();
  await page.getByTestId('nav-back').click();
  await expect(page.getByTestId('terms-member')).toBeVisible();
  await fill(page, 'share-0', '100');
  await page.getByTestId('member-done').click();
  await expect(page.getByTestId('member-row-0')).toContainText('1 500 ₽');
});

test('отказ Бори: на экране проекта список согласий и главная «Изменить условия»', async ({ page }) => {
  await loginAnya(page);
  const pid = await createSolo(page, 'Свадьба Ивановых');
  const code = await page.getByTestId('invite-link').getAttribute('data-code');
  const as = (who: string | null) =>
    page.evaluate((w) => (w ? window.localStorage.setItem('splitit_fake_projects_actor', w) : window.localStorage.removeItem('splitit_fake_projects_actor')), who);
  await as(JSON.stringify({ id: 'u-borya', name: 'Боря' }));
  await page.goto(`/projects/join?code=${code}`);
  await page.getByTestId('join-confirm').click();
  await as(null);
  await page.goto(`/projects/terms?id=${pid}`);
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${pid}`));
  await as(JSON.stringify({ id: 'u-borya', name: 'Боря' }));
  await page.goto(`/projects/consent?id=${pid}`);
  await page.getByTestId('consent-decline').click();
  await as(null);
  await page.goto(`/projects/detail?id=${pid}`);
  await expect(page.getByTestId('consent-list')).toContainText('Боря');
  await expect(page.getByTestId('consent-list')).toContainText('не согласен');
  await expect(page.getByTestId('project-declined-change')).toHaveAttribute('href', new RegExp(`/projects/terms\\?id=${pid}`));
});

test('e2e-подмена приглашений события: ссылка и экран входа вместо ошибки локального режима', async ({ page }) => {
  await loginAnya(page);
  await page.evaluate(() => {
    window.localStorage.setItem('splitit_e2e_invites', '1');
    window.localStorage.setItem(
      'splitit_local_groups_data',
      JSON.stringify([{ id: 'g1', name: 'Казань', category: 'trip', currency: 'RUB', status: 'active', createdBy: 'u-anya',
        members: [{ id: 'u-anya', name: 'Аня', avatar: 'А', role: 'owner' }], expenses: [], settlements: [] }]),
    );
  });
  await page.goto('/events/detail?id=g1&invite=1');
  await expect(page.getByTestId('event-invite-link')).toContainText(/\/invite\?code=E2E/);
  const link = await page.getByTestId('event-invite-link').innerText();
  await page.reload();
  await expect(page.getByTestId('event-invite-link')).toHaveText(link); // одна ссылка на событие
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByTestId('invite-error')).toHaveCount(0);
  await page.getByTestId('invite-join').click();
  await expect(page).toHaveURL(/\/events\/detail\?id=g1/);
});

test('итог: устаревшая revision из UI → отказ и обновлённый расчёт; возврат дохода — income_refund с пределом', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAnya(page);
  const pid = await createSolo(page, 'Фотостудия');
  await addOp(page, pid, 'income', '10 000', 'Съёмка');

  // Пока Аня смотрит итог, в другой вкладке появляется новая запись.
  await page.goto(`/projects/settle?id=${pid}`);
  await expect(page.getByTestId('settle-preview')).toContainText('10 000 ₽');
  const other = await ctx.newPage();
  await addOp(other, pid, 'income', '5 000', 'Печать');
  await page.getByTestId('settle-close').click();
  await expect(page.getByTestId('settle-changed')).toBeVisible();
  await expect(page.getByTestId('settle-preview')).toContainText('15 000 ₽');
  await expect(page.getByTestId('settle-preview')).not.toContainText('10 000 ₽');

  // Возврат дохода: больше остатка нельзя, с копейками — запись income_refund к доходу.
  await page.goto(`/projects/add?id=${pid}&type=refund`);
  await page.getByTestId('refund-of').filter({ hasText: 'Съёмка' }).click();
  await page.getByTestId('op-amount').fill('10 000,01');
  await expect(page.getByTestId('op-save')).toBeDisabled();
  await page.getByTestId('op-amount').fill('1 000,50');
  await page.getByTestId('op-save').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${pid}`));
  const ops = await page.evaluate(() => JSON.parse(window.localStorage.getItem('splitit_fake_projects')!).project_operations);
  const income = ops.find((o: { title: string }) => o.title === 'Съёмка');
  const refund = ops.find((o: { op_type: string }) => o.op_type === 'income_refund');
  expect(refund).toMatchObject({ refund_of: income.id, amount_in_project_currency: 100_050 });
  await page.goto(`/projects/settle?id=${pid}`);
  await expect(page.getByTestId('settle-preview')).toContainText('13 999,50 ₽');
  await ctx.close();
});
