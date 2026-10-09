import { test, expect, Page } from '@playwright/test';

/**
 * G1 (P1-16): правка расхода не затирает неравные доли. Локальный режим.
 *
 * Раньше «Редактировать расход» при любом сохранении делил итог поровну —
 * доли «по позициям» (F6) превращались в равные без единого предупреждения.
 * Расход создаётся настоящим потоком «чек → По позициям» (как в
 * receipt-items.spec.ts), затем открывается на правку.
 */

const SESSION = { id: 'm-1', email: 'guest@splitit.app', full_name: 'Алексей', avatar_url: '👤', has_completed_onboarding: true };
const GROUP_ID = 'g-edit-splits';

const RECEIPT = `CAFÉ CENTRAL
Pizza Margherita 12,00
Pasta 10,00
Wasser 2 x 3,00 6,00
SUMME EUR 28,00
Vielen Dank`;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(
    ([session, group]) => {
      window.localStorage.clear();
      window.localStorage.setItem('splitit_local_user_session', JSON.stringify(session));
      window.localStorage.setItem('splitit_local_groups_data', JSON.stringify([group]));
    },
    [
      SESSION,
      {
        id: GROUP_ID,
        name: 'Ужин в Берлине',
        category: 'restaurant',
        currency: 'EUR',
        status: 'active',
        members: [
          { id: 'm-1', name: 'Алексей', avatar: '👑', role: 'owner' },
          { id: 'm-2', name: 'Мария', avatar: '👤', role: 'member' },
          { id: 'm-3', name: 'Иван', avatar: '👤', role: 'member' },
        ],
        expenses: [],
        settlements: [],
      },
    ] as const,
  );
}

const storedExpense = (page: Page) =>
  page.evaluate((id) => {
    const groups = JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]');
    return groups.find((g: any) => g.id === id)?.expenses?.[0] ?? null;
  }, GROUP_ID);

/** Чек 28,00 + чаевые = 30,80: пицца — Алексей, паста — Мария, вода — на всех. */
async function createItemsExpense(page: Page) {
  await seed(page);
  await page.goto(`/events/expense/new?id=${GROUP_ID}`);
  await expect(page.getByPlaceholder(/Например|Ужин|Название/i).first()).toBeVisible();
  await page.evaluate((text) => {
    window.__splititOcrText = text;
  }, RECEIPT);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.getByTestId('split-mode-items')).toHaveAttribute('aria-selected', 'true');
  const items = page.getByTestId('receipt-item');
  await expect(items).toHaveCount(3);
  await items.nth(0).getByRole('button', { name: 'Мария' }).click();
  await items.nth(0).getByRole('button', { name: 'Иван' }).click();
  await items.nth(1).getByRole('button', { name: 'Алексей' }).click();
  await items.nth(1).getByRole('button', { name: 'Иван' }).click();
  await page.locator('input[inputmode="decimal"]').first().fill('30.80');
  await expect(page.getByTestId('item-share')).toHaveCount(3);
  await page.getByRole('button', { name: /Сохранить|Добавить/ }).last().click();
  await expect(page).toHaveURL(/events\/detail/);

  const created = await storedExpense(page);
  expect(created).not.toBeNull();
  expect(created.splitMode).toBe('items');
  return created;
}

async function openEdit(page: Page, expenseId: string) {
  await page.goto(`/events/expense/edit?id=${GROUP_ID}&expenseId=${encodeURIComponent(expenseId)}`);
  await expect(page.getByTestId('split-section')).toBeVisible();
}

const shareOf = (page: Page, memberId: string) =>
  page.locator(`[data-testid="split-row"][data-member-id="${memberId}"]`).getByTestId('split-share');

const byUser = (splits: Array<{ userId: string; amountOwed: number }>) =>
  Object.fromEntries(splits.map((s) => [s.userId, s.amountOwed]));

test('«по позициям» → открыть → сохранить без изменений: доли те же, тип сохранён', async ({ page }) => {
  const created = await createItemsExpense(page);
  expect(byUser(created.splits)).toEqual({ 'm-1': 15.4, 'm-2': 13.2, 'm-3': 2.2 });

  await openEdit(page, created.id);
  // На экране — фактические доли из хранилища, а не «поровну».
  await expect(page.getByTestId('split-mode-badge')).toHaveAttribute('data-mode', 'items');
  await expect(shareOf(page, 'm-1')).toHaveText(/^15,40?\s/);
  await expect(shareOf(page, 'm-2')).toHaveText(/^13,20?\s/);
  await expect(shareOf(page, 'm-3')).toHaveText(/^2,20?\s/);
  await expect(page.getByTestId('split-rescaled-notice')).toHaveCount(0);

  await page.getByRole('button', { name: /Сохранить изменения/ }).click();
  await expect(page).toHaveURL(/events\/detail/);

  const saved = await storedExpense(page);
  expect(saved.splits).toEqual(created.splits);
  expect(saved.amountInGroupCurrency).toBe(created.amountInGroupCurrency);
  expect(saved.splitMode).toBe('items');
});

test('сумма изменилась — доли пересчитаны пропорционально и показаны до сохранения', async ({ page }) => {
  const created = await createItemsExpense(page);
  await openEdit(page, created.id);

  await page.locator('input[inputmode="decimal"]').first().fill('61.60');
  await expect(page.getByTestId('split-rescaled-notice')).toBeVisible();
  await expect(shareOf(page, 'm-1')).toHaveText(/^30,80?\s/);
  await expect(shareOf(page, 'm-2')).toHaveText(/^26,40?\s/);
  await expect(shareOf(page, 'm-3')).toHaveText(/^4,40?\s/);
  // Тип не переключился на «поровну» сам.
  await expect(page.getByTestId('split-mode-badge')).toHaveAttribute('data-mode', 'items');

  await page.getByRole('button', { name: /Сохранить изменения/ }).click();
  await expect(page).toHaveURL(/events\/detail/);

  const saved = await storedExpense(page);
  expect(byUser(saved.splits)).toEqual({ 'm-1': 30.8, 'm-2': 26.4, 'm-3': 4.4 });
  const sumCents = saved.splits.reduce((s: number, x: any) => s + Math.round(x.amountOwed * 100), 0);
  expect(sumCents).toBe(Math.round(saved.amountInGroupCurrency * 100));
  expect(saved.splitMode).toBe('items');
});

test('«поровну» — только явным действием; затем состав снова меняется', async ({ page }) => {
  const created = await createItemsExpense(page);
  await openEdit(page, created.id);

  // Пока доли неравные, нажатие на участника состав не меняет.
  await page.locator('[data-testid="split-row"][data-member-id="m-3"]').click();
  await expect(shareOf(page, 'm-3')).toHaveText(/^2,20?\s/);

  await page.getByTestId('split-equal-action').click();
  await expect(page.getByTestId('split-mode-badge')).toHaveAttribute('data-mode', 'equal');
  await page.locator('[data-testid="split-row"][data-member-id="m-3"]').click();
  await expect(shareOf(page, 'm-3')).toHaveCount(0);

  await page.getByRole('button', { name: /Сохранить изменения/ }).click();
  await expect(page).toHaveURL(/events\/detail/);
  const saved = await storedExpense(page);
  expect(byUser(saved.splits)).toEqual({ 'm-1': 15.4, 'm-2': 15.4 });
  expect(saved.splitMode).toBe('equal');
});
