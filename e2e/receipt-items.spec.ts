import { test, expect, Page } from '@playwright/test';

/**
 * F6: распознанный чек → валюта «из чека» → распределение по позициям →
 * сохранённые доли. Локальный режим. Tesseract не запускается: тестовая сборка
 * (build:test, NEXT_PUBLIC_OCR_TEST_HOOK=1) берёт текст чека из
 * window.__splititOcrText; разбор текста — тот же, что в боевой сборке.
 */

const SESSION = { id: 'm-1', email: 'guest@splitit.app', full_name: 'Алексей', avatar_url: '👤', has_completed_onboarding: true };
const GROUP_ID = 'g-receipt';

const RECEIPT = `CAFÉ CENTRAL
Pizza Margherita 12,00
Pasta 10,00
Wasser 2 x 3,00 6,00
SUMME EUR 28,00
Vielen Dank`;

// Любое изображение: в тестовой сборке содержимое не распознаётся.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

async function seed(page: Page, currency: string) {
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
        currency,
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

async function scanReceipt(page: Page) {
  await page.goto(`/events/expense/new?id=${GROUP_ID}`);
  await expect(page.getByPlaceholder(/Например|Ужин|Название/i).first()).toBeVisible();
  await page.evaluate((text) => {
    window.__splititOcrText = text;
  }, RECEIPT);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.getByTestId('ocr-status')).toBeVisible();
}

const storedSplits = (page: Page) =>
  page.evaluate((id) => {
    const groups = JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]');
    const expense = groups.find((g: any) => g.id === id)?.expenses?.[0];
    return expense ? { amount: expense.amountInGroupCurrency, splitType: expense.splitType, splits: expense.splits } : null;
  }, GROUP_ID);

test('чек → «По позициям»: личные позиции, общая поровну, чаевые пропорционально', async ({ page }) => {
  await seed(page, 'EUR');
  await scanReceipt(page);

  await expect(page.getByTestId('currency-from-receipt')).toBeVisible();
  await expect(page.locator('select').filter({ has: page.locator('option[value="EUR"]') }).first()).toHaveValue('EUR');
  await expect(page.getByTestId('split-mode-items')).toHaveAttribute('aria-selected', 'true');
  const items = page.getByTestId('receipt-item');
  await expect(items).toHaveCount(3);

  // Пицца — только Алексей, паста — только Мария, вода — на всех.
  await items.nth(0).getByRole('button', { name: 'Мария' }).click();
  await items.nth(0).getByRole('button', { name: 'Иван' }).click();
  await items.nth(1).getByRole('button', { name: 'Алексей' }).click();
  await items.nth(1).getByRole('button', { name: 'Иван' }).click();

  // Итог с чаевыми: 30,80 вместо 28,00 — разница делится пропорционально.
  await page.locator('input[inputmode="decimal"]').first().fill('30.80');
  await expect(page.getByTestId('items-difference')).toBeVisible();
  await expect(page.getByTestId('item-share')).toHaveCount(3);

  await page.getByRole('button', { name: /Сохранить|Добавить/ }).last().click();
  await expect(page).toHaveURL(/events\/detail/);

  const saved = await storedSplits(page);
  expect(saved).not.toBeNull();
  expect(saved!.splitType).toBe('shares');
  const byId = Object.fromEntries(saved!.splits.map((s: any) => [s.userId, s.amountOwed]));
  expect(byId).toEqual({ 'm-1': 15.4, 'm-2': 13.2, 'm-3': 2.2 });
  const sumCents = saved!.splits.reduce((s: number, x: any) => s + Math.round(x.amountOwed * 100), 0);
  expect(sumCents).toBe(Math.round(saved!.amount * 100));
});

test('валюту из чека можно сменить — пометка «из чека» исчезает; режим «Поровну» работает как раньше', async ({ page }) => {
  await seed(page, 'EUR');
  await scanReceipt(page);
  const currencySelect = page.locator('select').filter({ has: page.locator('option[value="EUR"]') }).first();
  await currencySelect.selectOption('USD');
  await expect(page.getByTestId('currency-from-receipt')).toHaveCount(0);
  await currencySelect.selectOption('EUR');

  await page.getByTestId('split-mode-equal').click();
  await expect(page.getByTestId('receipt-items')).toHaveCount(0);
  await page.getByRole('button', { name: /Сохранить|Добавить/ }).last().click();
  await expect(page).toHaveURL(/events\/detail/);
  const saved = await storedSplits(page);
  expect(saved!.splitType).toBe('equal');
  expect(saved!.splits.map((s: any) => s.amountOwed).sort()).toEqual([9.33, 9.33, 9.34]);
});

test('ошибочную позицию можно убрать; без позиций форма возвращается к «Поровну»', async ({ page }) => {
  await seed(page, 'EUR');
  await scanReceipt(page);
  const items = page.getByTestId('receipt-item');
  await expect(items).toHaveCount(3);
  await items.nth(2).getByTestId('remove-item').click();
  await expect(items).toHaveCount(2);
  await items.nth(0).getByTestId('remove-item').click();
  await items.nth(0).getByTestId('remove-item').click();
  await expect(page.getByTestId('receipt-items')).toHaveCount(0);
  await expect(page.getByTestId('split-mode-items')).toHaveCount(0);
});
