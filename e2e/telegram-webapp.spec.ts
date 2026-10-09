import { test, expect } from '@playwright/test';

const SESSION_KEY = 'splitit_local_user_session';

async function readSession(page: import('@playwright/test').Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY);
}

test.describe('Telegram WebApp на /auth (локальный режим)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth');
    await page.evaluate(() => window.localStorage.clear());
  });

  test('внутри Telegram WebApp сохраняется локальная сессия и происходит редирект на главную', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Telegram = {
        WebApp: {
          initDataUnsafe: {
            user: { id: 42, username: 'tguser', first_name: 'Тест', last_name: 'Телеграмов' },
          },
        },
      };
    });
    await page.goto('/auth');

    await expect(page).toHaveURL(/\/$|\/index/);

    const raw = await readSession(page);
    expect(raw).not.toBeNull();
    const session = JSON.parse(raw as string);
    expect(session).toMatchObject({
      id: 'tg-42',
      email: 'tguser@telegram.org',
      full_name: 'Тест Телеграмов',
      avatar_url: '📱',
    });
  });

  test('в локальном режиме ошибка «Telegram не настроен» не показывается', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Telegram = {
        WebApp: {
          initDataUnsafe: {
            user: { id: 42, username: 'tguser', first_name: 'Тест', last_name: 'Телеграмов' },
          },
        },
      };
    });
    await page.goto('/auth');

    await expect(page.getByText(/Вход через Telegram для общего пространства пока не настроен/)).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: /Telegram/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/$|\/index/);
  });

  test('без window.Telegram сессия не создаётся и редиректа нет', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('button', { name: 'Вход', exact: true })).toBeVisible();

    // Редирект сработал бы через ~1 с; ждём дольше, чтобы убедиться в его отсутствии.
    await page.waitForTimeout(1500);

    expect(await readSession(page)).toBeNull();
    await expect(page).toHaveURL(/\/auth/);
  });
});
