import { test, expect } from '@playwright/test';

const SESSION_KEY = 'splitit_local_user_session';
const REGISTRY_KEY = 'splitit_registered_users_registry';

async function readSession(page: import('@playwright/test').Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY);
}

async function openLoginTab(page: import('@playwright/test').Page) {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Вход', exact: true }).click();
  await expect(page.getByRole('button', { name: /Войти в аккаунт/ })).toBeVisible();
}

test.describe('Авторизация (инвариант И-1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth');
    await page.evaluate(() => window.localStorage.clear());
  });

  test('вход с произвольным паролем на незарегистрированный email отклоняется', async ({ page }) => {
    // Регрессия на S0-1. До починки signInUser игнорировал аргумент password,
    // писал сессию в localStorage до запроса в Supabase и всегда возвращал
    // error: null — то есть пускал кого угодно под каким угодно адресом.
    await openLoginTab(page);

    await page.getByPlaceholder('name@example.com').fill('totally-random-nonexistent-user@example.com');
    await page.getByPlaceholder('••••••••').fill('wrong-password-12345');
    await page.getByRole('button', { name: /Войти в аккаунт/ }).click();

    await expect(page.getByTestId('auth-error')).toBeVisible();
    expect(await readSession(page)).toBeNull();
    await expect(page).toHaveURL(/\/auth/);
  });

  test('чужой email из локального реестра не отдаёт профиль по неверному паролю', async ({ page }) => {
    // Второй виток S0-1: реестр splitit_registered_users_registry общий на
    // устройство, поэтому подстановка чужого email отдавала весь его профиль.
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [
        REGISTRY_KEY,
        JSON.stringify({
          'victim@example.com': {
            id: 'user-victim',
            email: 'victim@example.com',
            full_name: 'Жертва Подстановки',
            avatar_url: '👤',
          },
        }),
      ] as const,
    );

    await openLoginTab(page);
    await page.getByPlaceholder('name@example.com').fill('victim@example.com');
    await page.getByPlaceholder('••••••••').fill('definitely-not-the-password');
    await page.getByRole('button', { name: /Войти в аккаунт/ }).click();

    await expect(page.getByTestId('auth-error')).toBeVisible();
    expect(await readSession(page)).toBeNull();
  });

  test('демо-вход остаётся доступным и создаёт гостевую сессию', async ({ page }) => {
    // Локальный профиль без проверки пароля допустим ровно здесь — это явный,
    // помеченный в интерфейсе демо-режим, а не тихий обход авторизации.
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Вход', exact: true }).click();
    await page.getByRole('button', { name: /Быстрый демо-вход/ }).click();

    await expect(page).toHaveURL(/\/$|\/index/);
    const session = await readSession(page);
    expect(session).not.toBeNull();
    expect(JSON.parse(session!).id).toMatch(/^guest-/);
  });
});

test.describe('Конфигурация окружения (инвариант И-3)', () => {
  test('в собранный бандл не попали плейсхолдеры Supabase', async ({ request }) => {
    // Регрессия на S1-1: строка placeholder-splitit была найдена прямо в
    // out/_next/static/chunks/*.js, то есть выпущенные APK и IPA ходили в
    // несуществующий домен, а catch {} это скрывал.
    const page = await request.get('/');
    const html = await page.text();
    const chunks = [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]);
    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      const body = await (await request.get(chunk)).text();
      expect(body, `плейсхолдер Supabase попал в ${chunk}`).not.toContain('placeholder-splitit');
    }
  });
});
