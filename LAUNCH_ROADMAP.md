# Дорожная карта запуска — SplitIT

**Обновлена:** 2026-08-06
**Актуальный рабочий backlog:** [`todo.md`](todo.md). Этот документ описывает только последовательность решений; он не заменяет доказательства из `bug_report.md`.

## Принцип запуска

Сначала доказываем один безопасный пользовательский сценарий в web-версии, затем проверяем его людьми на реальных устройствах, и только после этого начинаем Store-подготовку. Нельзя использовать старые APK/IPA, simulator build или прошлые отчёты как доказательство готовности физического устройства.

```mermaid
flowchart LR
  A[Воспроизводимый локальный и CI гейт] --> B[Auth и production DB готовы]
  B --> C[Web beta candidate]
  C --> D[Human test на реальных устройствах]
  D --> E[Решение по Android internal / iOS TestFlight]
  E --> F[Store release]
```

## Этап 0 — восстановить достоверный гейт

**Цель:** у команды есть один воспроизводимый способ проверить кандидат, а не противоречивые исторические результаты.

- Выбрать и закрепить Node ≥22 для локальной среды, CI и Capacitor; текущий Node 20.17.0 не исполняет `.ts` imports в тестах и несовместим с Capacitor CLI v8.
- Исправить/явно настроить test runner для `.mjs` → `.ts` imports; `npm ci`, unit, RLS и Playwright должны выполняться с нуля.
- Отделить текущие незакоммиченные UI-изменения от новых задач; не смешивать их с миграциями и не коммитить без проверки.
- Запустить на чистом окружении: lint → types → unit → RLS → build → E2E.

**Выход:** свежий лог полного гейта, commit SHA, независимое Checker-review.

## Этап 1 — разблокировать закрытую web beta

**Цель:** ссылка на web-кандидат безопасна для 15–30 добровольных тестировщиков.

1. Владелец настраивает Supabase Auth URL Configuration и принимает решение о подтверждении email/SMTP.
2. Перед production-миграцией `group_participants` создаётся точка восстановления и выполняется legacy preflight.
3. Миграция применяется штатным способом; после неё запускаются безопасные `verify:prod`, `verify:realtime`, canary и проверяется cleanup.
4. UX-проверка собранного `out/` на 375×812, 390×844, 412×915 и 1280×720 закрывает safe-area, BottomNav, favicon и ошибочные success-состояния.
5. Зелёный commit деплоится; фиксируются URL, SHA, время, rollback-версия и ссылка на CI.

**Необходимое решение владельца:** если production Supabase/migration не готовы, beta не маскируется под сетевую. Допустим только явно обозначенный локальный режим с его ограничениями.

## Этап 2 — тестирование людьми на реальных устройствах

**Цель:** проверить понятность и надёжность полного сценария с двумя людьми, а не только emulator/автотесты.

- **Web/PWA:** Android Chrome и iPhone Safari обязательны; для iOS этого достаточно до решения о TestFlight.
- **Android internal:** возможен после сборки актуального production `out/`, `cap sync`, checksum и явной маркировки internal/debug. Store signing не является условием web beta.
- **iOS native:** только TestFlight/Ad Hoc с валидной подписью и provisioning profile. Simulator и unsigned IPA не принимаются.
- **Чартер и критерии:** в P1-5 `todo.md`; результаты, девайс/ОС, build SHA и дефекты фиксируются в `bug_report.md`.

**Выход:** все S1/S2 устранены или явно приняты владельцем, повторный гейт зелёный, есть таблица фактических device results.

## Этап 3 — Store release (только после успешной beta)

### Android

- release upload key хранится вне git;
- сборка подписанного AAB из подтверждённого SHA;
- Play Console Internal Testing и установка на физический Android;
- privacy policy, Data safety, store screenshots и метаданные.

### iOS

- Apple Developer Program, App ID `app.splitit.mobile`, distribution certificate и provisioning profile;
- Xcode archive c production web payload и TestFlight;
- установка на физический iPhone;
- privacy policy, App Store screenshots/metadata и App Review requirements.

## После beta

- Вторая фаза `expense_splits.group_id` / Realtime с новой миграцией и нагрузочными тестами.
- Устойчивое offline-поведение и тесты разрыва сети.
- Экспорт PDF, avatar upload, OTA update channel — только с отдельными критериями отказа/отката.
- Telegram WebApp — только после server-side проверки `initData`.

## Стоп-условия

Не переходить к следующему этапу, если:

- тесты зелёны только в CI, но не воспроизводятся локально на заявленном Node;
- нет свежей независимой проверки миграции/RLS;
- Auth reset/registration не проверены на production;
- UI не проверен на обязательных мобильных размерах;
- нет воспроизводимого артефакта и способа отката;
- найден S1/S2 без письменного решения владельца.
