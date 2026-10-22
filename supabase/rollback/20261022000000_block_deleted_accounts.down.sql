-- Откат 20261022000000_block_deleted_accounts.sql — облегчённый, БЕЗОПАСНЫЙ.
-- Применять вручную (SQL editor / psql). Данные не меняются.
--
-- Что откат НЕ делает (сознательно): не снимает блокировку удалённых аккаунтов.
-- Снять её — значит вернуть дефект R1: старый токен удалённого пользователя с
-- деньгами в общем событии снова читает и меняет событие и восстанавливает
-- профиль; а если auth.admin.deleteUser когда-то упал, — не через час, а
-- бессрочно. Поэтому остаются:
--   - реестр private.deleted_accounts со всеми записями;
--   - RESTRICTIVE-политики deny_deleted_account на всех таблицах public;
--   - триггеры deny_deleted_account_write и сериализация удаления с записью
--     (advisory-блокировка по uid, свежая проверка реестра) — гонка закрыта;
--   - проверка private.assert_account_active() в начале RPC;
--   - delete_my_account() в версии с реестром.
-- Запись в supabase_migrations.schema_migrations тоже остаётся: миграция по
-- сути применена, и повторный db push не должен накатывать её заново.
--
-- Что откат делает: убирает проверку удалённого аккаунта из трёх функций
-- членства private.is_group_member / is_group_owner / shares_group_with,
-- возвращая тела из 20260801000001. Это единственное, что может заметно
-- ударить по живым пользователям: обычные политики вызывают эти функции на
-- КАЖДУЮ строку, и проверка добавляет на строку поиск в реестре и
-- advisory-блокировку. Применять, если после выкладки чтение крупных событий
-- стало медленным.
--
-- Цена отката: удалённый пользователь сможет вызвать публичные обёртки
-- is_group_member / is_group_owner / shares_group_with и узнать ответ «да/нет»
-- про собственное членство. Данные таблиц он по-прежнему не видит (их закрывает
-- RESTRICTIVE-политика), а RPC с записью и деньгами отклоняются.
--
-- Вернуть проверку: повторно выполнить три CREATE OR REPLACE FUNCTION
-- private.is_group_member / is_group_owner / shares_group_with из раздела 3
-- миграции 20261022000000.

CREATE OR REPLACE FUNCTION private.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION private.is_group_owner(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.groups
        WHERE id = p_group_id AND created_by = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'owner'
    );
$$;

CREATE OR REPLACE FUNCTION private.shares_group_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.group_members AS mine
        JOIN public.group_members AS theirs USING (group_id)
        WHERE mine.user_id = auth.uid() AND theirs.user_id = p_user_id
    );
$$;

-- CREATE OR REPLACE сохраняет права, но повторяем явно, как в миграции.
REVOKE ALL ON FUNCTION private.is_group_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_group_owner(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.shares_group_with(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_group_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_group_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.shares_group_with(UUID) TO authenticated;
