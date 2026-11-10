import { test, expect, Page } from '@playwright/test';

/**
 * 1.1.1, круг 5 (вердикт Codex perf-codex-r2.md, п. 3): у пользователей 1.0.x
 * мог остаться автоматически записанный en. Молча не меняем — один раз предлагаем
 * язык устройства (браузер теста — ru-RU). Явный выбор ставит отметку.
 */

async function seed(page: Page, entries: Record<string, string>) {
  await page.goto('/auth?mode=login');
  await page.evaluate((e) => {
    window.localStorage.clear();
    for (const [k, v] of Object.entries(e)) window.localStorage.setItem(k, v);
  }, entries);
  await page.reload();
}

const signIn = (page: Page, name: string) => page.getByRole('main').getByRole('button', { name, exact: true });

test('сохранён en без отметки: предложение «Русский» — интерфейс на русском, предложение больше не показывается', async ({ page }) => {
  await seed(page, { splitit_locale: 'en' });
  const offer = page.getByTestId('locale-offer');
  await expect(offer).toBeVisible();
  await expect(signIn(page, 'Sign in')).toBeVisible(); // язык не сменился молча
  await offer.getByRole('button', { name: 'Русский' }).click();
  await expect(offer).toHaveCount(0);
  await expect(signIn(page, 'Вход')).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('splitit_locale'), localStorage.getItem('splitit_locale_manual')])).toEqual(['ru', '1']);
  await page.reload();
  await expect(signIn(page, 'Вход')).toBeVisible();
  await expect(offer).toHaveCount(0);
});

test('«Оставить» — английский остаётся, предложение больше не показывается', async ({ page }) => {
  await seed(page, { splitit_locale: 'en' });
  await page.getByTestId('locale-offer').getByRole('button', { name: 'Keep' }).click();
  await page.reload();
  await expect(signIn(page, 'Sign in')).toBeVisible();
  await expect(page.getByTestId('locale-offer')).toHaveCount(0);
});

test('явный выбор 1.1.1 (отметка есть) — предложения нет', async ({ page }) => {
  await seed(page, { splitit_locale: 'en', splitit_locale_manual: '1' });
  await expect(signIn(page, 'Sign in')).toBeVisible();
  await expect(page.getByTestId('locale-offer')).toHaveCount(0);
});
