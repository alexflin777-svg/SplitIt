# SplitIT — Отчёт о готовности к релизу в Google Play и App Store

**Дата:** 2026-08-06  
**Ветка:** main (HEAD: 220a95b)  
**Репозиторий:** github.com/alexflin777-svg/SplitIt  
**Production URL:** https://split-it-ere9.vercel.app  
**Supabase проект:** jrarbbfsqrkjckujfpcz

---

## 📊 Executive Summary

| Категория | Статус | Комментарий |
|-----------|--------|-------------|
| **Бизнес-логика / расчёты** | ✅ **Готово** | 54 unit-тестов, покрываются инварианты долгов, валют, OCR, реалистичные сценарии |
| **RLS / безопасность БД** | ✅ **Готово** | 84/84 тестов на PostgreSQL (PGlite), deny-by-default, atomic RPC, изоляция групп |
| **E2E / UI тесты** | ✅ **Готово** | 92/92 Playwright тестов (mobile + desktop), 16 статических маршрутов |
| **Production Canary** | ✅ **Готово** | 18/18 проверок на боевом адресе |
| **Live Supabase (GoTrue, PostgREST, Realtime)** | ✅ **Подтверждено** | verify:prod 24/24, verify:realtime 25/25 |
| **Веб-версия (PWA)** | ✅ **Развёрнута** | Работает на Vercel, сетевой режим включён |
| **Android (APK/AAB)** | ❌ **Требует пересборки** | Debug-ключ, нет release keystore, APK есть но не для Play |
| **iOS (IPA)** | ❌ **Требует пересборки** | Нет подписи/профиля, не устанавливается на физический iPhone |
| **Supabase Auth настройка** | ⚠️ **Частично** | Site URL / Redirect URLs не настроены, email confirmation — решение владельца |
| **GitHub Actions (CI)** | ⚠️ **Не запускался** | Workflows есть, но push прав нет — нужен первый зелёный прогон |

**Общий вердикт:** **Веб-версия готова к закрытой бете. Мобильные сборки требуют 2-3 дней работы для Store-ready артефактов.**

---

## ✅ Что работает (подтверждено доказательствами)

### 1. Локальный гейт (все зелёные)
```
npm run lint                    ✅ 0 warnings/errors
npx tsc --noEmit                ✅ 0 errors
npm run test:unit               ✅ 54/54 passed
npm run test:rls                ✅ 84/84 passed (на PostgreSQL via PGlite)
npm run build                   ✅ 16 static pages
npm test (Playwright)           ✅ 92/92 mobile + desktop
npm run canary                  ✅ 18/18 на https://split-it-ere9.vercel.app
```

### 2. Live проверки на боевом Supabase
- **verify:prod** — 24/24: регистрация, GoTrue, PostgREST, RPC, RLS, приглашения, потеря доступа
- **verify:realtime** — 25/25: доставка за 202мс, изоляция групп, отписка работает
- **Canary** — читает прод снаружи: маршруты, чанки, GoTrue, таблицы, RPC закрыты для анонима

### 3. Архитектурные инварианты соблюдены
- `output: 'export'` — статический экспорт, работает в APK/IPA
- Query-string маршрутизация — любой event id открывается
- RLS deny-by-default — каждая политика с USING + WITH CHECK
- Деньги: только положительные, курс не округляется, итог округляется
- Нет silent catch, нет симуляции успеха, нет плейсхолдеров в сборке

### 4. Реалистичные сценарии пройдены
- Автопутешествие 4 человека, 260 000 ₽ → 2 перевода (52 200 ₽, 6 800 ₽)
- Выпускной 10 человек, 500 000 ₽ → 9 переводов
- Изоляция групп: RLS отклоняет перекрёстные попытки

---

## ❌ Блокируют релиз в Store (Critical)

### MOB-1: Мобильные артефакты не в репозитории
- `.gitignore` исключает `*.apk` и `*.ipa`
- Артефакты существуют только локально у сборщика
- **Нужно:** CI/CD для сборки артефактов или документация как получать

### MOB-2: iOS IPA не подписан для физического устройства
- `SplitIT-iPhone-PhysicalDevice.ipa` — без code signature и provisioning profile
- Не устанавливается на iPhone 13
- **Нужно:** Apple Developer Account, signing identity, provisioning profile

### MOB-3: iOS Simulator build передан как physical
- `SplitIT-iPhone13.ipa` — это `iphonesimulator` build с вложенным `App.app/App.app`
- Нарушена ad-hoc подпись, нет production конфигурации
- **Нужно:** Пересобрать как `iphoneos` archive

### MOB-4: Android подписан debug-ключом
- `SplitIT-production.apk` подписан `CN=Android Debug`
- Для Google Play нужен **upload key** (release keystore)
- **Нужно:** Сгенерировать release keystore, подписать AAB

---

## ⚠️ Требуют решения перед бета (High)

### 1. Supabase Auth → URL Configuration
- **Site URL:** `https://split-it-ere9.vercel.app`
- **Redirect URLs:** добавить `https://split-it-ere9.vercel.app/auth`
- Без этого сброс пароля ведёт на localhost

### 2. Подтверждение email (решение владельца)
- Если включено + SMTP не настроен → тестировщики не войдут после регистрации
- **Варианты:** выключить на время беты, либо настроить SMTP (SendGrid, Resend и т.д.)

### 3. GitHub Actions — первый зелёный прогон
- Workflows `.github/workflows/gate.yml` и `canary.yml` готовы
- Нет прав на push → workflow никогда не запускался
- **Нужно:** Настроить deploy key / PAT с правами push, или дать доступ владельцу

### 4. CHK-1: `/favicon.ico` 404
- `public/` пуст, иконки в `metadata` нет
- **Фикс:** добавить `src/app/icon.svg` (Next сам выпустит тег)

### 5. CHK-2: Кнопка «Создать событие» под BottomNav на 375×812
- Перекрытие 33.5 px, после скролла доступна
- Компоновка первого экрана — решение UX (Gemini)

---

## 📋 План доработки до Store Release

### Фаза 0: Разблокировка бета (1-2 дня) — **Критический путь**

| Задача | Исполнитель | Время | Доказательство |
|--------|-------------|-------|----------------|
| Настроить Supabase Auth URL Configuration | Владелец / Gemini | 15 мин | Сброс пароля работает |
| Решить про email confirmation | Владелец | 5 мин | Решение зафиксировано |
| Настроить GitHub push rights / PAT | Владелец | 10 мин | Зелёный gate.yml на GitHub |
| Запустить gate.yml на GitHub (push) | Владелец / CI | 10 мин | GitHub Actions green |
| Исправить CHK-1 (favicon) | Gemini | 30 мин | Нет 404 в консоли |
| Исправить CHK-2 (кнопка под навбаром) | Gemini | 1-2 ч | Скриншот 375×812 без перекрытия |

### Фаза 1: Android Release Build (1-2 дня)

| Задача | Детали | Доказательство |
|--------|--------|----------------|
| Сгенерировать release keystore | `keytool -genkey -v -keystore splitit-release.keystore -alias splitit -keyalg RSA -keysize 2048 -validity 10000` | Файл keystore |
| Настроить `android/app/build.gradle` signingConfig | release { signingConfig signingConfigs.release } | gradle signingReport |
| Собрать AAB: `cd android && ./gradlew bundleRelease` | `app/build/outputs/bundle/release/app-release.aab` | AAB файл |
| Проверить AAB: `bundletool` / загрузить в Play Console Internal Testing | Устанавливается на тестовый девайс | Play Console accepted |

### Фаза 2: iOS Release Build (2-3 дня) — **Требует macOS + Xcode**

| Задача | Детали | Доказательство |
|--------|--------|----------------|
| Apple Developer Program ($99/год) | Привязать к Apple ID | Membership active |
| Создать App ID в Developer Console | `app.splitit.mobile` | App ID registered |
| Создать Provisioning Profile (Ad Hoc / App Store) | Для тестов — Ad Hoc, для Store — App Store | .mobileprovision файл |
| Настроить Signing в Xcode | Team, Profile, Certificate | Archive -> Distribute |
| Собрать IPA: `xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -archivePath build/SplitIT.xcarchive archive` | `build/SplitIT.xcarchive` | Archive создан |
| Экспорт IPA для TestFlight / Ad Hoc | `xcodebuild -exportArchive` | IPA устанавливается на iPhone |

### Фаза 3: Store Submission (1-2 недели календарно)

#### Google Play
| Артефакт | Требование |
|----------|------------|
| Подписанный AAB | `app-release.aab` |
| Privacy Policy URL | Обязательно (Supabase хранит email, phone, траты) |
| Скриншоты: телефон (минимум 2), 7-дюймовый планшет (минимум 1) | 375×812, 1080×1920 |
| Feature graphic (1024×500) | Для карточки приложения |
| Описание, короткое описание | RU/EN |
| Категория: Finance / Tools | |
| Возрастной рейтинг | Заполнить анкету IARC |

#### App Store (App Store Connect)
| Артефакт | Требование |
|----------|------------|
| Подписанный IPA (App Store profile) | Через Transporter / Xcode |
| Privacy Policy URL | То же |
| Скриншоты: 6.7" (iPhone 14/15 Pro Max), 5.5", 12.9" iPad | Обязательные размеры |
| App Preview видео (опционально) | |
| Описание, keywords (100 chars), promotional text | RU/EN |
| Категория: Finance / Productivity | |
| Age Rating | Заполнить анкету |
| **Review Guidelines compliance** | 5.1.1 (Privacy), 5.1.2 (Data Use), 3.1.1 (Payments — не используется) |

### Фаза 4: Пост-релиз инфраструктура

| Задача | Приоритет |
|--------|-----------|
| Канал обновлений (`NEXT_PUBLIC_UPDATE_MANIFEST_URL`) | High — для OTA в Capacitor |
| Supabase leaked-password protection | Medium — Security Advisor |
| `expense_splits.group_id` денормализация | Medium — Realtime оптимизация |
| Push notifications (FCM / APNs) | Low — v2 |
| Telegram WebApp (initData validation) | Low — v2 |

---

## 📁 Необходимые файлы для Store

### Android (в репозитории)
```
android/
├── app/
│   ├── build.gradle              ✅ есть
│   ├── proguard-rules.pro        ✅ есть
│   └── src/main/
│       ├── AndroidManifest.xml   ✅ есть
│       └── res/                  ✅ есть (иконки, сплэш)
├── keystore/
│   └── splitit-release.keystore  ❌ НУЖНО СОЗДАТЬ (НЕ КОММИТИТЬ!)
├── key.properties                ❌ НУЖНО СОЗДАТЬ (НЕ КОММИТИТЬ!)
└── google-services.json          ⚠️ только если Push (НЕ КОММИТИТЬ!)
```

### iOS (в репозитории)
```
ios/App/
├── App.xcodeproj/                ✅ есть
├── App/
│   ├── Info.plist                ✅ есть
│   ├── Assets.xcassets/          ✅ есть (AppIcon, Splash)
│   └── App.entitlements          ❌ НУЖНО для Push/Keychain
├── Podfile                       ✅ есть
└── App.xcworkspace               ✅ есть
```

---

## 🔐 Секреты / Переменные окружения (НЕ в репозиторий)

### Vercel (Settings → Environment Variables)
```
NEXT_PUBLIC_SUPABASE_URL=https://jrarbbfsqrkjckujfpcz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
# NEXT_PUBLIC_APP_URL — авто из VERCEL_PROJECT_PRODUCTION_URL
# NEXT_PUBLIC_UPDATE_MANIFEST_URL — когда будет канал обновлений
```

### GitHub Actions Secrets (Settings → Secrets → Actions)
```
VERCEL_TOKEN                    # для vercel CLI если нужен
VERCEL_ORG_ID
VERCEL_PROJECT_ID
SUPABASE_SERVICE_ROLE_KEY       # для verify:prod / verify:realtime в CI
SUPABASE_PROJECT_REF=jrarbbfsqrkjckujfpcz
```

### Локально (.env.local — НЕ коммитить)
```
NEXT_PUBLIC_SUPABASE_URL=https://jrarbbfsqrkjckujfpcz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
NEXT_PUBLIC_APP_URL=https://split-it-ere9.vercel.app
```

---

## 📋 Чек-лист готовности к Store Release

### Android (Google Play)
- [ ] Release keystore создан и сохранён в надёжном месте
- [ ] `key.properties` настроен (не в git)
- [ ] `build.gradle` signingConfig для release
- [ ] `./gradlew bundleRelease` успешен
- [ ] AAB загружен в Play Console Internal Testing
- [ ] Тестировщики установили, всё работает
- [ ] Privacy Policy опубликован (URL в Play Console)
- [ ] Скриншоты, feature graphic, описания загружены
- [ ] Возрастной рейтинг заполнен
- [ ] Приложение отправлено на ревью

### iOS (App Store)
- [ ] Apple Developer Program оплачен
- [ ] App ID создан: `app.splitit.mobile`
- [ ] Provisioning Profile: App Store distribution
- [ ] Distribution Certificate создан
- [ ] Xcode Archive успешен (Generic iOS Device)
- [ ] IPA экспортирован для App Store
- [ ] Загружен через Transporter / Xcode в App Store Connect
- [ ] Privacy Policy URL в App Store Connect
- [ ] Скриншоты всех обязательных размеров загружены
- [ ] Описание, keywords, promotional text заполнены
- [ ] Age Rating заполнен
- [ ] Приложение отправлено на ревью

---

## 💰 Оценка ресурсов

| Ресурс | Стоимость | Время |
|--------|-----------|-------|
| Apple Developer Program | $99/год | 1 день на одобрение |
| Google Play Console | $25 (разово) | Мгновенно |
| Время разработчика (Android build) | — | 4-8 часов |
| Время разработчика (iOS build + certificates) | — | 8-16 часов (нужен macOS) |
| Дизайн скриншотов / feature graphic | — | 4-8 часов |
| Privacy Policy (юридический) | $0-500 | 1-3 дня |

**Итого к релизу:** ~$124 + 2-3 недели календарного времени (больше всего — App Store review 2-7 дней + подготовка iOS билда)

---

## 🎯 Следующие шаги (Action Items)

1. **Сегодня:** Владелец настраивает Supabase Auth URLs + решает про email confirmation
2. **Сегодня:** Владелец даёт push-права в GitHub / создаёт PAT для CI
3. **Завтра:** Запуск gate.yml на GitHub → зелёный CI
4. **Параллельно:** Gemini фиксит CHK-1, CHK-2 (favicon, кнопка)
5. **Дни 2-3:** Android release keystore + AAB сборка + Internal Testing
6. **Дни 3-5:** iOS: Apple Developer enrollment, certificates, provisioning, Archive
7. **Неделя 2:** Store submissions + Privacy Policy + скриншоты
8. **Неделя 2-3:** App Store / Google Play review → Published

---

## 📝 Примечания

- **Веб-версия уже готова к закрытой бете** — можно раздавать ссылку https://split-it-ere9.vercel.app 15-30 тестировщикам прямо сейчас
- **Мобильные сборки нужны только для Store** — для беты веб-версия достаточно (PWA работает offline-first, иконка на рабочий стол ставится)
- **Capacitor плагины:** `@capacitor/android`, `@capacitor/ios`, `@capacitor/core` v8.4.2 — актуальные
- **Node.js warning:** Supabase JS предупреждает про Node 20 deprecation — обновить до Node 22+ в CI и локально когда будет время
- **Next.js 14.2.16** — есть security advisory, обновить на следующем мажорном цикле