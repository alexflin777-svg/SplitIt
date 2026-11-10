import { test, expect, Page } from '@playwright/test';

/**
 * 1.1.1, круг 5 (вердикт Codex perf-codex-r2.md, блокер 2): причина ошибки
 * доходит до главной. Настоящие projects-store, useProjectTiles и экран;
 * сбой подставляет e2e-фейк (splitit_fake_projects_fail, fn "table:…").
 */

const SESSION = 'splitit_local_user_session';
const SNAP = 'splitit_snap:u-anya:home-project-tiles';

async function loginAnya(page: Page) {
  await page.goto('/');
  await page.evaluate((key) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify({ id: 'u-anya', email: 'anya@example.com', full_name: 'Аня', avatar_url: '👩' }));
  }, SESSION);
}

async function createSolo(page: Page, name: string) {
  await page.goto('/projects/new');
  await page.getByTestId('project-name').fill(name);
  await page.getByTestId('project-new-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(/\/projects\/invite/);
}

/** Главная со снимком плиток: следующий заход сначала рисует снимок. */
async function homeWithSnapshot(page: Page, name: string) {
  await loginAnya(page);
  await createSolo(page, name);
  await page.goto('/');
  await expect(page.getByTestId('project-tile').filter({ hasText: name })).toBeVisible();
  await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k) !== null, SNAP)).toBe(true);
}

/** Плашка ошибки главной (у Next есть свой role=alert — объявление маршрута). */
const alert = (page: Page) => page.getByTestId('home-v1').getByRole('alert');

const failNext = (page: Page, mode: 'denied' | 'lost') =>
  page.evaluate((m) => window.localStorage.setItem('splitit_fake_projects_fail', JSON.stringify({ fn: 'table:projects', mode: m })), mode);

test('главная: 403/42501 — плитка исчезает, снимок удалён', async ({ page }) => {
  await homeWithSnapshot(page, 'Закрытый доступ');
  await failNext(page, 'denied');
  await page.goto('/');
  await expect(alert(page)).toBeVisible();
  await expect(page.getByTestId('project-tile').filter({ hasText: 'Закрытый доступ' })).toHaveCount(0);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), SNAP)).toBeNull();
});

test('главная: обрыв связи — плитки из снимка остаются, сверху «Повторить»', async ({ page }) => {
  await homeWithSnapshot(page, 'Сеть моргнула');
  await failNext(page, 'lost');
  await page.goto('/');
  await expect(alert(page)).toBeVisible();
  await expect(page.getByTestId('project-tile').filter({ hasText: 'Сеть моргнула' })).toBeVisible();
  expect(await page.evaluate((k) => window.localStorage.getItem(k), SNAP)).not.toBeNull();
  await alert(page).getByRole('button').click();
  await expect(alert(page)).toHaveCount(0);
  await expect(page.getByTestId('project-tile').filter({ hasText: 'Сеть моргнула' })).toBeVisible();
});

test('главная: доступ к одному проекту отозван — исчезает только он', async ({ page }) => {
  await homeWithSnapshot(page, 'Остаётся');
  await createSolo(page, 'Уходит');
  await page.goto('/');
  await expect(page.getByTestId('project-tile')).toHaveCount(2);
  // RLS больше не отдаёт строки второго проекта.
  await page.evaluate(() => {
    const db = JSON.parse(window.localStorage.getItem('splitit_fake_projects') ?? '{}');
    const gone = db.projects.find((p: { name: string }) => p.name === 'Уходит').id;
    db.project_members = db.project_members.filter((m: { project_id: string }) => m.project_id !== gone);
    window.localStorage.setItem('splitit_fake_projects', JSON.stringify(db));
  });
  await page.goto('/');
  await expect(page.getByTestId('project-tile').filter({ hasText: 'Уходит' })).toHaveCount(0);
  await expect(page.getByTestId('project-tile').filter({ hasText: 'Остаётся' })).toBeVisible();
  const snap = await page.evaluate((k) => window.localStorage.getItem(k) ?? '', SNAP);
  expect(snap).toContain('Остаётся');
  expect(snap).not.toContain('Уходит');
});
