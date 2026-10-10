import { test, expect, Page } from '@playwright/test';

/**
 * G4: удаление гостя. Локальный режим (сетевой — test/remove-guest-rls.test.mjs).
 * Гость с расходом не удаляется и получает понятный текст; гость без денег
 * удаляется; владельца события удалить нельзя (кнопки нет).
 */

const SESSION = { id: 'm-1', email: 'guest@splitit.app', full_name: 'Алексей', avatar_url: '👤', has_completed_onboarding: true };
const GROUP_ID = 'g-remove-guest';

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
        name: 'Дача',
        category: 'trip',
        currency: 'RUB',
        status: 'active',
        createdBy: 'm-1',
        createdAt: '2026-10-01T10:00:00.000Z',
        members: [
          { id: 'm-1', name: 'Алексей', avatar: '👑', role: 'owner' },
          { id: 'm-2', name: 'Мария', avatar: '👤', role: 'member' },
          { id: 'm-3', name: 'Иван', avatar: '👤', role: 'member' },
        ],
        expenses: [
          {
            id: 'e-1',
            title: 'Шашлык',
            amount: 1000,
            currency: 'RUB',
            amountInGroupCurrency: 1000,
            category: 'food',
            paidById: 'm-1',
            splits: [
              { userId: 'm-1', amountOwed: 500 },
              { userId: 'm-2', amountOwed: 500 },
            ],
            createdAt: '2026-10-01T12:00:00.000Z',
          },
        ],
        settlements: [],
      },
    ] as const,
  );
  await page.goto(`/events/detail?id=${GROUP_ID}`);
  await expect(page.getByText('Шашлык')).toBeVisible();
}

const storedMembers = (page: Page) =>
  page.evaluate((id) => {
    const groups = JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]');
    return (groups.find((g: any) => g.id === id)?.members ?? []).map((m: any) => m.id);
  }, GROUP_ID);

test('гость с расходом не удаляется — понятный текст, участник остаётся', async ({ page }) => {
  await seed(page);
  await page.getByTestId('remove-member-m-2').click();
  await expect(page.getByTestId('action-error')).toContainText('У гостя есть расходы — сначала перенесите или удалите их');
  await expect(page.getByTestId('remove-member-m-2')).toBeVisible();
  expect(await storedMembers(page)).toEqual(['m-1', 'm-2', 'm-3']);
});

test('гость без денег удаляется; у владельца кнопки удаления нет', async ({ page }) => {
  await seed(page);
  await expect(page.getByTestId('remove-member-m-1')).toHaveCount(0);
  await page.getByTestId('remove-member-m-3').click();
  await expect(page.getByTestId('remove-member-m-3')).toHaveCount(0);
  await expect(page.getByTestId('action-error')).toHaveCount(0);
  expect(await storedMembers(page)).toEqual(['m-1', 'm-2']);
  // После перезагрузки гость не возвращается.
  await page.reload();
  await expect(page.getByText('Шашлык')).toBeVisible();
  await expect(page.getByTestId('remove-member-m-3')).toHaveCount(0);
});
