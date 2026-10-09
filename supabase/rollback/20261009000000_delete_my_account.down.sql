-- Откат 20261009000000_delete_my_account.sql.
-- Снимает функцию удаления аккаунта. Применять вручную (SQL editor / psql),
-- затем удалить строку версии из supabase_migrations.schema_migrations.
--
-- ВНИМАНИЕ: данные уже удалённых или обезличенных аккаунтов откат НЕ
-- возвращает — удаление необратимо по смыслу. Перед откатом отключите
-- Edge Function delete-account, иначе она будет отвечать ошибкой.

DROP FUNCTION IF EXISTS public.delete_my_account();

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261009000000';
