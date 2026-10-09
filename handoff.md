# Handoff — SplitIT

**Актуально на:** 2026-10-09 @ `bce03b6`, ветка `launch/international`, **плюс незакоммиченные изменения цикла «Launch hardening 1»**
**Роль, сдающая работу:** оркестратор цикла (Claude Code + ECC-агенты) → владелец / следующий Maker
**Предыдущий handoff:** `docs/archive/handoff-2026-08-15.md` (исторический, SHA `0719bcd`)

> **Почему нет коммитов.** В этом клоне не настроены `git user.name` / `user.email`, а подставлять
> подпись владельца за него агенту запрещено. Все изменения лежат в рабочем дереве и
> разложены на семь патчей — T1–T5, `t6` и `t7` (продолжения T4), чтобы получились раздельные коммиты.
> Как их закоммитить — в `docs/reports/2026-10-ecc-cycle1.md`, раздел «Что нужно от владельца».
> После коммитов SHA в шапке этого файла и `todo.md` нужно обновить.

---

## 1. Что сделано в ветке `launch/international` после `main` @ `b828611`

| SHA | Что | Где проверить |
|---|---|---|
| `3dd3174`, `ad87eaf` | Точка отката `baseline-2026-09-25`, план международного запуска | `docs/ROLLBACK.md`, `docs/LAUNCH_PLAN_2026-09.md` |
| `dedea13` | SECURITY DEFINER закрыты от `anon`, `search_path` закреплён, rate limit на `join_waitlist`/`submit_feedback` | `supabase/migrations/20260925000000_*`, `test/launch-hardening-rls.test.mjs` |
| `bce03b6` | «Подвести итог и закрыть событие» (расходы блокируются триггером), кнопка «Напомнить» | `supabase/migrations/20260925000001_*`, `e2e/close-event.spec.ts` |
| *(не закоммичено)* T1 | Экран расхода показывает ошибку вместо вечной загрузки; диагностика флейка | `bug_report.md` (круг 2026-10-09) |
| *(не закоммичено)* T2 | Удаление аккаунта: экран, RPC, Edge Function, `/delete-account`, 10 языков | `todo.md` P1-9 |
| *(не закоммичено)* T3 | `npm run lint:i18n` + шаг в CI; 17 расхождений переводов исправлено | `scripts/check-i18n.mjs` |
| *(не закоммичено)* T4 + t6 + t7 | `react-hooks/set-state-in-effect` → `"error"`; 5 из 7 мест переписаны, 2 исключения до 2026-11-15 | `eslint.config.mjs`, `todo.md` P1-6, `e2e/local-state.spec.ts`, `e2e/telegram-webapp.spec.ts` |
| *(не закоммичено)* T5 | Этот файл, `todo.md`, отчёт цикла | `docs/reports/2026-10-ecc-cycle1.md` |

## 2. Что я запускал сам (Node 22, Chromium; дерево = `bce03b6` + изменения цикла)

```
npm run lint                         exit 0, 0 warnings
npm run lint:i18n                    10 локалей × 463 ключа — расхождений нет
npx tsc --noEmit                     exit 0
npm run test:unit                    75/75
npm run test:rls                     126/126   (было 105 до T2)
npm test -- --fail-on-flaky-tests    132 passed (mobile chromium + desktop)
playwright auth+integrity --repeat-each=20 --fail-on-flaky-tests   960 passed
```

## 3. Что НЕ запускалось — и что из этого следует

| Не запускал | Почему | Следствие |
|---|---|---|
| GitHub Actions | нет коммитов и `gh` в этой сессии | P0-1 и P1-7 закрываются только зелёным run |
| WebKit (`mobile safari`) | нет системных библиотек локально | проверяется только в CI |
| Миграции на Supabase, деплой Edge Function `delete-account` | запрещено заданием цикла | удаление аккаунта работает только в коде и в PGlite; в production его **нет** |
| `verify:prod`, `canary` | нужны боевые ключи | состояние прода не перепроверялось |

## 4. Открытые риски (подробно — в отчёте цикла)

- Флейки CI `auth.spec.ts:77` и `integrity.spec.ts:125` локально не воспроизводятся; причина в CI не подтверждена.
- Удаление аккаунта: сетевой путь (Edge Function → RPC → `auth.users`) не проверен живьём; нужен staging.
- Перед любыми production-миграциями — Supabase Pro и бэкап (P0-5).

## 5. Следующие шаги по порядку

1. Владелец настраивает git-подпись и коммитит семь патчей (инструкция в отчёте), затем `git push origin launch/international` — дождаться зелёного `gate`.
2. P0-5 → P0-4: бэкап, затем три ожидающие миграции.
3. Деплой `delete-account`, проверка на staging живым тестовым аккаунтом.
4. P1-10 (Brevo DNS), P1-13 (privacy EN), затем P1-12 (Google Play closed test).
