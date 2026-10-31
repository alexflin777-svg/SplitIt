import { test, expect, Page } from '@playwright/test';

/**
 * «Проект» 1.1.0 сквозь экраны, на e2e-фейке store (build:test без бэкенда,
 * src/lib/projects-e2e-fake.ts — тот же контракт RPC и тот же расчёт ядра).
 * Цифры — PROJECT-SPEC §3а.4 и §3а.6: предпросмотр 34 000 / 44 000 / 22 000,
 * итог Аня → Вика 41 000, Аня → Боря 10 000.
 *
 * Участники с аккаунтом приходят по ссылке (гостя к аккаунту привязать нельзя —
 * не в 1.1.0), поэтому Боря входит по приглашению, а условия §3а.4 Аня
 * предлагает после его входа — первоначальные, до первого итога.
 */

const ACTOR = 'splitit_fake_projects_actor';

async function asAnya(page: Page) {
  await page.evaluate((k) => window.localStorage.removeItem(k), ACTOR);
}
async function asBorya(page: Page) {
  await page.evaluate((k) => window.localStorage.setItem(k, JSON.stringify({ id: 'u-borya', name: 'Боря' })), ACTOR);
}

/** Поле суммы/количества: очистить и ввести. */
async function fill(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.fill('');
  await input.fill(value);
}

async function openMember(page: Page, idx: number) {
  await page.getByTestId(`member-row-${idx}`).click();
  await expect(page.getByTestId('terms-member')).toBeVisible();
}

async function back(page: Page) {
  await page.getByTestId('nav-back').click();
}

test('проект: создать → позвать → условия → предпросмотр → согласие → операции → итог → отметки', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'splitit_local_user_session',
      JSON.stringify({ id: 'u-anya', email: 'anya@example.com', full_name: 'Аня', avatar_url: '👩' }),
    );
  });

  // 1. Создание: «Что создаём? → Проект», название, гость по имени.
  await page.goto('/events/new');
  await page.getByTestId('kind-project').click();
  await expect(page.getByTestId('project-new')).toBeVisible();
  await page.getByTestId('project-name').fill('Свадьба Ивановых');
  await page.getByTestId('guest-add').click();
  await page.getByTestId('guest-name').fill('Вика');
  await page.getByTestId('guest-save').click();
  await page.getByTestId('project-new-next').click();

  // 2. Конструктор в режиме «Создание»: шаблон → настройка → пример → «Создать проект».
  await expect(page.getByTestId('terms-template')).toBeVisible();
  await page.getByTestId('preset-custom').click();
  await page.getByTestId('terms-next').click();
  await expect(page.getByTestId('terms-setup')).toBeVisible();
  await page.getByTestId('terms-next').click();
  await expect(page.getByTestId('terms-preview')).toBeVisible();
  await page.getByTestId('terms-submit').click();

  // 3. «Позови участников»: одна ссылка; Боря входит по ней.
  await expect(page).toHaveURL(/\/projects\/invite\?id=.+&created=1/);
  const link = page.getByTestId('invite-link');
  await expect(link).toHaveAttribute('data-code', /.{16,}/);
  const code = await link.getAttribute('data-code');
  const projectId = new URL(page.url()).searchParams.get('id')!;
  await page.reload();
  await expect(page.getByTestId('invite-link')).toHaveAttribute('data-code', code!); // не перевыпускается

  await asBorya(page);
  await page.goto(`/projects/join?code=${code}`);
  await expect(page.getByTestId('join-card')).toContainText('Свадьба Ивановых');
  await expect(page.getByTestId('join-card')).toContainText('Аня');
  await page.getByTestId('join-confirm').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${projectId}`));
  await expect(page.getByTestId('terms-waiting')).toBeVisible();

  // 4. Аня настраивает условия §3а.4 (до первого итога — первоначальные).
  await asAnya(page);
  await page.goto(`/projects/terms?id=${projectId}`);
  await expect(page.getByTestId('terms-setup')).toBeVisible();
  await page.getByTestId('toggle-contrib').click();
  // Порядок участников: Аня (0), Вика (1, гость), Боря (2, по ссылке).
  await openMember(page, 2);
  await page.getByTestId('toggle-remainder').click();
  await page.getByTestId('contrib-add').click();
  await fill(page, 'contrib-2', '30 000');
  await back(page);
  await page.getByTestId('method-percent').click();

  await openMember(page, 0);
  await page.getByTestId('rate-period').click();
  await fill(page, 'rate-0', '20000');
  await fill(page, 'share-0', '40');
  await back(page);

  await openMember(page, 1);
  await page.getByTestId('rate-hourly').click();
  await fill(page, 'rate-1', '1500');
  await fill(page, 'share-1', '10');
  // Ошибка долей видна у поля и над кнопкой, «Готово» неактивна.
  await expect(page.getByTestId('terms-member')).toContainText('нужно 100 %');
  await expect(page.getByTestId('member-done')).toBeDisabled();
  await back(page);

  await openMember(page, 2);
  await fill(page, 'share-2', '40');
  await back(page);
  await openMember(page, 1);
  await fill(page, 'share-1', '20');
  await expect(page.getByTestId('member-done')).toBeEnabled();
  await page.getByTestId('member-done').click();

  // 5. Предпросмотр: 40 000 / 50 000 / 10 000 → Вике примерно 10 ч → 34 000 / 44 000 / 22 000.
  await page.getByTestId('terms-next').click();
  await expect(page.getByTestId('terms-preview')).toBeVisible();
  await expect(page.getByTestId('preview-owed-0')).toHaveText('40 000 ₽');
  await expect(page.getByTestId('preview-owed-2')).toHaveText('50 000 ₽');
  await expect(page.getByTestId('preview-owed-1')).toHaveText('10 000 ₽');
  await fill(page, 'preview-hours-1', '10');
  await expect(page.getByTestId('preview-owed-0')).toHaveText('34 000 ₽');
  await expect(page.getByTestId('preview-owed-2')).toHaveText('44 000 ₽');
  await expect(page.getByTestId('preview-owed-1')).toHaveText('22 000 ₽');
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${projectId}`));
  await expect(page.getByTestId('terms-waiting')).toContainText('Боря');

  // 6. Согласие Бори: «Что для тебя» → «Принять условия».
  await asBorya(page);
  await page.goto(`/projects/consent?id=${projectId}`);
  await expect(page.getByTestId('consent-for-me')).toContainText('30 000 ₽');
  await expect(page.getByTestId('consent-for-me')).toContainText('40 % остатка');
  // Пример: при 0 ч Вики — 50 000; при тех же 10 ч, что видела Аня, — 44 000 (макет h1-bory).
  await expect(page.getByTestId('consent-example')).toContainText('50 000 ₽');
  await fill(page, 'consent-hours-1', '10');
  await expect(page.getByTestId('consent-example')).toContainText('44 000 ₽');
  await page.getByTestId('consent-accept').click();
  await expect(page.getByTestId('terms-accepted')).toBeVisible();

  // 7. Операции §3а.4 (записывает Аня), часы гостя Вики вносит владелец.
  await asAnya(page);
  const add = async (type: 'income' | 'expense', amount: string, memberIdx: number, title: string) => {
    await page.goto(`/projects/add?id=${projectId}&type=${type}`);
    await expect(page.getByTestId('add-op')).toBeVisible();
    await page.getByTestId('op-amount').fill(amount);
    await page.getByTestId('op-title').fill(title);
    await page.getByTestId(`op-member-${memberIdx}`).click();
    await page.getByTestId('op-save').click();
    await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${projectId}`));
  };
  await add('income', '120 000', 0, 'Предоплата');
  await add('income', '60 000', 2, 'Остаток после свадьбы');
  await add('expense', '15 000', 0, 'Свет');
  await add('expense', '6 000', 2, 'Такси');
  await add('expense', '9 000', 1, 'Флористика');
  await expect(page.getByTestId('project-stats')).toContainText('180 000 ₽');
  await expect(page.getByTestId('project-stats')).toContainText('150 000 ₽');

  await page.getByTestId('qty-enter').first().click();
  await expect(page.getByTestId('add-qty')).toBeVisible();
  await fill(page, 'qty-hours', '10');
  await expect(page.getByTestId('add-qty')).toContainText('15 000 ₽');
  await page.getByTestId('qty-save').click();
  await expect(page.getByTestId('qty-block')).toContainText('10 ч');
  await expect(page.getByTestId('project-mine')).toContainText('51 000 ₽');

  // 8. Итог: Аня → Вика 41 000, Аня → Боря 10 000; «из чего сумма» у Вики.
  await page.getByTestId('project-settle').click();
  await expect(page.getByTestId('settle-preview')).toBeVisible();
  const rows = page.getByTestId('settle-transfers').getByTestId('transfer-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Вика' })).toContainText('41 000 ₽');
  await expect(rows.filter({ hasText: 'Боря' })).toContainText('10 000 ₽');
  await page.getByRole('tab', { name: 'Вика' }).click();
  await expect(page.getByTestId('settle-breakdown')).toContainText('Работа 10 ч × 1 500 ₽');
  await expect(page.getByTestId('settle-breakdown')).toContainText('41 000 ₽');

  // Отказ базы: ничего не изменилось, «Повторить».
  await page.evaluate(() => window.localStorage.setItem('splitit_fake_projects_fail', JSON.stringify({ fn: 'close_period', mode: 'error' })));
  await page.getByTestId('settle-close').click();
  await expect(page.getByTestId('settle-refused')).toBeVisible();
  // Обрыв связи: база зафиксировала, ответ потерян → «Проверить статус».
  await page.evaluate(() => window.localStorage.setItem('splitit_fake_projects_fail', JSON.stringify({ fn: 'close_period', mode: 'lost' })));
  await page.getByTestId('settle-close').click();
  await expect(page.getByTestId('settle-lost')).toBeVisible();
  await page.getByTestId('settle-check').click();

  // 9. Зафиксировано: отметки 0 из 2 → 1 из 2 → 2 из 2.
  await expect(page.getByTestId('settle-done')).toBeVisible();
  await expect(page.getByTestId('settled-card')).toContainText('51 000 ₽');
  await expect(page.getByTestId('settle-done')).toContainText('отмечено 0 из 2');
  // Боря — получатель, не отправитель: отмечать чужие переводы ему нечем (Codex 3в, мутация canMark).
  const settledUrl = page.url();
  await asBorya(page);
  await page.reload();
  await expect(page.getByTestId('settle-done')).toContainText('отмечено 0 из 2');
  await expect(page.getByTestId('mark-one')).toHaveCount(0);
  await expect(page.getByTestId('mark-all')).toHaveCount(0);
  await asAnya(page);
  await page.goto(settledUrl);
  await page.getByTestId('mark-one').first().click();
  await expect(page.getByTestId('settle-done')).toContainText('отмечено 1 из 2');
  // Отмечен перевод Вике 41 000 — сверху остаток Боре (макет h2-settled-1).
  await expect(page.getByTestId('settled-card')).toContainText('Осталось перевести');
  await expect(page.getByTestId('settled-main')).toHaveText('10 000 ₽');
  await page.getByTestId('mark-all').click();
  await expect(page.getByTestId('settle-done')).toContainText('отмечено 2 из 2');
  await expect(page.getByTestId('settle-all-marked')).toBeVisible();

  // Журнал долга: вклад Бори записан и возвращён из прибыли.
  await page.getByTestId('debt-journal').getByRole('button').first().click();
  await expect(page.getByTestId('debt-journal')).toContainText('Возврат из прибыли');

  // Главная: плитка проекта рядом с событиями.
  await page.goto('/');
  await expect(page.getByTestId('project-tile')).toContainText('Свадьба Ивановых');
});

test('приглашение в проект: отключённая ссылка честно не работает', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'splitit_local_user_session',
      JSON.stringify({ id: 'u-anya', email: 'anya@example.com', full_name: 'Аня', avatar_url: '👩' }),
    );
  });
  await page.goto('/projects/new');
  await page.getByTestId('project-name').fill('Фотостудия');
  await page.getByTestId('project-new-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(/\/projects\/invite/);
  const code = await page.getByTestId('invite-link').getAttribute('data-code');
  await page.getByTestId('invite-disable').click();
  await expect(page.getByTestId('invite-new')).toBeVisible();
  await page.goto(`/projects/join?code=${code}`);
  await expect(page.getByTestId('join-dead')).toContainText('Ссылка больше не работает');
});
