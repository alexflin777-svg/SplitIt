# SplitIT — Bug Report

**Дата последнего круга:** 2026-08-15 (внешнее ревью процесса и публичной поверхности)

**Архив прошлых кругов:** [bug_reports/2026-07-31-round-5.md](bug_reports/2026-07-31-round-5.md), раздел «Release audit — 2026-08-03» ниже.

---

## Круг 2026-08-15 — ревью-судья

Проверено на дереве `50945f3` (ветка `fix/review-2026-08-15`), Node 22.23.2.
Полный вывод гейта: lint 0, tsc 0, unit 54/54, RLS **90/90**, `npm test` **96 passed**.

| # | Дефект | Severity | Как найден | Статус |
|---|---|---|---|---|
| S1-4 | Скрипт `lint` в `package.json` заменён на `echo "Lint disabled due to next 16 flat config issue"` (`c49bf3c`). Шаг «lint» в `gate.yml` был зелёным при любом коде с 10.08 по 15.08. | S1 | чтение `git show HEAD:package.json` | ✅ Исправлено в `4de8d1f`: линт возвращён, добавлен шаг CI «Гейт не подменён заглушкой» |
| S1-5 | `e2e/integrity.spec.ts` искал кнопку «Добавить», переименованную в «Добавить друга» коммитом i18n `9b95860`. E2E на `main` падал, никто не заметил. | S1 | сверка `git show HEAD:src/lib/i18n/locales/ru.ts` с тестом | ✅ Исправлено в `4de8d1f` |
| S1-6 | Публично раздавалась debug-сборка: `public/SplitIT-Beta.apk` = `SplitIT-debug.apk` (md5 `701e9b0c206be78286dbe44eba04663d`), подписана общеизвестным отладочным ключом, старше сайта на день функциональности, `versionCode` = 1. Файл был force-добавлен в обход `.gitignore`. | S1 | `md5sum`, `git log`, `android/app/build.gradle` без `signingConfigs` | ✅ Раздача убрана в `50945f3`, файл удалён из индекса в `4de8d1f`. Release-подпись — P1-3 |
| S1-7 | `waitlist` принимала `INSERT` от `anon` с `WITH CHECK (true)`: запись без ограничений формата и длины. `email UNIQUE` + прямой INSERT работали как оракул «есть ли адрес в списке» (код 23505). | S1 | чтение `20260809000000_create_waitlist_table.sql` | ✅ Исправлено миграцией `20260815000000_harden_waitlist.sql` + RPC `join_waitlist`; покрыто `test/waitlist-rls.test.mjs` |
| S1-8 | Форма waitlist показывала «Спасибо!» безусловно: результат `joinWaitlist` игнорировался, при ошибке RLS или отсутствии бэкенда пользователь видел успех. Нарушение инварианта «ошибка не маскируется под успех». | S1 | чтение `src/app/page.tsx` | ✅ Исправлено в `50945f3` |
| S2-5 | `EventDetailClient` рисовал дату расхода как `new Date(expense.createdAt \|\| Date.now())`: у расхода без даты показывалось сегодняшнее число (выдуманное значение + расхождение гидратации). | S2 | правило `react-hooks/purity` после его включения обратно | ✅ Исправлено в `d091c45` |
| S2-6 | `HeaderNavLabel` мутировал `document.documentElement.lang` в теле компонента — побочный эффект в рендере. | S2 | правило `react-hooks/immutability` | ✅ Исправлено в `d091c45` |
| S2-7 | `SettleUpClient` вызывал сеттеры состояния, объявленные ниже по файлу. | S2 | правило `react-hooks/immutability` | ✅ Исправлено в `d091c45` |
| S2-8 | Из E2E пропал WebKit: проект `mobile` переведён с iPhone 13 (webkit) на Pixel 5 (chromium), при этом `gate.yml` продолжал ставить webkit и утверждать в комментарии обратное. Движок браузера iOS не проверялся. | S2 | сверка `playwright.config.ts` и `gate.yml` | ✅ Проект `mobile safari` возвращён под `PW_WEBKIT=1`, в CI флаг выставлен |
| S2-10 | `e2e/integrity.spec.ts:125` («отрицательный расход отклоняется и в обход нативной валидации») периодически падает по таймауту 30 с на `getByPlaceholder(/Например\|Ужин\|Название/i).fill()`: поле названия расхода на `/events/expense/new` не появляется. Частота — примерно 2 прогона полного набора из 8. | S2 | восемь последовательных прогонов `npm test` 15.08 | 🔴 **Открыт.** Причина не найдена: соседний тест с тем же переходом и тем же seed проходит, продуктовых записей в `splitit_local_groups_data` при старте нет. Рабочая гипотеза — гонка загрузки чанков под параллельными воркерами. В CI флейк больше не маскируется: `npm test -- --fail-on-flaky-tests` |
| S3-4 | i18n «на 10 языков»: строки waitlist были английскими заглушками в 9 локалях из 10. | S3 | `grep` по `src/lib/i18n/locales/` | ✅ Эти строки переведены; полный аудит ключей — P1-7 |
| S2-9 | Сводка Playwright несколько раз показала «95 passed» вместо 96. Первоначальная гипотеза «тесты теряются молча» **не подтвердилась**: при записи вывода в файл видно, что это падение теста `realistic-groups.spec.ts:62` («данные двух групп не смешиваются»), а сокращённая сводка — артефакт чтения вывода через конвейер. Тест читал текст страницы сразу после `goto()`, до того как эффект подставит данные из localStorage; при этом соседнее утверждение `not.toContain` в тот же момент зеленело именно потому, что на странице ещё ничего не было. | S2 | восемь прогонов подряд с записью вывода в файл | ✅ Исправлено: помощник `bodyAfter()` ждёт авторетраящимся `toContainText` появления якоря и только потом снимает текст. Дополнительно добавлен сторож `e2e/reporters/expect-all-tests.ts` — он валит прогон, если отчитались не все собранные тесты (проверен красным и зелёным) |
| S3-5 | Документы разошлись с фактами: «нет прав на push» при синхронной `origin/main`, «Next.js 14» в инвариантах при `next@16.3.0`, четыре источника версии Node с тремя ответами. | S3 | `git rev-list`, `package.json`, `.nvmrc` | ✅ `todo.md`, `handoff.md`, `AGENTS.md`, `README.md` приведены к факту; старые handoff'ы — в `docs/archive/` |

### Открыто по итогам круга

- **Push-уведомления не работают на Android:** `android/app/google-services.json` отсутствует, gradle логирует это и не применяет плагин. Код приехал 09.08 вне backlog. Решение — P2.
- **Сетевой режим не покрыт E2E:** `pretest` собирает `out/` с пустыми `NEXT_PUBLIC_SUPABASE_*`, все 96 тестов проверяют локальный режим. P2.
- **`react-hooks/set-state-in-effect` выключен** до P1-6, крайний срок пересмотра 2026-09-15.
- **Живые проверки** `verify:prod` / `verify:realtime` / `canary` не запускались с 01.08 — то есть до Next 16, i18n, OAuth и push. Повторить после P0-4.
- **Supabase Security Advisor:** `auth_leaked_password_protection` отключён с 01.08. Задача владельца, P0-3.

---

## Release audit — 2026-08-03 (архивный круг)

**Роль:** CODEX / Checker

Текущий candidate проходит локальный гейт: ESLint без предупреждений,
TypeScript без ошибок, unit **54/54**, RLS **84/84**, Playwright **92/92**,
production static export — 16 маршрутов. Миграция
`20260802000000_group_participants.sql` локально проверена, но к production
ещё не применена: Supabase CLI не связан с проектом и release-секретов в
окружении нет.

Мобильный production payload собран и smoke-проверен:

| Артефакт | SHA-256 | Статус |
|---|---|---|
| `SplitIT-1.0-build1-internal.apk` | `aba8256df2f738b676555c4ed2fe04890de28e9ef6b5d74b5c35012970e7653e` | Устанавливается и запускается на Android emulator; debug signature, только internal test |
| `SplitIT-1.0-build1-iOS-Simulator.zip` | `6e2d7b2f74a23daf719d03c29bc0faab67a1cb5079af6e2a513ba5a909385129` | Устанавливается и запускается на iPhone 13 Simulator; не устанавливается на физический iPhone |
| `SplitIT-1.0-build1-debug-signed-NOT-FOR-PLAY.aab` | `f02b6e52afe49e1b3795b27e7ebd10de5b7dd2700aef7ba6cf6dafaaeb71e26b` | Контейнер валиден, но подписан debug-ключом и не готов для Google Play |

Найденный на первом iOS smoke дефект safe-area исправлен: повторный screenshot
показывает header ниже status bar. Для физического iPhone/TestFlight по-прежнему
нужны Apple signing identity и provisioning profile. Перед закрытой сетевой
бетой также требуется контролируемо применить новую миграцию и повторить live
canary/verifier.

## Итог

Расчёты, сохранение данных и RLS-изоляция двух групп прошли. Блокирующих
дефектов в бизнес-логике не найдено. Визуальный smoke-test выявил один дефект
уровня S3: фиксированная нижняя навигация перекрывает карточку на длинном
экране баланса.

Четырнадцать профилей массовых сценариев создавались в одноразовой
PostgreSQL-среде. Дополнительно production Supabase проверен двумя временными
Auth-пользователями; после прогона они и тестовое событие удалены. В проекте
остался 1 штатный пользователь.

## Checker-прогон `chore/gate-canary-realtime` — 2026-08-01

Проверен `HEAD 8ac6f1e`. Продуктовый локальный гейт и внешний canary зелёные;
новых дефектов S1/S2 в логике приложения не найдено. Полная приёмка ветки
пока невозможна: новый Realtime-сценарий и изменённая общая обвязка
production-verifier не перепроверены с service-role, а GitHub Actions не
запущен на удалённой ветке.

| Проверка | Результат |
|---|---|
| `npm run lint` | ✅ 0 warnings/errors |
| `npx tsc --noEmit` | ✅ пройдено |
| `npm run test:unit` | ✅ **54/54**, 13 suites |
| `npm run test:rls` | ✅ **34/34**, 9 suites |
| `npm run build` | ✅ 15 статических страниц |
| `PLAYWRIGHT_PORT=4189 npm test` | ✅ **92/92**, mobile + desktop |
| `npm run canary` | ✅ **18/18** на `https://split-it-ere9.vercel.app` |
| `npm run serve:out` + браузерный smoke | ⚠️ `/auth` и демо-вход работают; на 375×812 нет горизонтального overflow, но найдены два S3 ниже |
| `node --check` новых canary/verify-скриптов | ✅ пройдено |
| `SUPABASE_SERVICE_ROLE_KEY=… npm run verify:prod` | ⏸ не запускалось: ключ отсутствует в окружении; прошлые 24/24 не доказывают новую общую обвязку |
| `SUPABASE_SERVICE_ROLE_KEY=… npm run verify:realtime` | ⏸ не запускалось: ключ отсутствует в окружении |
| Первый удалённый GitHub gate | ⏸ не проверен: ветка не опубликована, GitHub отклонил локальный SSH-ключ |

### Новые замечания smoke

| # | Дефект | Severity | Статус |
|---|---|---|---|
| CHK-1 | `/favicon.ico` отвечает 404 и создаёт console error как на локальном `out/`, так и на production | S3 | 🟡 Открыт |
| CHK-2 | На главной при 375×812 кнопка `Создать событие` занимает Y=715.5–755.5, а фиксированная навигация начинается с Y=722: нижние 33.5 px кнопки визуально перекрыты. После прокрутки кнопка полностью доступна | S3 | 🟡 Открыт |

Скриншот CHK-2: `output/playwright/checker-mobile-smoke.png`. Предупреждение
о ненастроенном Supabase в локальном smoke ожидаемо: `npm test` перед ним
намеренно создал `build:test` без публичных переменных. Предупреждения Node
`MODULE_TYPELESS_PACKAGE_JSON` также не влияют на результат гейта.

### Решение текущего прогона

- Локальный gate и canary приняты.
- Realtime и новая общая обвязка live-verifier не приняты до независимых
  прогонов с service-role и подтверждённой уборкой тестовых данных.
- Автоматический GitHub gate не принят до первого успешного запуска workflow
  на опубликованной ветке.
- Общий релиз по-прежнему заблокирован открытыми MOB-1…MOB-3; CHK-1 и CHK-2
  являются неблокирующими S3.

## Верификация мобильных артефактов — 2026-08-01

Выполнены проверка ZIP-контейнеров, manifest/Info.plist, архитектур, подписей,
встроенной production-конфигурации и smoke-запуск на Android 16 и iPhone 13
Simulator. `SplitIT-production.apk` устанавливается и запускается, но оба
переданных IPA нельзя принять как сборку для физического iPhone 13.

### Проверенные артефакты

| Артефакт | SHA-256 | Результат |
|---|---|---|
| `SplitIT-production.apk` | `ee3925bdb0e3d1bf70aff53c99d72d4b0e3a1c55fe5adf22480b2f22384ebb00` | ZIP цел; `app.splitit.mobile`, 1.0 (1), minSdk 24 / targetSdk 36; production Supabase и `NEXT_PUBLIC_APP_URL` присутствуют; установка и переход на `/auth` на Android 16 пройдены |
| `SplitIT-debug.apk` | `dd04cc90b1fb16bccfd33a834807380022df862bc5782bacdedbc9ade9161a81` | ZIP цел; production URL отсутствуют, то есть это локальная/debug-сборка |
| `SplitIT-iPhone-PhysicalDevice.ipa` | `0a71da46cbbaf46722633b709635f0f3d4c2e5c0d1c5ec2a5292880852b1f4eb` | ZIP цел; `iphoneos`, arm64, iOS 15+, production-конфигурация присутствует; web payload побайтово совпадает с production APK; приложение не подписано, provisioning profile отсутствует |
| `SplitIT-iPhone13.ipa` | `02cae4dce4115bb0546cf72dd83dc945ee2e29c312ee0f9e52ebf3766d635f45` | ZIP цел, но это старый `iphonesimulator` build без production URL; внутри ошибочно вложен второй `App.app`, ad-hoc подпись нарушена |

Физический `iPhone14,5` (iPhone 13) был обнаружен и спарен. Попытка установки
не дошла до валидации приложения, потому что устройство было заблокировано и
не позволило смонтировать Developer Disk Image. Это не меняет результат
статической проверки: `codesign` сообщает `code object is not signed at all`,
а `embedded.mobileprovision` в physical-device IPA отсутствует.

### Замечания

| # | Дефект | Severity | Статус |
|---|---|---|---|
| MOB-1 | APK/IPA отсутствуют во всех fetched refs `origin`: шаблоны `*.apk` и `*.ipa` исключены через `.gitignore`. Получить заявленные артефакты командой `git fetch && git switch` невозможно; они существуют только локально | S1 | 🔴 Открыт |
| MOB-2 | `SplitIT-iPhone-PhysicalDevice.ipa` не имеет ни code signature, ни provisioning profile и поэтому не является устанавливаемым артефактом для физического iPhone | S1 | 🔴 Открыт |
| MOB-3 | `SplitIT-iPhone13.ipa` собран для Simulator, содержит `App.app/App.app`, имеет нарушенную ad-hoc подпись и не содержит production-конфигурацию. На физическом iPhone использовать нельзя | S1 | 🔴 Открыт |
| MOB-4 | `SplitIT-production.apk` подписан тем же стандартным сертификатом `CN=Android Debug`, что и debug APK. Для release/Play-дистрибуции нужна стабильная release-подпись; для внутреннего sideload APK устанавливается | S2 | 🟠 Открыт |
| MOB-5 | `handoff.md` не описывает команду, env, commit, signing/export method и checksums новой сборки. Он всё ещё утверждает `main = c9b4674` и что APK/IPA собраны до сетевого режима без ключей, тогда как fetched `origin/main = 4ae8acd`, а новые production APK/IPA содержат Supabase-конфигурацию | S2 | 🟠 Открыт |
| MOB-6 | iOS status bar перекрывал логотип и кнопку «Событие» | S3 | ✅ Исправлено 2026-08-03 (WebKit safe-area fallback, повторный Simulator smoke) |
| MOB-7 | Android WebView при холодном старте трижды пишет `Error injecting safe area CSS: TypeError: Cannot read properties of null (reading 'style')`. На проверенных экранах видимого сбоя нет | S3 | 🟡 Открыт |

### Что нужно для повторной приёмки

1. Указать фактическую ветку или внешний канал хранения артефактов и добавить
   в `handoff.md` commit SHA, команды/env сборки, версии SDK, signing/export
   method и SHA-256 каждого файла.
2. Пересобрать IPA из текущего production web payload как `iphoneos` archive,
   подписать Apple Development/Ad Hoc/TestFlight-профилем для целевого
   устройства и проверить установку/запуск на iPhone 13.
3. Выпустить Android APK/AAB со стабильным release keystore либо явно пометить
   debug-signed APK как внутренний тестовый артефакт.

## Live production verification

`SUPABASE_SERVICE_ROLE_KEY=… npm run verify:prod` подтверждает GoTrue,
PostgREST, атомарные RPC и RLS под двумя настоящими сессиями: **24/24 passed**.
Проверены регистрация, trigger профиля, создание группы и расхода, запрет
чужого чтения/записи, одноразовое приглашение, права участника и потеря доступа
после выхода.

Первый вариант cleanup дал ложноположительный результат: после удаления Auth-
пользователей anon-запрос не видел оставшуюся группу из-за RLS и сообщил о
каскаде. Независимый SQL-аудит нашёл 1 группу и 1 расход. Тестовые строки были
удалены вручную по точному UUID, а verifier исправлен:

- cleanup выполняется в `finally`, включая аварийный выход;
- группа удаляется отдельным service-role запросом;
- итог проверяется service-role, а не anon-контекстом.

Повторный прогон прошёл 24/24. Независимый SQL-аудит после него:
`verify_users=0`, `verify_groups=0`, `verify_members=0`, `verify_expenses=0`.
Realtime этим сценарием не проверяется — для него нужен отдельный WebSocket-
тест.

## Проверенные сценарии

| Группа | Участники | Расходы | Итог | Ожидаемый расчёт | Результат |
|---|---:|---:|---:|---|---|
| Москва → Анталья: месяц на авто | 4 | 6 + 1 погашение | 260 000 ₽ | 2 перевода: 52 200 ₽ и 6 800 ₽ | пройдено |
| Выпускной университета 2026 | 10 | 7 | 500 000 ₽ | 9 переводов, общий долг 230 000 ₽ | пройдено |

Проверено, что все 14 пользователей видят только свою группу; профили,
расходы, доли и погашения между группами не пересекаются. Попытки участника
поездки записать расход в выпускной и участника выпускного — в поездку
отклонены PostgreSQL/RLS.

Подробные исходные данные и фактические результаты:
[realistic_scenarios_report.md](realistic_scenarios_report.md).

## Результат Checker-gate предыдущего круга

| Проверка | Результат |
|---|---|
| `npm run lint` | пройдено, 0 warnings/errors |
| `npx tsc --noEmit` | пройдено |
| `npm run test:unit` | **54/54**, 13 suites |
| `npm run test:rls` | **34/34**, 9 suites |
| `npm run build` | пройдено, 15 статических страниц |
| `npm test` | **92/92** в текущем дереве: 84 tracked + 8 из внешнего незатреканного regression-файла BottomNav |
| Визуальный smoke по `out/` | расчёты видимы, console/page errors: 0 |

Целевой прогон реалистичных групп отдельно прошёл 6/6: три сценария в двух
viewport. Полный `npm test` дополнительно повторил unit, RLS и test-build через
`pretest`. Файл `e2e/bottom-nav-overlap.spec.ts` принадлежит параллельной работе
и сознательно не включён в коммит этой ветки.

## Открытые дефекты

| # | Дефект | Severity | Зона | Статус |
|---|---|---|---|---|
| S3-2 | Десктопная вёрстка `/auth` обрезана по высоте на 1280×720 | S3 | ④ Gemini | ✅ Исправлено (компактный заголовок, убрано дублирование `pb-24`) |
| S3-3 | `BottomNav` перекрывает карточки `/events/balance` | S3 | ④ Gemini | ✅ Исправлено (добавлен safe-area-inset в BottomNav и pb-32 в main) |

## Внешние предупреждения

- Supabase Security Advisor: `auth_leaked_password_protection` — защита от
  скомпрометированных паролей отключена. Рекомендация:
  <https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection>.
- Node при прямом импорте TypeScript-фикстуры показывает
  `MODULE_TYPELESS_PACKAGE_JSON`. На сборку и тесты это не влияет; добавлять
  `"type": "module"` ради одного предупреждения без проверки всего Next.js
  проекта не следует.

## Решение предыдущего круга

Логика массовых сценариев, GoTrue/PostgREST и RLS готовы. S3-3 исправлен.
Production после live-прогона чист от тестовых данных. До полного утверждения
межустройственной синхронизации остаётся отдельная проверка Realtime WebSocket.
