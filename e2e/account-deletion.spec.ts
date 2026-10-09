import { test, expect } from '@playwright/test';

/**
 * Удаление аккаунта в локальном режиме (T2, требование Google Play / App Store).
 * Сетевой режим (Edge Function delete-account + RPC delete_my_account) здесь не
 * покрыт: E2E идут на сборке без Supabase. RPC проверена в
 * test/account-deletion-rls.test.mjs.
 */

const SESSION_KEY = 'splitit_local_user_session';
const REGISTRY_KEY = 'splitit_registered_users_registry';

async function registerLocal(page: import('@playwright/test').Page, email: string) {
  await page.goto('/auth?mode=register&next=%2Fprofile');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/auth?mode=register&next=%2Fprofile');
  await page.getByPlaceholder('Иван Иванов').fill('Удаляемый Пользователь');
  await page.getByPlaceholder('name@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill('Strong-password-123');
  await page.getByRole('button', { name: /Зарегистрироваться/ }).click();
  await expect(page).toHaveURL(/\/profile$/);
}

test.describe('Удаление аккаунта (локальный режим)', () => {
  test('кнопка неактивна, пока не введён свой email', async ({ page }) => {
    await registerLocal(page, 'delete-guard@example.com');
    const section = page.getByTestId('delete-account');
    const button = section.getByRole('button', { name: 'Удалить аккаунт навсегда' });

    await expect(button).toBeDisabled();
    await section.getByRole('textbox').fill('someone-else@example.com');
    await expect(button).toBeDisabled();
    await section.getByRole('textbox').fill('delete-guard@example.com');
    await expect(button).toBeEnabled();
  });

  test('удаление стирает локальные данные и выходит из аккаунта', async ({ page }) => {
    const email = 'delete-me@example.com';
    await registerLocal(page, email);

    // Чужой локальный профиль на том же устройстве и личные данные пользователя.
    await page.evaluate(
      ([registryKey]) => {
        const registry = JSON.parse(window.localStorage.getItem(registryKey) || '{}');
        registry['neighbour@example.com'] = { id: 'user-n', email: 'neighbour@example.com', full_name: 'Сосед' };
        window.localStorage.setItem(registryKey, JSON.stringify(registry));
        window.localStorage.setItem('splitit_local_groups_data', JSON.stringify([{ id: 'g-1', name: 'Поездка' }]));
        window.localStorage.setItem('splitit_saved_friends_list', JSON.stringify([{ id: 'f-1', name: 'Друг' }]));
      },
      [REGISTRY_KEY] as const,
    );

    const section = page.getByTestId('delete-account');
    await section.getByRole('textbox').fill(email);
    await section.getByRole('button', { name: 'Удалить аккаунт навсегда' }).click();

    await expect(page).toHaveURL(/\/auth\?mode=login/);
    const state = await page.evaluate(
      ([sessionKey, registryKey]) => ({
        session: window.localStorage.getItem(sessionKey),
        registry: JSON.parse(window.localStorage.getItem(registryKey) || '{}'),
        leftovers: Object.keys(window.localStorage).filter(
          (k) => k.startsWith('splitit_') && k !== 'splitit_locale' && k !== registryKey,
        ),
      }),
      [SESSION_KEY, REGISTRY_KEY] as const,
    );
    expect(state.session).toBeNull();
    expect(state.leftovers).toEqual([]);
    expect(Object.keys(state.registry)).toEqual(['neighbour@example.com']);
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  });

  test('публичная страница /delete-account открывается без входа', async ({ page }) => {
    await page.goto('/delete-account');
    await page.evaluate(() => window.localStorage.clear());
    await page.goto('/delete-account');
    await expect(page.getByRole('heading', { name: 'Удаление аккаунта SplitIT' })).toBeVisible();
    await expect(page.getByText(/«Профиль» → «Удалить аккаунт»/)).toBeVisible();

    // Без бэкенда заявка честно не отправляется — успех не симулируется.
    await page.getByPlaceholder('name@example.com').fill('request@example.com');
    await page.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(page.getByTestId('delete-request-error')).toBeVisible();
    await expect(page.getByTestId('delete-request-success')).toHaveCount(0);
  });
});
