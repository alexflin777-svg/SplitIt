import { test, expect, Page } from '@playwright/test';

async function loginAsGuest(page: Page) {
  await page.goto('/auth');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/auth');
  await page.getByRole('button', { name: /Быстрый демо-вход/ }).click();
  await expect(page).toHaveURL(/\/$|\/index/);
}

test.describe('Маршруты событий в статической сборке (инвариант И-2)', () => {
  test('созданное событие открывается, а не отдаёт 404', async ({ page }) => {
    // Регрессия на S0-2. handleCreate генерирует id вида group-<timestamp>, а
    // generateStaticParams возвращал три зашитых id, поэтому в out/ физически
    // не было файла под новое событие. В next dev баг не воспроизводится —
    // только в статическом экспорте, то есть ровно в APK и IPA.
    await loginAsGuest(page);

    await page.goto('/events/new');
    await page.getByPlaceholder(/Например:/).fill('Регрессия S0-2');
    await page.getByRole('button', { name: /Создать событие/ }).click();

    await expect(page).toHaveURL(/\/events\/detail\?id=group-\d+/);
    await expect(page.getByText('This page could not be found')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Регрессия S0-2' })).toBeVisible();
  });

  test('прямой переход по id произвольного вида не отдаёт 404', async ({ page }) => {
    await loginAsGuest(page);

    const groupId = `group-${Date.now()}`;
    await page.evaluate((id) => {
      window.localStorage.setItem(
        'splitit_local_groups_data',
        JSON.stringify([
          {
            id,
            name: 'Прямой переход',
            category: 'trip',
            currency: 'RUB',
            status: 'active',
            members: [{ id: 'm-1', name: 'Вы', avatar: '👑', role: 'owner' }],
            expenses: [],
            settlements: [],
          },
        ]),
      );
    }, groupId);

    const response = await page.goto(`/events/detail?id=${groupId}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText('Прямой переход')).toBeVisible();
  });

  test('вложенные экраны события доступны по любому id', async ({ page }) => {
    await loginAsGuest(page);

    const groupId = `group-${Date.now()}`;
    await page.evaluate((id) => {
      window.localStorage.setItem(
        'splitit_local_groups_data',
        JSON.stringify([
          {
            id,
            name: 'Вложенные экраны',
            category: 'trip',
            currency: 'RUB',
            status: 'active',
            members: [
              { id: 'm-1', name: 'Вы', avatar: '👑', role: 'owner' },
              { id: 'm-2', name: 'Максим', avatar: '👤', role: 'member' },
            ],
            expenses: [],
            settlements: [],
          },
        ]),
      );
    }, groupId);

    for (const path of ['balance', 'settle', 'export', 'expense/new']) {
      const response = await page.goto(`/events/${path}?id=${groupId}`);
      expect(response?.status(), `маршрут /events/${path} отсутствует в сборке`).toBe(200);
      await expect(page.getByText('This page could not be found')).toHaveCount(0);
    }
  });

  test('пригласительная ссылка ведёт на существующий маршрут', async ({ page }) => {
    await loginAsGuest(page);
    const response = await page.goto(`/events/detail?id=group-sochi-2026&join=true`);
    expect(response?.status()).toBe(200);
  });
});

test.describe('Упрощение долгов', () => {
  test('баланс сводит расходы к минимальному числу переводов', async ({ page }) => {
    await loginAsGuest(page);

    const groupId = `group-${Date.now()}`;
    await page.evaluate((id) => {
      window.localStorage.setItem(
        'splitit_local_groups_data',
        JSON.stringify([
          {
            id,
            name: 'Проверка баланса',
            category: 'trip',
            currency: 'RUB',
            status: 'active',
            members: [
              { id: 'm-1', name: 'Алексей', avatar: '👑', role: 'owner' },
              { id: 'm-2', name: 'Мария', avatar: '👤', role: 'member' },
              { id: 'm-3', name: 'Дмитрий', avatar: '👤', role: 'member' },
            ],
            expenses: [
              {
                id: 'exp-1',
                title: 'Аренда дома',
                amount: 9000,
                amountInGroupCurrency: 9000,
                currency: 'RUB',
                paidById: 'm-1',
                date: new Date().toISOString(),
              },
            ],
            settlements: [],
          },
        ]),
      );
    }, groupId);

    await page.goto(`/events/balance?id=${groupId}`);
    await expect(page.getByRole('heading', { name: /Баланс/ })).toBeVisible();

    // 9000 поровну на троих: каждый должен 3000, платил один. Алгоритм
    // упрощения обязан свести это ровно к двум переводам по 3000, а не к трём.
    const body = (await page.locator('body').innerText()).replace(/ | /g, ' ');
    expect(body).toContain('Мария');
    expect(body).toContain('Дмитрий');
    expect(body.match(/3\s?000/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
