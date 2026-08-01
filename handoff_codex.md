# Handoff CODEX — SplitIT

**Обновлён:** 2026-08-01
**Роль:** ② CODEX → ③ CODEX/Чекер
**Ветка:** `fix/local-contacts-realtime-integrity`
**База:** `origin/main` @ `814de5e`
**Источник правды:** GitHub и текущий `bug_report.md`

## Цель проекта и моя цель

SplitIT — multi-user приложение для совместных расходов: группы, участники,
расходы, доли, погашения, одноразовые приглашения и синхронизация через
Supabase.

Моя роль в конвейере:

1. принять backend/API-логику после Claude Code;
2. проверить контракты Auth, RLS, Realtime и целостность операций;
3. встроить исправления без параллельных способов делать одно и то же;
4. заморозить продуктовый код и в роли Checker пройти полный гейт;
5. передать `bug_report.md` и визуальные доказательства Gemini.

Цель этого раунда — не допустить утечки локального store через Realtime и
убрать фиктивные контакты/возможности с экрана друзей.

## Текущее состояние

### Репозиторий

- Правила `.agents/rules/collaboration.md` изучены и соблюдены.
- Работа ведётся не в `main`, а в task-ветке
  `fix/local-contacts-realtime-integrity` от чистого `origin/main`.
- Проверенный продуктовый срез закоммичен как `e44382e` и опубликован в
  `origin/fix/local-contacts-realtime-integrity`.
- Перед первым push повторный `git fetch` подтвердил: ветка опережала
  `origin/main` ровно на один коммит, отставание — 0.
- Старые изменения предыдущего раунда уже находятся в GitHub-коммитах
  `580dd04` и `658bef5`; повторно их не создавал.

### Supabase

- Live project: `jrarbbfsqrkjckujfpcz`.
- Применены пять миграций:
  `20260731000000`, `20260731000001`, `20260731000002`,
  `20260801000000`, `20260801000001`.
- Повторный Security Advisor: `lints: []`.
- `auth.users`: 0 всего, 0 подтверждённых.
- Атомарные group/expense/invite RPC и RLS ранее применены и проходят 28
  PostgreSQL-тестов.

### Исправлено в этом раунде

- Удалён Supabase Broadcast `splitit:user:<uuid>`, передававший локальные
  `groups` и `friends` без private channel/RLS.
- Browser BroadcastChannel оставлен только как безданный сигнал перечитать
  localStorage между вкладками одного origin.
- Межустройственная синхронизация групп остаётся через PostgreSQL Changes в
  `remote-store.ts` и ограничивается RLS.
- Пустой список друзей больше не получает Максима, Елену и Анастасию.
- Точные записи старого demo seed удаляются при чтении; пользовательские
  контакты сохраняются.
- Контакт без телефона больше не получает выдуманный номер или email
  `@splitit.app`.
- Удалены неподтверждённый статус «Активен» и неработающая «рабочая ссылка»
  `/auth?invite=friend`.
- Ошибка записи контакта в localStorage больше не маскируется локальным
  обновлением UI.
- В правилах устранено противоречие: Definition of Done требует `npm test`,
  а не прямой `npx playwright test`, обходящий `pretest`.

## Изменённые файлы

### Продукт и тесты

- `src/lib/supabase.ts`
- `src/app/friends/page.tsx`
- `e2e/integrity.spec.ts`
- `.agents/rules/antigravity2_core.md`

### Отчёты и доказательства

- `bug_report.md`
- `bug_reports/2026-07-31-round-5.md`
- `progress.md`
- `todo.md`
- `handoff.md`
- `handoff_codex.md`
- `output/playwright/round7-friends-mobile.png`
- `output/playwright/round7-friends-desktop.png`
- `output/playwright/round7-auth-desktop.png`

## Подтверждённые результаты

Обязательный Checker-гейт выполнен в порядке проекта:

| Проверка | Результат |
|---|---|
| `npm run lint` | exit 0, warnings 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run test:rls` | 28/28 |
| `npm run build` | 15 статических страниц |
| `npm test` | 78/78, mobile + desktop |
| `npm run serve:out` + smoke | 375×812 и 1280×720, console errors 0 |

Целевой `e2e/integrity.spec.ts` отдельно прошёл 32/32. Все запущенные мной и
оставшиеся от прошлого раунда процессы `serve:out` остановлены.

## Что пробовал без окончательного результата

1. Playwright CLI wrapper не восстановлен: Chrome for Testing отсутствовал, а
   его загрузка ранее зависла. Для smoke использован установленный Chromium из
   зависимостей проекта; сами проверки и скриншоты успешны.
2. Live two-account Auth → invite → PostgREST → Realtime не выполнен: в Auth
   нет пользователей. Создавать записи напрямую в `auth.users` ради зелёного
   отчёта не стал.
3. Прямое открытие Vercel URL через web-fetch было отклонено инструментом как
   unsafe URL; текущая ветка всё равно ещё не задеплоена. Canary отложен до
   push и Vercel deployment.
4. Автоматический замер перекрытия `/auth` завершился timeout из-за устаревшего
   имени submit-кнопки. Скриншот успел сохраниться и визуально подтверждает
   дефект; продуктовый тест от этой попытки не заявляется.
5. `antimetal` и Gemini-вариант Supabase MCP по-прежнему требуют OAuth;
   AlloyDB требует project/region/cluster/instance/database и Google ADC.

## Открыто

### Следующей роли — Gemini

- S3-2: на `/auth` при 1280×720 fixed BottomNav перекрывает форму регистрации.
  Доказательство: `output/playwright/round7-auth-desktop.png`.
- После UI-исправления нужны снимки 375×812 и 1280×720 и повтор полного гейта.

### Владельцу / production-проверке

- Создать два подтверждённых тестовых аккаунта и пройти сценарий owner → invite
  → member → expense → Realtime; третьим контекстом проверить повторный код.
- Проверить Supabase Site URL/Redirect URLs для
  `https://split-it-ere9.vercel.app`.
- Решить email confirmation/SMTP для закрытой беты.
- После следующего deployment/merge сделать Vercel canary.

### Технический backlog

- unit-тесты сложных случаев `simplifyDebts`;
- тесты конвертации валют;
- OCR fixtures;
- PDF export, СБП, offline network, avatar compression;
- отдельная проверка error state вложенных event-экранов вместо вечной
  «Загрузки…».

## Что планирую дальше

1. Передать Gemini ветку `fix/local-contacts-realtime-integrity` и S3-2.
2. После UI-правки повторить полный гейт и приложить after-снимки.
3. Создать PR и выполнить squash merge только после завершения роли Gemini.
4. После deployment выполнить Vercel canary.
5. Когда появятся два подтверждённых аккаунта, пройти live multi-user сценарий.

## Критерий завершения

Текущий CODEX/Checker-раунд завершён: diff проверен, продуктовый коммит создан и
task-ветка опубликована. Общая beta-ready цель не завершена до production-flow
двумя аккаунтами, настройки Auth URL/SMTP и исправления S3-2.
