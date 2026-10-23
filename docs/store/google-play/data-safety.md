# Google Play — Data safety (по фактическому коду)

**Актуально на:** 2026-10-23; ветка release/1.0.2-closed-test, HEAD; точный SHA — RELEASE_CHECKLIST.md. Разработчик: **«Константа Лабс»** (Konstanta Labs).
Источник — код, а не намерения: у каждого пункта ссылка на файл. При изменении кода форму нужно пересмотреть.

## Короткие ответы для формы

| Вопрос Play Console | Ответ |
|---|---|
| Собирает ли приложение пользовательские данные? | **Да** |
| Передаёт ли данные третьим лицам (sharing)? | **Нет.** Supabase и Vercel — обработчики (service providers), это не «sharing» по определению Google |
| Шифруются ли данные при передаче? | **Да** — только HTTPS (`capacitor.config.json`: `androidScheme: https`, cleartext не разрешён) |
| Можно ли запросить удаление данных? | **Да** — в приложении «Профиль → Удалить аккаунт» и без приложения: **https://konstantalabs.ru/splitit-delete.html** |
| Реклама / рекламный ID | **Нет** (нет SDK рекламы и `AD_ID`) |
| Аналитика / crash-репорты | **Нет** (нет Firebase Analytics, Sentry и т.п. — поиск по `src`, `package.json`, gradle) |

## Собираемые данные

| Категория Google | Что именно | Обязательно? | Зачем | Где в коде |
|---|---|---|---|---|
| Personal info → **Email address** | email аккаунта; email в списке ожидания и (необязательно) в обратной связи / заявке на удаление | Да (аккаунт) | Аккаунт, связь с пользователем | `src/lib/supabase.ts` (signUp/signIn), `remote-store.ts` (`join_waitlist`, `submit_feedback`), `src/app/delete-account/page.tsx` |
| Personal info → **Name** | имя профиля; имена гостей, которых пользователь добавляет в событие | Да | Показ участникам события | `profiles.full_name`, `group_participants.display_name` |
| Personal info → **Phone number** | телефон в профиле — только если пользователь сам его ввёл | Нет | Показ участникам события | `src/app/profile/page.tsx`, `profiles.phone` |
| Personal info → **User IDs** | id аккаунта (всегда); Telegram id — только при входе через Telegram | Да (id аккаунта); Telegram id — нет | Аккаунт | `supabase/functions/telegram-auth/index.ts` |
| Photos and videos → **Photos** | аватар: фото уменьшается **на устройстве** до 256×256 JPEG ≤200 КБ и хранится в профиле (или выбирается эмодзи) | Нет | Аватар, виден участникам события | `src/lib/avatar.ts`, `profiles.avatar_url` (data URL, Storage не используется) |
| Financial info → **Other financial info** | названия и суммы расходов, доли, переводы между участниками (метка способа: СБП/карта/наличные) | Да (суть приложения) | Функциональность | таблицы `expenses`, `expense_splits`, `settlements` |
| App activity → **Other user-generated content** | названия событий, текст обратной связи | Нет | Функциональность, поддержка | `groups`, `feedback` |
| App info → **Other** (настройки) | валюта по умолчанию, флаг «обучение пройдено» | Да | Функциональность | `profiles.default_currency`, `profiles.has_completed_onboarding` |

Все перечисленные данные: **collected** (уходят на сервер Supabase), **not shared**, обработка **не эфемерная**, назначение — *App functionality* и *Account management* (email для обратной связи — *Developer communications*).

## Что НЕ собирается (данные не покидают устройство)

- **Контакты.** Разрешение `READ_CONTACTS` запрашивается только по нажатию «Контакты»; имена и телефоны читаются **локально** и сохраняются в `localStorage` (`src/app/friends/page.tsx`, `saveFriends` в `src/lib/supabase.ts`). Автоматически на сервер не отправляются.
  ⚠️ Если пользователь сам добавит друга из контактов в событие, **имя** этого человека уйдёт на сервер как имя гостя (`add_virtual_member`) — это учтено выше в «Name». Телефон гостя на сервер не передаётся.
- **Фото чека.** Распознавание (tesseract.js) выполняется на устройстве; фото никуда не загружается и нигде не хранится (`src/lib/ocr.ts`, загрузки нет). Модели распознавания скачиваются с публичного CDN без пользовательских данных.
- **Местоположение, микрофон, SMS, календарь** — не собираются; соответствующих разрешений в итоговом APK нет (список ниже).
- **Push-токены и ID установки** — в 1.0.2 push выключен флагом сборки (`NEXT_PUBLIC_PUSH_ENABLED` не равен `1`): приложение не запрашивает разрешение на уведомления, Firebase не инициализируется (`google-services.json` нет), push-токены и ID установки не создаются и не передаются. В форме **Device or other IDs — нет**. См. `src/lib/env.ts`, `src/lib/push-policy.ts`, `src/hooks/usePushNotifications.ts`.
  **При включении NEXT_PUBLIC_PUSH_ENABLED и добавлении google-services.json форму необходимо пересмотреть.**
- **Платёжные данные** — нет: приложение не проводит платежи.

## Сетевые запросы без пользовательских данных

Курсы валют (`open.er-api.com`, резерв `cbr-xml-daily.ru`), файл обновлений, скрипт виджета Telegram (только при входе через Telegram), модели tesseract — передаётся только стандартная информация запроса (IP, User-Agent).

## Удаление аккаунта и данных

- **В приложении:** «Профиль» → «Удалить аккаунт» → Edge Function `delete-account` → RPC `delete_my_account` (`supabase/migrations/20261009000000_delete_my_account.sql`, защита доступа удалённого аккаунта — `20261022000000_block_deleted_accounts.sql`) и удаление пользователя Auth. По записи RESEARCH.md §2 от 22.10: функция ACTIVE в production, миграция 20261022000000 применена, live-тест на синтетических аккаунтах прошёл. В этой сессии production не проверялся.
- **Без приложения (текущий URL для декларации):** https://konstantalabs.ru/splitit-delete.html — страница запроса удаления, HTTP 200 по проверке оркестратора 23.10. Запрос исполняется вручную в течение 30 дней (срок в политике конфиденциальности).
- https://www.splitit-apps.com/delete-account — станет доступен после выкладки веба 1.0.2; сейчас HTTP 404 по проверке оркестратора 23.10, не основной URL декларации.
- **Что остаётся:** в общих событиях расходы остаются под именем «Удалённый пользователь», чтобы не сломать итоги других участников (email, телефон, Telegram id, аватар удаляются; см. `/privacy`). Это нужно указать в форме как *data retained for legitimate reasons*.

## Открытые вопросы перед отправкой формы

1. Почтовый провайдер для писем Auth (SMTP задаётся в панели Supabase, в коде его нет) — указать в политике конфиденциальности как обработчика.
2. `android:allowBackup="true"` — локальные данные попадают в резервную копию Android; решить, оставлять ли.
3. Серверные логи Supabase/Vercel (IP) — вне кода приложения; Google относит их к собираемым данным только если они используются; проверить настройки хранения логов.

## Разрешения итоговой Android-сборки

Фактический список APK из `evidence/build-1ac4803/apk-permissions.txt`:

- `android.permission.INTERNET`
- `android.permission.READ_CONTACTS`
- `android.permission.ACCESS_NETWORK_STATE`
- `android.permission.POST_NOTIFICATIONS`
- `android.permission.WAKE_LOCK`
- `com.google.android.c2dm.permission.RECEIVE`
- `app.splitit.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

Последние пять разрешений добавляют зависимости плагина push / AndroidX. Наличие разрешений в APK не означает их запрос приложением: в 1.0.2 настройка push выключена флагом сборки (см. выше). Список получен для APK 1ac4803 и совпадает для 8fb4666; повторную сборку и её проверку выполняет оркестратор. Android-файлы в r2 не менялись.
