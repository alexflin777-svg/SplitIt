# Точка отката — 25.09.2026

Всё, что делается для международного запуска, идёт в ветке `launch/international`.
`main` и прод остаются нетронутыми, пока владелец явно не одобрит слияние.

| Слой | Состояние на момент отката | Как вернуть |
|---|---|---|
| Код | тег `baseline-2026-09-25` → `b828611` (= `main`) | `git switch main && git reset --hard baseline-2026-09-25` (только с согласия владельца) или просто не мержить ветку |
| Незакоммиченные правки на сервере | `~/secure/splitit/uncommitted-2026-09-25.patch` (AGENTS.md, next-env.d.ts, package-lock.json) | `git apply <patch>` |
| Vercel (prod) | деплой `split-kyy2hxz97-alex-flin777.vercel.app`, домен `www.splitit-apps.com` | `vercel rollback split-kyy2hxz97-alex-flin777.vercel.app` или Promote в дашборде |
| Supabase | 12 миграций до `20260910150000_feedback`; логический снимок данных, функций, политик и грантов: `~/secure/splitit/backups/supabase-baseline-2026-09-25.json.gz` (0600). PITR выключен, платформенных бэкапов в API нет | новые миграции пишутся с парной `down`-миграцией; данные восстанавливаются из снимка |
| Android | vc 2 / 1.0.0, AAB `/tmp/SplitIT-1.0.0-vc2-release-v2.aab` | следующий релиз — только vc ≥ 3 |
| Supabase Auth config | site_url=split-it-ere9.vercel.app, autoconfirm=on, HIBP=off, captcha=off | значения записаны здесь; вернуть через Management API или дашборд |

Правило: ни одна миграция не применяется к прод-базе без свежего снимка и down-скрипта.
