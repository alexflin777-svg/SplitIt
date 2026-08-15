import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);

/**
 * Тесты гоняются по статическому экспорту из out/, а не по `next dev`.
 *
 * Причина в правиле §1 из .agents/rules/antigravity2_core.md: дефект S0-2
 * (созданное событие отдаёт 404) в dev-режиме не воспроизводится вообще, потому
 * что dev-сервер рендерит динамические маршруты на лету. В APK, IPA и на статик-
 * хостинге такого рантайма нет. Проверять нужно ровно то, что уезжает к
 * пользователю.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Сторож ./e2e/reporters/expect-all-tests.ts подключён всегда: он валит прогон,
  // если выполнились не все собранные тесты. Наблюдалось 15.08 под нагрузкой —
  // сводка печатала «95 passed» из 96 без единого failed.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['./e2e/reporters/expect-all-tests.ts']]
    : [['list'], ['./e2e/reporters/expect-all-tests.ts']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    locale: 'ru-RU',
    screenshot: 'only-on-failure',
  },

  /**
   * Три проекта, из них два по умолчанию.
   *
   * `mobile safari` (WebKit, iPhone 13) — единственное покрытие браузерного
   * движка iOS. Он был молча потерян при переходе mobile → Pixel 5, ровно
   * когда P1-4 в todo.md обсуждает web/PWA-бету на iPhone. Возвращён, но
   * включается флагом PW_WEBKIT=1: WebKit требует системных библиотек
   * (libgtk-4, libgraphene), которых нет на машине разработчика, а ставить
   * их молча в чужую систему нельзя. В CI флаг выставлен всегда — см.
   * .github/workflows/gate.yml, там же ставится сам браузер.
   *
   * Если локально нужен полный набор:
   *   npx playwright install --with-deps webkit && PW_WEBKIT=1 npm test
   */
  projects: [
    {
      name: 'mobile chromium',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    ...(process.env.PW_WEBKIT === '1'
      ? [
          {
            name: 'mobile safari',
            use: { ...devices['iPhone 13'] },
          },
        ]
      : []),
  ],

  /**
   * Сервер поднимается только на свежесобранном out/ и только своим процессом.
   *
   * Прошлая версия делала build внутри webServer.command и разрешала
   * reuseExistingServer вне CI. Два Чекера, запущенные параллельно, начинали
   * сборку одновременно; первый занимал порт, второй получал EADDRINUSE и
   * прогонял тесты на чужом сервере — зелёный результат не говорил, какой
   * именно out/ проверялся.
   *
   * Теперь: порт берётся из PLAYWRIGHT_PORT (можно развести параллельные
   * прогоны), переиспользование чужого сервера запрещено всегда, а сборка
   * вынесена в отдельный скрипт pretest, чтобы падение сборки было падением
   * сборки, а не таймаутом ожидания порта.
   */
  webServer: {
    command: `PORT=${PORT} node scripts/serve-out.mjs`,
    url: `http://localhost:${PORT}/__ping`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
