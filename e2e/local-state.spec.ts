import { test, expect, Page } from '@playwright/test';

/**
 * Характеризационные тесты локального режима: что человек видит и что лежит
 * в localStorage. Должны оставаться зелёными после любого рефакторинга
 * работы с состоянием.
 */

const SESSION = { id: 'guest-1', email: 'guest@splitit.app', full_name: 'Демо Аккаунт', avatar_url: '👤' };
const FRIENDS_KEY = 'splitit_saved_friends_list';

function friend(id: string, name: string, phone?: string) {
  return { id, name, avatar: '👤', role: 'member', ...(phone ? { phone } : {}) };
}

async function seed(page: Page, friends: unknown[] = []) {
  await page.goto('/');
  await page.evaluate(
    ([session, list, key]) => {
      window.localStorage.clear();
      window.localStorage.setItem('splitit_local_user_session', JSON.stringify(session));
      window.localStorage.setItem(key as string, JSON.stringify(list));
    },
    [SESSION, friends, FRIENDS_KEY] as const,
  );
}

const storedFriendNames = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) || '[]').map((f: { name: string }) => f.name),
    FRIENDS_KEY,
  );

test.describe('Профиль', () => {
  test('переключатель тёмной темы меняет класс dark на html и своё состояние', async ({ page }) => {
    await seed(page);
    await page.goto('/profile');

    const title = page.getByText('Темная тема (Dark Mode)');
    await expect(title).toBeVisible();
    const toggle = title.locator('xpath=ancestor::div[contains(@class,"justify-between")][1]').getByRole('checkbox');
    const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));

    await expect(toggle).not.toBeChecked();
    expect(await isDark()).toBe(false);

    await toggle.check();
    await expect(toggle).toBeChecked();
    expect(await isDark()).toBe(true);

    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    expect(await isDark()).toBe(false);
  });

  test('показывает версию приложения', async ({ page }) => {
    await seed(page);
    await page.goto('/profile');
    await expect(page.getByText('Версия 1.0.0', { exact: true })).toBeVisible();
  });
});

test.describe('Друзья', () => {
  test('засеянные друзья показаны списком', async ({ page }) => {
    await seed(page, [friend('f-1', 'Борис', '+79990001122'), friend('f-2', 'Вера')]);
    await page.goto('/friends');

    await expect(page.getByRole('heading', { name: 'Борис' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Вера' })).toBeVisible();
    await expect(page.getByText('+79990001122')).toBeVisible();
  });

  test('добавленный друг появляется сразу и сохраняется в хранилище', async ({ page }) => {
    await seed(page, [friend('f-1', 'Борис')]);
    await page.goto('/friends');
    await expect(page.getByRole('heading', { name: 'Борис' })).toBeVisible();

    await page.getByRole('button', { name: 'Добавить друга' }).click();
    await page.getByPlaceholder('Имя и фамилия').fill('Глеб Новый');
    await page.getByRole('button', { name: 'Сохранить друга' }).click();

    await expect(page.getByRole('heading', { name: 'Глеб Новый' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Борис' })).toBeVisible();
    expect(await storedFriendNames(page)).toEqual(['Глеб Новый', 'Борис']);
  });

  test('удалённый друг исчезает сразу и из хранилища', async ({ page }) => {
    await seed(page, [friend('f-1', 'Борис'), friend('f-2', 'Вера')]);
    await page.goto('/friends');
    await expect(page.getByRole('heading', { name: 'Борис' })).toBeVisible();

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Удалить «Борис» из списка друзей?');
      await dialog.accept();
    });
    await page.getByRole('heading', { name: 'Борис' }).locator('xpath=ancestor::div[contains(@class,"stitch-card")]')
      .getByTitle('Удалить из друзей').click();

    await expect(page.getByRole('heading', { name: 'Борис' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Вера' })).toBeVisible();
    expect(await storedFriendNames(page)).toEqual(['Вера']);
  });
});

test.describe('Новое событие', () => {
  test('сохранённые друзья предлагаются и добавляются в участники по клику', async ({ page }) => {
    await seed(page, [friend('f-1', 'Борис'), friend('f-2', 'Вера')]);
    await page.goto('/events/new');

    const chip = (name: string) => page.getByRole('button', { name, exact: false }).filter({ hasText: name });
    await expect(chip('Борис')).toBeVisible();
    await expect(chip('Вера')).toBeVisible();

    await expect(page.getByText('Участники события (1)').first()).toBeVisible();
    await chip('Борис').click();
    await expect(page.getByText('Участники события (2)').first()).toBeVisible();

    await chip('Борис').click();
    await expect(page.getByText('Участники события (1)').first()).toBeVisible();
  });
});

test.describe('Приглашение', () => {
  test('без кода показывает точный текст ошибки', async ({ page }) => {
    await seed(page);
    await page.goto('/invite');
    await expect(page.getByTestId('invite-error').getByText(
      'В ссылке нет кода приглашения. Похоже, она обрезана при пересылке.',
      { exact: true },
    )).toBeVisible();
  });

  test('с кодом, но без бэкенда, честно сообщает про локальный режим', async ({ page }) => {
    await seed(page);
    await page.goto('/invite?code=X');
    await expect(page.getByTestId('invite-error').getByText(
      'Приглашения работают только с подключённым бэкендом. Сейчас приложение хранит события на одном устройстве.',
      { exact: true },
    )).toBeVisible();
  });
});
