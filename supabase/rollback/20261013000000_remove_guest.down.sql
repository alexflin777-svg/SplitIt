-- Откат 20261013000000_remove_guest.sql.
-- Применять вручную (SQL editor / psql). Данные не меняются: уже удалённых
-- гостей откат не возвращает (у них не было ни расходов, ни переводов).
-- Перед откатом верните веб-сборку без кнопки удаления гостя, иначе она будет
-- отвечать «функция не найдена».

DROP FUNCTION IF EXISTS public.remove_guest(UUID);

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261013000000';
