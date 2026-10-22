-- Откат 20261022000000_block_deleted_accounts.sql.
-- Применять вручную (SQL editor / psql). Данные не меняются.
--
-- Откат функциональный: снимает блокировку удалённых аккаунтов, но не
-- переписывает тела функций обратно. Проверка private.assert_account_active()
-- в них остаётся и становится заглушкой, всегда возвращающей true. Реестр
-- private.deleted_accounts сохраняется (повторное применение миграции снова
-- включит блокировку для всех, кто в нём есть).
--
-- После отката вернётся дефект: старый токен удалённого пользователя с деньгами
-- в общем событии снова даёт доступ к событию до истечения (~1 ч).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'deny_deleted_account'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS deny_deleted_account ON public.%I', r.tablename);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION private.assert_account_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT true $$;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261022000000';
