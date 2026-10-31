import { test, expect, Page } from '@playwright/test';

/**
 * Правки «Событий» 1.1.0 (SCENARIOS-AUDIT §4):
 *  п. 1 — адрес приглашения переживает вход (запоминается до ухода на вход);
 *  п. 4 — «Тебе должны / Ты должен» вместо зашитого «Баланс 0 ₽»;
 *  п. 5 — «Подвести итог» — одна главная кнопка внизу экрана события.
 */

const ME = { id: 'u-me', email: 'me@example.com', full_name: 'Аня', avatar_url: '👩' };
const GROUP = {
  id: 'group-v11',
  name: 'Поездка в Казань',
  category: 'trip',
  currency: 'RUB',
  status: 'active',
  createdBy: ME.id,
  members: [
    { id: ME.id, name: 'Аня', avatar: '👩', role: 'owner' },
    { id: 'm-sasha', name: 'Саша', avatar: '🙂', role: 'member' },
  ],
  expenses: [
    {
      id: 'e1',
      title: 'Музей',
      amount: 4700,
      currency: 'RUB',
      amountInGroupCurrency: 4700,
      category: 'entertainment',
      paidById: ME.id,
      splits: [
        { userId: ME.id, amountOwed: 2350 },
        { userId: 'm-sasha', amountOwed: 2350 },
      ],
      createdAt: '2026-10-10T10:00:00Z',
    },
  ],
  settlements: [],
};

async function seed(page: Page, groups: unknown[]) {
  await page.goto('/');
  await page.evaluate(
    ([me, gs]) => {
      window.localStorage.clear();
      window.localStorage.setItem('splitit_local_user_session', JSON.stringify(me));
      window.localStorage.setItem('splitit_local_groups_data', JSON.stringify(gs));
    },
    [ME, groups] as const,
  );
}

test('приглашение сохраняется через вход: после входа — обратно на /invite?code=…', async ({ page }) => {
  await page.goto('/auth');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`/auth?mode=login&next=${encodeURIComponent('/invite?code=ABC123')}`);
  // До ухода на вход путь уже запомнен — Google/Telegram вернутся без ?next=.
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('splitit_auth_next'))).toBe('/invite?code=ABC123');
  await page.getByRole('button', { name: /Быстрый демо-вход/ }).click();
  await expect(page).toHaveURL(/\/invite\?code=ABC123$/);
  // Путь забирается один раз: следующий вход ведёт как раньше.
  expect(await page.evaluate(() => window.localStorage.getItem('splitit_auth_next'))).toBeNull();
});

test('чужой адрес возврата не запоминается', async ({ page }) => {
  await page.goto('/auth');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`/auth?mode=login&next=${encodeURIComponent('//evil.example.com')}`);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => window.localStorage.getItem('splitit_auth_next'))).toBeNull();
});

test('главная: «Тебе должны» — моя цифра, а не зашитый 0 ₽', async ({ page }) => {
  await seed(page, [GROUP]);
  await page.goto('/');
  await expect(page.getByTestId('home-owed-to-me')).toContainText('2 350');
  await expect(page.getByTestId('home-i-owe')).toContainText('0');
  await expect(page.getByTestId('event-tile')).toContainText('Тебе должны');
  await expect(page.getByTestId('event-tile')).toContainText('Поездка в Казань');
});

test('событие: «Тебе должны» первым блоком, «Подвести итог» — главная кнопка внизу', async ({ page }) => {
  await seed(page, [GROUP]);
  await page.goto(`/events/detail?id=${GROUP.id}`);
  await expect(page.getByTestId('event-mine')).toContainText('Тебе должны');
  await expect(page.getByTestId('event-mine')).toContainText('2 350');
  const main = page.getByTestId('close-event');
  await expect(main).toHaveText('Подвести итог');
  // Кнопка закреплена внизу экрана, над навигацией, и видна без прокрутки.
  const box = await main.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  expect(box!.y).toBeGreaterThan(vh / 2);
  await main.click();
  await expect(page.getByRole('button', { name: /Закрыть и зафиксировать/ })).toBeVisible();
});

test('событие без расходов: главная кнопка — «Добавить первый расход»', async ({ page }) => {
  await seed(page, [{ ...GROUP, expenses: [] }]);
  await page.goto(`/events/detail?id=${GROUP.id}`);
  await expect(page.getByTestId('event-add-expense')).toHaveText('Добавить первый расход');
  await expect(page.getByTestId('close-event')).toHaveCount(0);
});
