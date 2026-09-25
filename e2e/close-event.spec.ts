import { test, expect, Page } from '@playwright/test';

/**
 * «Подвести итог и закрыть событие» (docs/specs/close-event-and-reminders.md).
 *
 * Локальный режим сборки (build:test без Supabase): проверяется поведение
 * интерфейса. Запрет записи в закрытое событие на стороне базы доказывается
 * отдельно — test/launch-hardening-rls.test.mjs.
 */

async function loginAsGuest(page: Page) {
  await page.goto('/auth');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/auth');
  await page.getByRole('button', { name: /Быстрый демо-вход/ }).click();
  await expect(page).toHaveURL(/\/$|\/index/);
}

function seedGroup(id: string, status: 'active' | 'completed', withExpense = true) {
  return {
    id,
    name: 'Дача',
    category: 'trip',
    currency: 'RUB',
    status,
    members: [
      { id: 'm-1', name: 'Вы', avatar: '👑', role: 'owner' },
      { id: 'm-2', name: 'Миша', avatar: '👤', role: 'member' },
      { id: 'm-3', name: 'Лена', avatar: '👤', role: 'member' },
    ],
    expenses: withExpense
      ? [
          {
            id: 'e-1',
            title: 'Мясо и угли',
            amount: 3000,
            currency: 'RUB',
            amountInGroupCurrency: 3000,
            category: 'food',
            paidById: 'm-1',
            splitType: 'equal',
            createdAt: '2026-09-20T10:00:00.000Z',
            splits: [
              { userId: 'm-1', amountOwed: 1000 },
              { userId: 'm-2', amountOwed: 1000 },
              { userId: 'm-3', amountOwed: 1000 },
            ],
          },
        ]
      : [],
    settlements: [],
  };
}

async function seed(page: Page, group: unknown) {
  await page.evaluate((g) => {
    window.localStorage.setItem('splitit_local_groups_data', JSON.stringify([g]));
  }, group);
}

test.describe('Закрыть событие и подвести итог', () => {
  test('предпросмотр итога → закрытие → расходы заморожены → переоткрытие', async ({ page }) => {
    await loginAsGuest(page);
    const id = `group-${Date.now()}`;
    await seed(page, seedGroup(id, 'active'));
    await page.goto(`/events/detail?id=${id}`);

    // До закрытия расход можно редактировать.
    await expect(page.getByTitle('Редактировать расход').or(page.locator(`a[href*="expense/edit"]`)).first()).toBeVisible();

    await page.getByTestId('close-event').click();

    // Предпросмотр показывает переводы ДО подтверждения.
    const preview = page.getByTestId('event-summary');
    await expect(preview.getByTestId('summary-transfer')).toHaveCount(2);
    await expect(preview).toContainText('Миша');
    await expect(preview).toContainText('Лена');

    await page.getByRole('button', { name: 'Закрыть и зафиксировать' }).click();

    // Закрыто: баннер, итог, нет кнопок правки и добавления.
    await expect(page.getByText('Итог подведён')).toBeVisible();
    // Регрессия: .stitch-card перебивал bg-emerald-500 белым, текст итога был
    // белым на белом. Фон баннера обязан быть тёмным (есть background-image).
    const bannerBg = await page.getByTestId('closed-banner').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bannerBg).toContain('gradient');
    const summary = page.getByTestId('event-summary');
    await expect(summary.getByTestId('summary-transfer')).toHaveCount(2);
    await expect(summary.getByRole('button', { name: /Напомнить: Миша/ })).toBeVisible();
    await expect(summary.getByRole('button', { name: 'Поделиться итогом' })).toBeVisible();
    await expect(page.locator(`a[href*="expense/edit"]`)).toHaveCount(0);
    await expect(page.locator(`a[href*="expense/new"]`)).toHaveCount(0);
    await expect(page.getByTestId('close-event')).toHaveCount(0);

    // Статус сохранён, а не только нарисован.
    const stored = await page.evaluate(
      (gid) => JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]').find((g: any) => g.id === gid)?.status,
      id,
    );
    expect(stored).toBe('completed');

    // Владелец открывает снова — правка возвращается.
    await page.getByRole('button', { name: 'Открыть снова' }).click();
    await expect(page.getByTestId('close-event')).toBeVisible();
    await expect(page.locator(`a[href*="expense/edit"]`).first()).toBeVisible();
  });

  test('«Поделиться итогом» без Web Share копирует текст и честно говорит об этом', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'права на буфер обмена выдаются только в Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAsGuest(page);
    const id = `group-${Date.now()}`;
    await seed(page, seedGroup(id, 'completed'));
    await page.goto(`/events/detail?id=${id}`);
    // Эмулируем устройство без системной шторки.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });

    await page.getByRole('button', { name: 'Поделиться итогом' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Текст скопирован' })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('Дача');
    expect(text).toMatch(/Миша → Вы/);
    expect(text).toMatch(/Лена → Вы/);
  });

  test('пустое событие закрыть нельзя — нечего подводить', async ({ page }) => {
    await loginAsGuest(page);
    const id = `group-${Date.now()}`;
    await seed(page, seedGroup(id, 'active', false));
    await page.goto(`/events/detail?id=${id}`);
    await expect(page.getByRole('heading', { name: 'Дача' })).toBeVisible();
    await expect(page.getByTestId('close-event')).toHaveCount(0);
  });
});
