import { test, expect, Page } from '@playwright/test';

/**
 * 1.1.1, круг 2 (ревью Codex perf-codex.md): смена аккаунта без перезагрузки,
 * отзыв доступа после снимка, проект без доступного открытого периода.
 * e2e-фейк store проектов (build:test), как projects-r2.spec.ts.
 */

const SESSION = 'splitit_local_user_session';
const FAKE_DB = 'splitit_fake_projects';

async function loginAnya(page: Page) {
  await page.goto('/');
  await page.evaluate((key) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify({ id: 'u-anya', email: 'anya@example.com', full_name: 'Аня', avatar_url: '👩' }));
  }, SESSION);
}

/** Проект из одной Ани с шаблоном «Свои»; возвращает id. */
async function createSolo(page: Page, name: string): Promise<string> {
  await page.goto('/projects/new');
  await page.getByTestId('project-name').fill(name);
  await page.getByTestId('project-new-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(/\/projects\/invite/);
  return new URL(page.url()).searchParams.get('id')!;
}

/** Правка фейковой базы, как если бы её изменил сервер. */
async function editFakeDb(page: Page, change: 'revoke-anya' | 'close-periods', pid: string) {
  await page.evaluate(
    ({ key, change, pid }) => {
      const db = JSON.parse(window.localStorage.getItem(key) ?? '{}');
      if (change === 'revoke-anya') {
        db.project_members = db.project_members.filter((m: { project_id: string; user_id: string }) => m.project_id !== pid || m.user_id !== 'u-anya');
      } else {
        for (const p of db.project_periods) if (p.project_id === pid) p.status = 'closed';
      }
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    { key: FAKE_DB, change, pid },
  );
}

test('вход другого аккаунта в соседней вкладке: главная сразу без плиток прежнего', async ({ page, context }) => {
  await loginAnya(page);
  await createSolo(page, 'Секрет Ани');
  await page.goto('/');
  await expect(page.getByTestId('project-tile').filter({ hasText: 'Секрет Ани' })).toBeVisible();

  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(
    (key) => window.localStorage.setItem(key, JSON.stringify({ id: 'u-borya', email: 'borya@example.com', full_name: 'Боря', avatar_url: '🧔' })),
    SESSION,
  );

  // Без перезагрузки первой вкладки: плитка Ани пропадает, снимок Ани стёрт.
  await expect(page.getByTestId('project-tile').filter({ hasText: 'Секрет Ани' })).toHaveCount(0);
  const snaps = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('splitit_snap:u-anya')));
  expect(snaps).toEqual([]);
});

test('доступ отозван после снимка: экран «нет доступа», снимок удалён', async ({ page }) => {
  await loginAnya(page);
  const pid = await createSolo(page, 'Отозванный');
  await page.goto(`/projects/detail?id=${pid}`);
  await expect(page.getByText('Отозванный').first()).toBeVisible();
  const key = `splitit_snap:u-anya:project:${pid}`;
  await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k) !== null, key)).toBe(true);

  // Аню убрали из проекта: RLS больше не отдаёт его строки.
  await editFakeDb(page, 'revoke-anya', pid);
  await page.goto(`/projects/detail?id=${pid}`);

  await expect(page.getByTestId('project-no-access')).toBeVisible();
  await expect(page.getByText('Отозванный')).toHaveCount(0);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), key)).toBeNull();
});

test('нет доступного открытого периода: экран не падает, история доступна', async ({ page }) => {
  await loginAnya(page);
  const pid = await createSolo(page, 'Без периода');
  // Вышедшему участнику RLS не показывает новый период: в ответе только закрытые.
  await editFakeDb(page, 'close-periods', pid);
  await page.goto(`/projects/detail?id=${pid}`);

  await expect(page.getByTestId('project-no-open-period')).toBeVisible();
  await expect(page.locator('a[href*="/projects/settle"][href*="period="]').first()).toBeVisible();
});
