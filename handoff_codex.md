# Handoff CODEX — SplitIT

Дата состояния: 2026-08-01  
Роль: CODEX, ревьюер логики и Checker  
Ветка: `main`  
HEAD на момент записи: `b39f96fe`  
Статус Git: рабочее дерево изменено, коммит и push не выполнялись.

## Цель проекта и моя роль

Цель SplitIT — безопасное multi-user приложение для совместного учёта расходов: группы, участники, расходы, доли, погашения, приглашения и синхронизация через Supabase.

Рабочий конвейер проекта:

1. Claude Code пишет или меняет backend/API и бизнес-логику.
2. CODEX проверяет реализацию, контракты данных, Auth/RLS, целостность операций и исправляет найденные дефекты.
3. CODEX в роли Checker запускает lint, TypeScript, SQL/RLS-тесты, production build, Playwright и браузерный smoke-test; результат собирает в `bug_report.md`.
4. Gemini в Antigravity дорабатывает UI/UX и устраняет визуальные дефекты по handoff и bug report.

Моя текущая цель — довести этот цикл до воспроизводимого состояния: безопасная схема Supabase, честные пользовательские сценарии без фиктивных данных, атомарные multi-user операции, рабочие MCP-подключения и проверяемый отчёт для Gemini.

## Текущее состояние

### Supabase и backend

- В live-проект Supabase `jrarbbfsqrkjckujfpcz` применены все пять миграций, включая две новые миграции CODEX.
- В публичной схеме восемь таблиц с включённым RLS и 28 политиками.
- Security Advisor после усиления функций не показывает замечаний (`lints: []`).
- Публичные клиентские RPC доступны только роли `authenticated`; прямой `anon execute` закрыт.
- Создание группы с владельцем, создание/обновление расхода с долями и принятие приглашения переведены на атомарные RPC.
- Приглашение стало одноразовым: код удаляется в транзакции и второй пользователь не может принять использованный код.
- Realtime publication включает `groups`, `group_members`, `expenses`, `expense_splits`, `settlements`.
- Production REST endpoint больше не отвечает ошибкой отсутствующей схемы; запрос таблицы `groups` с anon key возвращает HTTP 200 и пустой список.
- В Auth сейчас нет подтверждённых пользователей. Полный live-сценарий с двумя аккаунтами ещё не проверен.

### Клиентская логика

- Удалён ложный вход через один только localStorage: в network-режиме личность подтверждается активной Supabase session.
- Регистрация с обязательным подтверждением email больше не считается немедленным успешным входом.
- Demo/Telegram-профили доступны только в local-режиме и не маскируются под Supabase-пользователей.
- Переход через приглашение сохраняет `code` после маршрута авторизации.
- Профиль больше не выдумывает `user@example.com`; изменения профиля в network-режиме сохраняются удалённо.
- В нижней навигации реализован настоящий logout вместо ссылки на страницу входа.
- Публичная ссылка приглашения строится только из безопасного публичного HTTPS origin; localhost не публикуется как рабочая ссылка.
- В network-режиме плательщик погашения привязан к авторизованному пользователю, а локальный выбор участников при создании события не обещает то, что backend игнорирует.
- Remote store учитывает `status` группы, проверяет нулевое число изменённых строк и подписывается на недостающие Realtime-события.

### Правила проекта

Файл `.agents/rules/antigravity2_core.md` обновлён:

- устранены дубли номеров инвариантов;
- зафиксирован обязательный Checker-порядок: lint → TypeScript → RLS → production build → `npm test` → smoke по production artifact;
- запрещён прямой `npx playwright test`, потому что он может обойти `pretest`;
- добавлены инварианты Supabase identity, атомарности связанных записей и обязательной проверки Security Advisor;
- одноразовое приглашение теперь требует проверки третьим пользователем после первого принятия.

### Подтверждённые проверки

- `npm run lint` — успешно, 0 warnings.
- `npx tsc --noEmit` — успешно.
- `npm run test:rls` — успешно, 28 тестов.
- `npm run build` — успешно, production build, 15 страниц.
- Последний сохранённый Playwright result имеет статус `passed`, но это был целевой повтор `e2e/auth.spec.ts` после исправления селектора, а не окончательный полный прогон всего набора.
- Production smoke ранее подтвердил страницы auth, unauthenticated profile и сохранение invite-code без console errors.

## Изменённые и добавленные файлы

### Миграции и настройка Supabase

- `supabase/migrations/20260801000000_fix_multiuser_contracts.sql` — атомарные RPC и одноразовое принятие приглашения.
- `supabase/migrations/20260801000001_harden_function_privileges.sql` — разделение private/public функций, права execute, RLS-оптимизации и индексы.
- `SUPABASE_SETUP.md` — актуальный порядок пяти миграций.
- `.env.example` — `NEXT_PUBLIC_APP_URL` больше не предлагает localhost как публичный origin.

### Логика приложения

- `src/lib/remote-store.ts` — атомарные RPC, корректный status, проверки результата DML, Realtime.
- `src/lib/store.ts` — валидированная активная сессия и сохранение профиля.
- `src/lib/supabase.ts` — корректный Auth/session contract, remote profile, logout и события профиля.
- `src/lib/env.ts` — нормализация публичного APP URL.
- `src/lib/routes.ts` — безопасное построение invite origin.
- `src/app/auth/page.tsx` — подтверждение email, безопасный return path, local-only demo.
- `src/app/invite/InviteClient.tsx` — сохранение invite-code через вход.
- `src/app/page.tsx` — честное различие local/network режима.
- `src/app/profile/page.tsx` — отсутствие фиктивного пользователя и remote save.
- `src/app/events/new/page.tsx` — корректный network UX без фиктивного выбора участников.
- `src/app/events/detail/EventDetailClient.tsx` — ошибка конфигурации до создания бесполезного invite-code.
- `src/app/events/settle/SettleUpClient.tsx` — допустимый payer и обработка ошибок загрузки.
- `src/components/BottomNav.tsx` — настоящий вход/выход.

### Тесты, правила и артефакты

- `test/rls.test.mjs` — тесты атомарного создания группы, rollback неверного split и одноразового invite.
- `e2e/auth.spec.ts` — безопасный возврат после входа, защита от open redirect и logout.
- `e2e/integrity.spec.ts` — отсутствие выдуманного профиля.
- `.agents/rules/antigravity2_core.md` — обновлённый контракт работы агентов.
- `handoff.md` — уже был изменён до текущей работы; мои дополнения смешаны с существующими незакоммиченными правками, поэтому файл нельзя бездумно перезаписывать.
- `output/playwright/prod-auth-desktop.png` — desktop auth smoke.
- `output/playwright/prod-auth-mobile.png` — mobile auth smoke.
- `output/playwright/prod-profile-unauthenticated.png` — unauthenticated profile smoke.

## MCP: что подключено и что проверено

Конфигурация `/Users/annafa/.gemini/config/mcp_config.json` валидна и содержит ровно 12 запрошенных серверов.

Успешно отвечают на MCP initialize:

- `StitchMCP`;
- `chrome-control`;
- `chrome-devtools-mcp`;
- `cloudrun`;
- `gitlab-orbit`;
- `google-developer-knowledge`;
- `playwright`;
- `sequential-thinking`;
- `testsprite`.

Требуют дополнительных действий владельца среды:

- `antimetal` — HTTP 401, нужна OAuth-авторизация;
- `supabase` в конфигурации Gemini — HTTP 401, нужна OAuth-авторизация именно этой MCP-поверхности;
- `alloydb-postgresql` — не заданы `ALLOYDB_POSTGRES_PROJECT`, `ALLOYDB_POSTGRES_REGION`, `ALLOYDB_POSTGRES_CLUSTER`, `ALLOYDB_POSTGRES_INSTANCE`, `ALLOYDB_POSTGRES_DATABASE`; после этого понадобятся Google ADC credentials.

Отдельно для CODEX установлен и авторизован Supabase plugin; через него live-схема была проверена и миграции применены.

Важно: команда `gemini mcp list` показывает пустой список, потому что Gemini CLI читает `~/.gemini/settings.json`, а проверяемый файл относится к конфигурации Antigravity. Автоматически копировать туда MCP-конфиг с секретами не выполнялось.

## Что пробовал, но не получил окончательного результата

1. Полный `npm test` был запущен. Два теста logout упали только из-за неоднозначного Playwright-селектора `Войти`, который совпадал и с заголовком, и с кнопкой навигации. Селектор заменён на exact; целевой повтор auth-набора прошёл. Полный набор после этого исправления ещё нужно повторить и сохранить итоговое количество тестов.
2. Попытка использовать wrapper из Playwright skill остановилась: отсутствовал Chrome for Testing, а его загрузка зависла. Для smoke использован установленный Chromium из зависимостей проекта. Это дало рабочий результат, но wrapper не восстановлен.
3. Live two-account поток Auth → group → invite → expense → Realtime не выполнен: в Supabase Auth ноль подтверждённых пользователей, а email confirmation включён. Подменять auth-таблицы вручную небезопасно.
4. `antimetal` и Gemini-вариант `supabase` не прошли initialize из-за OAuth 401.
5. `alloydb-postgresql` не стартовал без project/region/cluster/instance/database и ADC.
6. Публичный `NEXT_PUBLIC_APP_URL` не настроен. Текущее localhost-значение намеренно считается непубликуемым, поэтому создание рабочей invite-ссылки в production будет заблокировано до указания deploy URL.

## Найденное, но ещё не исправленное

### Приоритет: безопасность и честность данных

- В `src/lib/supabase.ts` остался старый Supabase Broadcast-канал `splitit:user:<id>`, который пересылает целиком локальные `groups` и `friends`. Канал не является подтверждённым RLS-защищённым хранилищем и потенциально раскрывает данные подписчику, знающему UUID. План — удалить удалённый Broadcast, оставить browser BroadcastChannel/storage только для вкладок одного устройства, а межустройственную синхронизацию групп оставить PostgreSQL Changes.
- В `src/app/friends/page.tsx` локальный список по умолчанию создаёт фиктивных друзей, а форма выдумывает email/phone. Баннер «рабочая ссылка» ведёт на сценарий, который фактически не добавляет друга. Это нарушает инвариант «не фабриковать пользовательские данные и возможности».

### UI/UX для Gemini

- На desktop 1280×720 фиксированная нижняя навигация перекрывает кнопку регистрации. Доказательство: `output/playwright/prod-auth-desktop.png`.
- На mobile этот же экран проходит, но нижний отступ близок к границе и должен быть проверен после UI-исправления.

### Дополнительный технический долг

- Некоторые вложенные event-страницы при ошибке `getGroup` могут остаться в состоянии «Загрузка…» вместо явного error state. Нужна отдельная проверка и тест.
- Performance Advisor сообщает только INFO о неиспользуемых индексах; база пока пустая, удалять индексы на этом основании нельзя.

## Что планирую дальше

1. Удалить небезопасный remote Broadcast из `src/lib/supabase.ts`, сохранив синхронизацию вкладок в одном браузере.
2. Убрать фиктивных друзей, выдуманные email/phone и неработающую «рабочую ссылку» из `src/app/friends/page.tsx`; добавить E2E-инвариант честного пустого состояния.
3. Повторить Checker-цепочку в точном порядке:
   - `npm run lint`;
   - `npx tsc --noEmit`;
   - `npm run test:rls`;
   - `npm run build`;
   - production smoke на собранном `out/`;
   - `npm test` со встроенным `pretest` и зафиксировать полный итог.
4. Остановить оставшийся процесс `npm run serve:out` после smoke-проверки.
5. Обновить `bug_report.md`, `progress.md`, `todo.md` и аккуратно дополнить существующий `handoff.md`, не уничтожая прежние пользовательские изменения.
6. Передать Gemini визуальную задачу с desktop screenshot и точными критериями приёмки.
7. После задания владельцем публичного deploy URL повторить invite smoke.
8. После появления двух подтверждённых тестовых аккаунтов выполнить live multi-user E2E и Realtime-проверку.

## Критерий завершения текущего раунда

Раунд можно считать завершённым, когда полный Checker-набор проходит без ошибок, `bug_report.md` отражает live-состояние Supabase и MCP, фиктивные friends-сценарии удалены, remote Broadcast не раскрывает локальный store, production UI smoke сохранён, а единственными внешними блокерами остаются OAuth/ADC, публичный APP URL и предоставление двух подтверждённых тестовых аккаунтов.
