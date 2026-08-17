# SplitIt — Architectural Audit Report

**Date:** 2026-08-17
**Scope:** Next.js 16 + Supabase (Postgres/RLS) expense-splitting app, statically exported (`output: 'export'`) and wrapped in Capacitor for Android/iOS.
**Focus:** scalability, Google Auth integration, English-first UX.
**Method:** full read of `src/lib`, `src/app`, all Supabase migrations, Android/Capacitor config, and targeted greps across the tree (~12k LOC).

## TL;DR

The app was built **Russian-first** and later had an English-default i18n layer bolted on top of the UI strings only. The data/service layer (`store.ts`, `remote-store.ts`, `supabase.ts`, `credentials.ts`, `currency.ts`, `pdf-generator.ts`, `avatar.ts`, `ocr.ts`, `app-updater.ts`, `env.ts`, `routes.ts` — 29 of ~54 source files, 796 lines) still returns **hardcoded Russian strings as user-facing error/status messages**, which UI code renders verbatim regardless of the selected locale. This is the single biggest gap against an "English-first" (or any multi-locale) product goal, and it's more severe than the visible i18n coverage suggests.

Separately, **Google Sign-In is implemented only as a web OAuth redirect**, with no platform branching for the Capacitor native shell, no deep-link intent-filter, and no native SDK. On real Android/iOS builds this is likely to fail outright (Google blocks embedded-WebView sign-in) or get the app flagged by Google's OAuth policy review.

On scalability, the architecture is a reasonable MVP shape (100% client-rendered SPA behind a static export, Supabase RLS as the real security boundary) but has no pagination, no caching layer, and fetches entire nested group/expense/settlement trees on every list view — fine at demo scale, will degrade hard as groups and expense history grow.

None of this is unusual for an early-stage app that grew from a single-market (Russian) MVP — the issues below are exactly the kind of debt you'd expect, and the RLS/security hardening migrations show real engineering discipline elsewhere. The plan below sequences fixes by blast radius.

---

## 1. Scalability

### 1.1 CRITICAL — `GROUP_SELECT` fetches full nested expense/split/settlement history for list views
`src/lib/remote-store.ts:105-115,174-184`, consumed by `src/app/page.tsx:84-88`

`fetchGroups()` (used to paint the dashboard's group summary cards — name, total, member/expense count) reuses the exact same deep-nested `select()` as `fetchGroup()` (the full detail view). There's no lightweight "summary" query and no server-side aggregation (e.g. a Postgres view or RPC returning `SUM(amount)`/`COUNT(*)` per group). At 50 groups × 500 expenses, the dashboard pulls tens of thousands of nested rows to render a list of cards.

**Fix:** Add a `group_summaries` view or RPC (`select group_id, name, total, member_count, expense_count`) for list screens; keep the full nested query only for the single-group detail view.

### 1.2 CRITICAL — Full-group resync on every realtime event, including unscoped subscriptions
`src/lib/remote-store.ts:429-448`, `src/app/events/detail/EventDetailClient.tsx:141-145`

`subscribeToGroup` re-runs the entire `loadGroup()` (§1.1's heavy query) on **any** change to `expenses`, `expense_splits`, `settlements`, or `group_members`. The `expense_splits` subscription has no group filter at all — every client subscribed to any group receives every split-table change in the database and re-triggers its own full refetch to decide if it's relevant. At even moderate write frequency in one active group, this is O(edits × subscribed clients) redundant full-tree fetches.

**Fix:** Filter the realtime channel by `group_id` where the schema allows it (join `expense_splits`→`expenses.group_id` via a Postgres publication filter or a `group_id` denormalized column), and apply targeted patches to local state instead of a full refetch per event.

### 1.3 CRITICAL — Unbounded, unpaginated, unvirtualized expense list
`src/app/events/detail/EventDetailClient.tsx:667-749`

Every expense a group has ever had is fetched (§1.1) and rendered as a full DOM card, with a per-item `Array.find` over members (lines 674-675) and no `useMemo`. No windowing/virtualization. A group with 1,000+ expenses over its lifetime renders 1,000+ full cards on every load.

**Fix:** Paginate/cursor the expense query (`.range()`/`.limit()` — currently used nowhere in the data layer at all) and virtualize the list once group history grows past a few hundred items.

### 1.4 HIGH — No caching layer; every navigation refetches from scratch
No SWR, React Query, or Next.js fetch caching anywhere (`grep -r "useSWR\|react-query\|@tanstack"` → zero hits). Every screen does its own `useEffect` fetch, re-running on mount, window focus, and custom `splitit_profile_changed` events (`src/app/page.tsx:90-122`) with no dedup or stale-time window. Repeated tab-switching re-runs the full §1.1 query each time.

**Fix:** Introduce a thin cache/dedup layer (SWR or React Query) in front of `remote-store.ts` calls before adding more screens that share the same data.

### 1.5 HIGH — 100% client-rendered SPA
21 files use `"use client"`; there is exactly one Supabase client (`src/lib/supabase.ts:10-14`, browser-only `createClient`), no server components, no server actions, no RSC data loading. This is a direct consequence of `output: 'export'` (needed for the Capacitor static bundle) but it means every page ships blank, then fetches, then renders — worst-case on the low-end/slow-network mobile devices this app actually targets.

**Fix:** This is a structural trade-off tied to Capacitor packaging, not a quick fix — see §4 (Refactoring Plan) for a phased approach (keep static export for the mobile shell, consider a separately-deployed server-rendered web build for non-Capacitor traffic if/when a marketing or web-first surface is needed).

### 1.6 MEDIUM — Unmemoized aggregation on every render
`src/app/page.tsx:152-156` (`totalSpent`, `flatMap` + `convertCurrency` per group, recomputed on every keystroke in unrelated state), `EventDetailClient.tsx:173-185,155-158` (`categoryTotals`, `totalExpenses`), `EventBalanceClient.tsx:105` (debt-simplification called inline in render body). All fine at current data volumes; all will show up in profiling once expense counts grow.

**Fix:** Wrap in `useMemo` keyed on the actual dependency (expenses array, not component render).

### 1.7 MEDIUM — Newest RPC breaks the established security-hardening pattern
`supabase/migrations/20260816210725_add_virtual_member_rpc.sql:4-6` vs. the discipline established in `20260801000001_harden_function_privileges.sql`

Every other privileged function is `SECURITY DEFINER` with an explicit `SET search_path`, lives in a non-public `private` schema, and has explicit `REVOKE`/`GRANT`. `add_virtual_member_rpc` has none of this — it's not exploitable today, but it's a regression in the pattern and sets a bad precedent as more RPCs get added under time pressure.

**Fix:** Add a migration lint/checklist (or a CI test asserting `search_path` is set and grants are explicit for every `SECURITY DEFINER` function) so this can't silently drift again — `test/rls.test.mjs` already exists as a place to extend this.

### 1.8 LOW — Friends list is local-only, never synced through Supabase
`src/app/friends/page.tsx:5,59`, backed by `localStorage` in `src/lib/supabase.ts:107-124`. Bounded by one device's data and the ~5MB localStorage quota; friends don't survive a device change or reinstall. Not a Postgres-scale risk, but a real product gap once "Add friend" needs to work across devices.

### 1.9 What's actually solid
RLS policies use `STABLE SECURITY DEFINER` helper functions (`is_group_member`/`is_group_owner`) with indexed lookups, and `auth.uid()` is correctly wrapped in `(SELECT auth.uid())` to get it evaluated once per query rather than once per row (`supabase/migrations/20260801000001_harden_function_privileges.sql`). The debt-simplification algorithm (`src/lib/debt-simplification.ts:21-73`) is a clean O(n log n) greedy min-cash-flow algorithm keyed on member count, not expense count — it will not itself become a bottleneck at realistic group sizes. This is good bones to build the fixes above on top of.

---

## 2. Google Auth Integration

### 2.1 CRITICAL — Web OAuth redirect used unmodified inside the Capacitor native WebView
`src/lib/supabase.ts:332-344`

```ts
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  ...
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
```

There is no `Capacitor.isNativePlatform()` branch anywhere in the auth code (the only native-platform check in the whole app is for contacts import, `src/app/friends/page.tsx:20-21`). `package.json` has no `@capacitor/browser` and no native Google Sign-In plugin. Since the app ships as a static export inside an embedded WebView (`androidScheme: "https"`), the Google consent screen will load **inside the embedded WebView** — Google actively blocks and returns `disallowed_useragent` for OAuth sign-in from embedded WebViews. On real devices this flow either fails outright or violates Google's OAuth app-verification policy, risking API/app rejection.

### 2.2 CRITICAL — No deep-link handling for the OAuth callback on native
`android/app/src/main/AndroidManifest.xml` — the only `<intent-filter>` present is `MAIN`/`LAUNCHER`. There is no `VIEW` intent-filter with a custom scheme or app-link host to catch the OAuth redirect back into the app. The Android/Gradle changes currently in the working tree only wire up `@capacitor-community/contacts` (a `READ_CONTACTS` permission) — unrelated to auth. Even if a system browser were used instead of the WebView, there is currently no way to route the redirect back into the app; the user would be stranded in the browser after granting consent.

**Fix for 2.1/2.2:** Use a native Google Sign-In flow for Capacitor builds (`@capacitor-community/generic-oauth2` or the platform's native Google Sign-In SDK bridged via a Capacitor plugin) that returns an ID token, then call `supabase.auth.signInWithIdToken({ provider: 'google', token })` — this avoids the WebView/browser redirect problem entirely on native. Keep `signInWithOAuth` + browser redirect only for the web build. Branch on `Capacitor.isNativePlatform()` in `signInWithGoogle()`.

### 2.3 HIGH — Implicit flow, not PKCE
`src/lib/supabase.ts:10-14` sets no `flowType: 'pkce'`, and `src/app/auth/callback/page.tsx:18` confirms via its own comment: `// Wait for supabase to parse the URL hash (implicit flow)`. Tokens arrive in the URL fragment, which is weaker (browser history/extension exposure) and less reliable across WebView navigations than a PKCE code exchange.

**Fix:** Set `flowType: 'pkce'` on the Supabase client and switch the callback handler to `exchangeCodeForSession`.

### 2.4 HIGH — Fragile callback with a single blind retry
`src/app/auth/callback/page.tsx:32-43` — if `getSession()` returns nothing immediately, there's exactly one `setTimeout(1500)` retry, then a generic failure message, with no `onAuthStateChange` listener and no differentiation between cancellation, expired code, network failure, or provider outage.

**Fix:** Replace the timeout-based poll with an `onAuthStateChange` subscription that resolves the callback page's state on `SIGNED_IN`, with a bounded timeout only as a fallback; surface distinct, translated error states.

### 2.5 HIGH — Route protection is entirely client-side
No `middleware.ts` exists, and `output: 'export'` rules out server-side protection structurally. Every guard is an ad-hoc `useEffect` + `getActiveSession()` check (`src/app/profile/page.tsx:53,107`, `src/components/BottomNav.tsx:18`); `src/app/friends/page.tsx` has no auth check in its effects at all. Protected content flashes before redirect on slow connections, and any new page that forgets the guard call is simply unprotected at the app layer — RLS is the only real backstop.

**Fix:** Factor the guard into a single `useAuthGuard()` hook (or a wrapping layout) used by every protected route so it can't be forgotten; treat RLS as defense-in-depth, not the primary gate.

### 2.6 MEDIUM — `signOut` only clears the local session
`src/lib/supabase.ts:383-390` calls `signOut({ scope: 'local' })`, which does not revoke the refresh token server-side. A stolen/leaked refresh token remains valid after the user "signs out" on that device.

**Fix:** Default to `scope: 'global'` (or add an explicit "sign out everywhere" option), unless there's a specific multi-device UX reason to keep sessions alive elsewhere.

### 2.7 MEDIUM — Single-provider, no linking/recovery story
Email/password exists as a fallback, but there's no account-linking logic if the same email later signs in via a different method, and no documented recovery path if Google auth is unavailable for a user who only ever used Google.

### 2.8 LOW / clean
`credentials.ts` is explicitly scoped to local-only mode (Supabase not configured) and documents this; the SHA-256 hashing there is weak in isolation but out of scope since it's never used with a real backend. `env.ts` only exposes the anon key and URL client-side — no service-role key or OAuth client secret leak found.

---

## 3. English-First UX

This is the largest and most surprising gap found in the audit — bigger than the locale-file completeness question the brief implied.

### 3.1 CRITICAL — The data/service layer is hardcoded in Russian and bypasses i18n entirely
Cyrillic literals appear in **29 of ~54 source files (796 lines)**, and critically, not just in comments — they are returned as `error`/`message` fields from core data functions and rendered directly into UI state:

- `src/lib/store.ts:60,74,114,128,171,206,227,254,285,290,296` — e.g. `'Событие не найдено'` ("Event not found"), `'Войдите в аккаунт, чтобы создать событие'` ("Log in to create an event")
- `src/lib/remote-store.ts:92,224,231,238,269,303,310,392` — e.g. `'Такая запись уже существует.'`, `'Событие не найдено или у вас нет права его переименовать.'`
- `src/lib/supabase.ts:225,239,254,275,287,292,315,320,324,333,359,376,380` — every auth error message: `'Введите корректный адрес электронной почты'` ("Enter a valid email"), `'Неверный email или пароль'` ("Invalid email or password"), etc.

These aren't dead code paths: `src/app/auth/page.tsx:267` does `if (res.error) setErrorMessage(res.error)` and renders it as-is; `src/app/events/new/page.tsx:81-82` does the same. **A user who has selected English, German, or any of the 8 other supported locales still sees Russian error messages** for login failures, event/expense CRUD failures, and invite failures — i.e. almost every failure path in the app. The i18n system (`src/lib/i18n/*`) only covers static UI copy (buttons, labels, headings); it was never extended to the data layer.

**This is the top-priority fix.** It also means the current locale-file key-parity (see 3.2) is misleading — the *visible* strings are well-translated, but a large share of the strings a user actually encounters during real usage (errors) aren't going through translation at all.

**Fix:** Define error codes (not prose) in `store.ts`/`remote-store.ts`/`supabase.ts` (e.g. `'event_not_found'`, `'invalid_credentials'`), add corresponding keys to every locale file, and have UI call sites `t(errorCode)` instead of rendering `res.error` directly. This touches every call site listed above — see §4 for sequencing.

### 3.2 CRITICAL — Two more full user-facing subsystems hardcoded to Russian, independent of the app's selected locale
- **PDF/text export**: `src/lib/pdf-generator.ts:13-28` — the entire generated report ("ФИНАНСОВЫЙ ОТЧЕТ", "Дата формирования", "Итого расходов", "Участников", "РЕЕСТР ТРАНЗАКЦИЙ", etc.) plus `toLocaleDateString('ru-RU')` (line 14) is Russian regardless of app locale. An English-locale user exporting their report gets a Russian document.
- **Currency formatting**: `src/lib/currency.ts:222` hardcodes `new Intl.NumberFormat('ru-RU', ...)` for every money value in the app, and `currency.ts:92,120,146` hardcode `toLocaleTimeString('ru-RU', ...)` for "rate last updated." Worse, `currency.ts:45,156` hardcode the literal Russian strings `'Загрузка...'` and `'Резервные курсы'` as data values that get interpolated into an otherwise-translated sentence — so even a correctly localized English sentence can contain embedded Russian text.

By contrast, date formatting elsewhere (`NewExpenseClient.tsx:408`, `ExportReportClient.tsx:166`, `EventDetailClient.tsx:738`) correctly uses `toLocaleDateString(undefined, ...)`, deferring to the OS/browser locale — showing the fix pattern already exists in the codebase, just not applied consistently.

**Fix:** Route `formatMoney`/`lastUpdated` through the active locale from `I18nProvider` (pass locale in, don't default to `'ru-RU'`); localize `pdf-generator.ts` the same way the rest of the UI is localized.

### 3.3 CRITICAL — Onboarding tour hardcoded in English regardless of locale
`src/components/OnboardingTour.tsx:11-27,90,95` — all slide titles/descriptions and the "Next"/"Get Started" buttons are English literals, never routed through `t()`. Every non-English user's first-run experience is in English no matter what they selected — the exact inverse of §3.1/3.2, but the same root cause (a component built without wiring to `I18nProvider`).

### 3.4 HIGH — `<html lang="en">` is static and never reflects the runtime locale
`src/app/layout.tsx:42` — burned in at build time (static export has no per-request render), never updated by `I18nProvider`. Screen readers apply English pronunciation rules to Russian/Japanese/Chinese content. No `dir="rtl"` handling exists anywhere in `config.ts`/`provider.tsx` (moot today with no RTL locale, but nothing accounts for it if one is added).

**Fix:** Set `document.documentElement.lang` from `I18nProvider` on locale change (client-side, since static export can't vary the initial HTML per-request).

### 3.5 MEDIUM — No locale-prefixed routing; locale never reflected in the URL
`next.config.mjs:31` sets `output: 'export'`, which structurally excludes Next's built-in `i18n` routing config — this isn't a missed setting, it's incompatible with static export. `src/lib/routes.ts` uses flat, non-localized paths by design (dynamic `[id]` routes aren't exportable either, hence the query-string-based routing already in use). Locale lives purely in client React state (`I18nProvider`), never in the URL. Low impact for the Capacitor-wrapped app (no crawler), but relevant if any hosted marketing/landing surface shares this Next export — no per-locale SEO or static generation is possible as currently architected.

### 3.6 MEDIUM — Locale choice isn't backed by the user's account
`src/lib/i18n/provider.tsx:28,58-69,87,98` — locale is persisted only in `localStorage` (`splitit_locale`), never in the Supabase user profile, despite the app having a backend and a `profiles` table. A user who sets Russian on their phone and logs into the same account on a new device or after clearing site data silently reverts to device-detected/English.

**Fix:** Persist `locale` on the `profiles` row (small migration) and sync it in `I18nProvider` alongside the localStorage fallback, mirroring how the app already syncs `onboarding` flags server-side.

### 3.7 MEDIUM — No pluralization, no drift protection for the i18n system itself
Locale files are flat `Record<string, string>` with manual `{var}` string-replace interpolation (`provider.tsx:107-111`), no ICU MessageFormat, so any future count-based string (e.g. "3 friends") will be grammatically wrong for languages with complex plural rules (Russian, Turkish, etc.) — not exercised today since no such strings exist yet, but a real constraint the moment one is added. There is also no CI/lint step that diffs key sets across locale files; the audit found this out only by diffing them by hand (one orphaned key in `ru.ts:61`, `'friends.import'`, not present in `en.ts` — currently harmless, but nothing would catch a *missing* key the same way).

**Fix:** Add a small `test/i18n-keys.test.mjs` (same pattern as the existing `test/rls.test.mjs`) asserting every locale file has exactly the key set of `en.ts`; adopt ICU-style pluralization (e.g. via `Intl.PluralRules`) before the first count-dependent string is needed.

### 3.8 What's actually solid
Locale detection is SSR-safe by design — state initializes to `DEFAULT_LOCALE` and only reads `localStorage` inside an effect guarded by `typeof window === 'undefined'` (`provider.tsx:71-93`), correctly avoiding hydration mismatches. The 10 visible-UI-string locale files are, surprisingly, key-complete against `en.ts` — the translation *coverage* people would normally audit for is fine; the problem is entirely in the parts of the app that were never wired into the i18n system in the first place.

---

## 4. Refactoring Plan

Sequenced by blast radius and dependency, not just severity — some CRITICAL items (3.1) are large and mechanical; do them once, systematically, rather than opportunistically.

### Phase 1 — Stop the bleeding (days, low risk)
1. **§2.1/2.2 Google Auth on native**: branch `signInWithGoogle()` on `Capacitor.isNativePlatform()`; add a native Google Sign-In plugin + `signInWithIdToken`; add the missing intent-filter/deep-link for any web-redirect fallback. This should be fixed before any native build is submitted to app review — it's currently likely broken or policy-non-compliant on real devices.
2. **§2.3/2.4 Auth flow hardening**: switch to `flowType: 'pkce'` + `exchangeCodeForSession`; replace the callback's blind `setTimeout` with `onAuthStateChange`.
3. **§2.6 `signOut` scope**: change to `'global'` (or make it explicit/user-facing) — one-line fix, real security improvement.

### Phase 2 — English-first UX: data-layer localization (the big mechanical pass)
4. **§3.1**: Introduce error codes in `store.ts`/`remote-store.ts`/`supabase.ts`, add matching keys to all 10 locale files, update every call site currently doing `setErrorMessage(res.error)`/similar to call `t(res.errorCode)`. This is the single highest-impact fix for the "English-first" goal — it affects every failure path a user can hit.
5. **§3.2**: Localize `currency.ts` (`formatMoney`, `lastUpdated` timestamps) and `pdf-generator.ts` to the active locale instead of hardcoded `'ru-RU'`.
6. **§3.3**: Wire `OnboardingTour.tsx` strings through `t()`.
7. **§3.4**: Sync `document.documentElement.lang` with `I18nProvider`'s active locale.
8. **§3.7**: Add the locale-key-parity test alongside the existing RLS test suite so this can't regress silently once fixed.

### Phase 3 — Auth/session robustness
9. **§2.5**: Extract a single `useAuthGuard()`/protected-layout pattern so route protection can't be forgotten on new pages.
10. **§2.7**: Add basic account-linking/recovery messaging for the single-provider (Google) case.

### Phase 4 — Scalability groundwork (before growth, not after)
11. **§1.1/1.3**: Add a lightweight `group_summaries` query/RPC for list views; add `.range()`-based pagination to the expense list and friends list.
12. **§1.2**: Scope realtime subscriptions by `group_id` and move from full-refetch-on-event to targeted patches.
13. **§1.4**: Introduce SWR or React Query as a thin cache/dedup layer in front of `remote-store.ts`.
14. **§1.6**: Add `useMemo` to the render-body aggregations flagged above.
15. **§1.7**: Add a migration checklist/CI check enforcing the `SECURITY DEFINER` + `search_path` + explicit-grants pattern for all future RPCs.
16. **§3.6**: Persist locale on the `profiles` row.

### Phase 5 — Structural (only if/when justified by product direction)
17. **§1.5/3.5**: If a server-rendered or SEO-relevant web surface (marketing site, shareable public pages) is ever needed, it will require splitting that surface out of the `output: 'export'` Capacitor bundle into a separately deployed Next.js app that can use SSR/ISR and locale-prefixed routing — the current static-export architecture structurally cannot support either. Not urgent for a pure mobile-app product; worth flagging now so it's a deliberate decision later, not a surprise.

---

## Appendix: Files most worth reading first if triaging by hand
- `src/lib/supabase.ts` (460 lines) — auth, session, and the bulk of hardcoded Russian error strings
- `src/lib/remote-store.ts` (493 lines) — primary Supabase data layer, realtime subscriptions
- `src/lib/store.ts` (334 lines) — local/offline-mode mirror of the same operations
- `src/app/events/detail/EventDetailClient.tsx` (1025 lines) — largest, most render-heavy screen
- `supabase/migrations/20260801000001_harden_function_privileges.sql` — the RLS/security pattern to hold new RPCs to
- `src/lib/i18n/provider.tsx` + `src/lib/currency.ts` + `src/lib/pdf-generator.ts` — the three places locale is (or isn't) actually threaded through
