import { test, expect, Page } from '@playwright/test';

/**
 * F3/F4: имя и аватар меняются с главной, аватар сохраняется сразу после
 * выбора. Локальный режим (build:test без Supabase): запись идёт через тот же
 * saveProfile, что и в сетевом режиме, только без upsert в profiles.
 */

const SESSION = { id: 'guest-1', email: 'guest@splitit.app', full_name: 'Демо Аккаунт', avatar_url: '👤', has_completed_onboarding: true };
const SESSION_KEY = 'splitit_local_user_session';

// 1×1 PNG: processAvatarFile пережимает его в JPEG 256×256.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(
    ([key, session]) => {
      window.localStorage.clear();
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    [SESSION_KEY, SESSION] as const,
  );
}

const storedSession = (page: Page) =>
  page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), SESSION_KEY);

async function openEditor(page: Page) {
  await page.goto('/');
  await page.getByTestId('home-avatar-button').click();
  const editor = page.getByTestId('quick-profile-editor');
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('Быстрый редактор профиля на главной (F3)', () => {
  test('эмодзи-аватар сохраняется сразу, без кнопки «Сохранить»', async ({ page }) => {
    await seed(page);
    const editor = await openEditor(page);
    await editor.getByRole('button', { name: '🦊' }).click();
    await expect(editor.getByTestId('quick-profile-saved')).toBeVisible();
    expect((await storedSession(page)).avatar_url).toBe('🦊');

    await editor.getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByTestId('home-avatar-button')).toHaveText('🦊');
    await page.reload();
    await expect(page.getByTestId('home-avatar-button')).toHaveText('🦊');
  });

  test('фото сжимается и сохраняется сразу после выбора', async ({ page }) => {
    await seed(page);
    const editor = await openEditor(page);
    await editor.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(editor.getByTestId('quick-profile-saved')).toBeVisible();
    expect((await storedSession(page)).avatar_url).toMatch(/^data:image\/jpeg;base64,/);
    await expect(page.getByTestId('home-avatar-button').locator('img')).toBeVisible();
  });

  test('имя меняется и видно на главной; пустое имя не сохраняется', async ({ page }) => {
    await seed(page);
    const editor = await openEditor(page);
    const name = editor.getByLabel('Имя');
    await name.fill('   ');
    await editor.getByRole('button', { name: 'Сохранить' }).click();
    await expect(editor.getByRole('alert')).toHaveText('Введите имя');
    expect((await storedSession(page)).full_name).toBe('Демо Аккаунт');

    await name.fill('Алекс');
    await editor.getByRole('button', { name: 'Сохранить' }).click();
    await expect(editor.getByTestId('quick-profile-saved')).toBeVisible();
    expect((await storedSession(page)).full_name).toBe('Алекс');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Алекс' })).toBeVisible();
  });

  test('фокус переходит в шторку и возвращается на аватар после закрытия', async ({ page }) => {
    await seed(page);
    const editor = await openEditor(page);
    await expect(editor.locator(':focus')).toHaveCount(1);
    // Кнопка фото доступна с клавиатуры: input не display:none.
    await expect(editor.locator('input[type=file]')).not.toHaveCSS('display', 'none');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId('home-avatar-button')).toBeFocused();
  });

  test('сбой записи показывается ошибкой, а аватар на главной не меняется', async ({ page }) => {
    await seed(page);
    const editor = await openEditor(page);
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, k, v);
      };
    }, SESSION_KEY);
    await editor.getByRole('button', { name: '🐼' }).click();
    await expect(editor.getByRole('alert')).toContainText('Не удалось сохранить');
    await expect(editor.getByTestId('quick-profile-saved')).toHaveCount(0);
    expect((await storedSession(page)).avatar_url).toBe('👤');
    await editor.getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByTestId('home-avatar-button')).toHaveText('👤');
  });
});
