import { test, expect } from '@playwright/test';

/**
 * Проверка режима собранного артефакта (инвариант И-12).
 *
 * Набор E2E написан под локальный режим: он сеет данные в localStorage и ждёт,
 * что приложение будет читать их оттуда. Если собрать `out/` с настоящими
 * ключами Supabase, приложение уйдёт в сетевой режим, и девять проверок
 * посыпятся с сообщениями, которые ничего не говорят о причине.
 *
 * Так и случилось, когда в `.env.local` появился настоящий проект: прогон
 * зависел от того, что лежит в файле у конкретного разработчика. Теперь режим
 * фиксирует скрипт `build:test`, а эта проверка ловит рассинхрон явно и первой.
 *
 * Сетевой режим проверяется не здесь: для него нужны живой проект, применённые
 * миграции и два аккаунта — сценарий описан в SUPABASE_SETUP.md.
 */
test('сборка под тесты собрана в локальном режиме', async ({ page, request }) => {
  const html = await (await request.get('/')).text();
  const chunks = [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]);
  expect(chunks.length).toBeGreaterThan(0);

  for (const chunk of chunks) {
    const body = await (await request.get(chunk)).text();
    expect(
      body,
      `в сборку вшит адрес Supabase (${chunk}). Соберите через "npm run build:test" — иначе набор проверяет не то, что описывает.`,
    ).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
  }

  // Второй признак того же: экран авторизации сообщает про локальный режим.
  await page.goto('/auth');
  await expect(page.getByText(/Не настроен бэкенд/)).toBeVisible();
});
