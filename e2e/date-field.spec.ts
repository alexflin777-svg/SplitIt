import { test, expect, Page } from '@playwright/test';

/**
 * F2: поле даты в «Новый расход» / «Редактировать расход» вылезало из своей
 * карточки на iPhone 13 (WebKit iOS даёт input[type=date] собственную
 * минимальную ширину). Решающий прогон — проект `mobile safari` (PW_WEBKIT=1,
 * в CI включён всегда); на Chromium тест проверяет тот же инвариант.
 */

const SESSION = { id: 'guest-1', email: 'guest@splitit.app', full_name: 'Демо Аккаунт', avatar_url: '👤' };

const GROUP = {
  id: 'g-date',
  name: 'Дача',
  category: 'trip',
  currency: 'RUB',
  status: 'active',
  members: [
    { id: 'm-1', name: 'Вы', avatar: '👑', role: 'owner' },
    { id: 'm-2', name: 'Миша', avatar: '👤', role: 'member' },
  ],
  expenses: [
    {
      id: 'e-1',
      title: 'Мясо и угли',
      amount: 3000,
      currency: 'RUB',
      amountInGroupCurrency: 3000,
      category: 'food',
      paidById: 'm-1',
      splitType: 'equal',
      createdAt: '2026-09-20T10:00:00.000Z',
      splits: [
        { userId: 'm-1', amountOwed: 1500 },
        { userId: 'm-2', amountOwed: 1500 },
      ],
    },
  ],
  settlements: [],
};

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(
    ([session, group]) => {
      window.localStorage.clear();
      window.localStorage.setItem('splitit_local_user_session', JSON.stringify(session));
      window.localStorage.setItem('splitit_local_groups_data', JSON.stringify([group]));
    },
    [SESSION, GROUP] as const,
  );
}

async function expectDateInsideCard(page: Page) {
  const input = page.getByTestId('expense-date');
  await expect(input).toBeVisible();
  // Триггер дефекта на iPhone — правило из globals.css против автозума
  // (font-size: 16px под @supports (-webkit-touch-callout: none)). На Linux
  // этот @supports не срабатывает даже в WebKit, поэтому воспроизводим его явно.
  await page.addStyleTag({ content: "input[type='date'] { font-size: 16px !important; }" });
  // Карточка — ближайший предок со stitch-card.
  const card = input.locator('xpath=ancestor::div[contains(@class,"stitch-card")][1]');
  const [i, c] = await Promise.all([input.boundingBox(), card.boundingBox()]);
  expect(i && c, 'нет геометрии поля даты или его карточки').toBeTruthy();
  expect(i!.x).toBeGreaterThanOrEqual(c!.x - 0.5);
  expect(i!.x + i!.width, 'поле даты шире своей карточки').toBeLessThanOrEqual(c!.x + c!.width + 0.5);
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  expect(c!.x + c!.width, 'карточка с датой вылезает за экран').toBeLessThanOrEqual(vw + 0.5);
}

test('поле даты в новом расходе не шире своей карточки', async ({ page }) => {
  await seed(page);
  await page.goto(`/events/expense/new?id=${GROUP.id}`);
  await expectDateInsideCard(page);
});

test('поле даты в редактировании расхода не шире своей карточки', async ({ page }) => {
  await seed(page);
  await page.goto(`/events/expense/edit?id=${GROUP.id}&expenseId=e-1`);
  await expectDateInsideCard(page);
});
