# SplitIT (Сплит-Чек)

Приложение для разделения совместных расходов: поездки, аренда жилья,
рестораны, вечеринки. Заводите событие, добавляете участников и расходы —
приложение считает, кто кому сколько должен, и сводит долги к минимальному
числу переводов.

**Статус:** кандидат `1.0 (build 1)` для закрытой беты. Production-конфигурация
Supabase используется в web и внутренних мобильных сборках. Новая миграция
`group_participants` проверена локально, но должна быть применена к production
до публикации соответствующего клиента. Добавлены удаление событий и честная
проверка обновлений по прямой ссылке из манифеста; небезопасного объединения
аккаунтов по совпадению имени нет.

Развёртывание: [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — база и миграции,
[VERCEL_SETUP.md](VERCEL_SETUP.md) — хостинг и публичный адрес. Порядок важен:
миграции применяются до деплоя, иначе приложение увидит ключи, решит что оно
сетевое, и упадёт на каждом экране.

## Стек

Next.js 14 (App Router, TypeScript, Tailwind) · Supabase (PostgreSQL, Auth,
Realtime) · Capacitor для APK и IPA · Tesseract.js для распознавания чеков.

**Ограничение, определяющее почти все решения:** `output: 'export'`. Серверного
рантайма нет ни в APK, ни на статик-хостинге — значит нет API routes, нет SSR и
нет динамических маршрутов, которые не были собраны заранее. Идентификаторы
живут в query-строке, а не в пути.

## Запуск

**Требование:** каноническая версия — **Node.js 24** (`.nvmrc`, GitHub Actions). Допустимый диапазон — **22–24**, он же в `engines` package.json: на 22 проект собирается и проходит гейт, но CI и Capacitor сверяются с 24. Одна цифра во всех четырёх местах — `.nvmrc`, `engines`, этот README, `gate.yml`; расхождение считается дефектом (P1-2 в `todo.md`).

Тесты TypeScript запускаются через закреплённый `tsx`, поэтому не зависят от неявного Node loader.

```bash
npm ci
cp .env.example .env.local   # пусто = локальный режим, это рабочее состояние
npm run dev
```

## Проверки

```bash
npm run lint          # ESLint, падает на предупреждениях (подменять на echo запрещено, см. AGENTS.md)
npx tsc --noEmit      # типы
npm run test:rls      # политики RLS на настоящем PostgreSQL (PGlite, без Docker)
npm run build         # статический экспорт в out/
npm test              # Playwright по out/: mobile chromium + desktop
PW_WEBKIT=1 npm test  # плюс mobile safari (iPhone 13, WebKit) — как в CI;
                      # локально нужен: npx playwright install --with-deps webkit
```

## Сборка мобильных приложений (Capacitor)

Для внутреннего Android APK нужен JDK 21 (например, из Android Studio):

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npm run build
npx cap sync
cd android && ./gradlew assembleDebug && cp app/build/outputs/apk/debug/app-debug.apk ../SplitIT.apk && cd ..
```

Debug-подпись подходит только для sideload-тестирования и не подходит Google
Play. Для физического iPhone нельзя превращать unsigned `.app` в «IPA»:
нужны Apple Developer Team, provisioning profile и Archive/Export из Xcode
(Ad Hoc или TestFlight). Без них можно собрать только Simulator `.app`.

Тесты гоняются по собранному `out/`, а не по `next dev`: часть дефектов
существует только в статическом экспорте, то есть ровно в том, что уезжает
пользователю.

`npm run test:rls` поднимает PostgreSQL в WebAssembly, накатывает миграции из
`supabase/migrations/` и выполняет запросы от лица трёх разных пользователей —
проверяет, что данные одной группы не видны участникам другой.

## Структура

```
src/app/          экраны (App Router)
src/lib/
  store.ts        фасад данных: выбирает сетевой или локальный режим
  remote-store.ts работа с Supabase
  routes.ts       единая точка формирования ссылок
  env.ts          детект конфигурации, без плейсхолдерных дефолтов
supabase/migrations/  схема, RLS, многопользовательский режим
e2e/              Playwright
test/             харнесс PostgreSQL и проверки RLS
```

## Разработка

Правила, роли, инварианты и определение готовности находятся в
[AGENTS.md](AGENTS.md).

Текущее состояние и открытые дефекты — [bug_report.md](bug_report.md).
Передача между ролями — [handoff.md](handoff.md).
История проверок — [bug_reports/](bug_reports/).
