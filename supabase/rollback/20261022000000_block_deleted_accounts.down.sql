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
-- Что откат делает: облегчает проверку удалённого аккаунта в трёх функциях
-- членства private.is_group_member / is_group_owner / shares_group_with.
-- Обычные политики вызывают их (через публичные обёртки) на КАЖДУЮ строку, и
-- полная проверка добавляет на строку вызов plpgsql, свежий снимок и
-- advisory-блокировку. Применять, если после выкладки чтение крупных событий
-- стало медленным.
--
-- Облегчённая проверка: для живого пользователя — один поиск по первичному
-- ключу реестра, без plpgsql и блокировок. Если uid в реестре, вызывается
-- полная private.assert_account_active() — ошибка 42501, как до отката.
-- Совсем убрать проверку из этих функций нельзя: политики исполняют их с правами
-- вызывающего, значит EXECUTE у authenticated обязан остаться, и без проверки
-- удалённый узнавал бы через shares_group_with(чужой uuid) текущее членство
-- других людей (ревью R3). Поэтому ни публичные обёртки, ни сами private-функции
-- удалённому ничего не отвечают — ни про себя, ни про других.
--
-- Цена отката: ответ о членстве больше не ждёт идущего delete_my_account —
-- запрос, начатый до его commit, отвечает как до удаления (это и есть
-- состояние на момент запроса). Удаление, закоммиченное до начала запроса,
-- видно в снимке: реестр не очищается. Запись по-прежнему сериализуют
-- RESTRICTIVE-политика, триггер и assert в RPC.
--
-- Вернуть полную проверку: повторно выполнить три CREATE OR REPLACE FUNCTION
-- private.is_group_member / is_group_owner / shares_group_with из раздела 3
-- миграции 20261022000000.

CREATE OR REPLACE FUNCTION private.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM private.deleted_accounts WHERE user_id = auth.uid())
            THEN NOT private.assert_account_active()
        ELSE EXISTS (
            SELECT 1 FROM public.group_members
            WHERE group_id = p_group_id AND user_id = auth.uid()
        )
    END;
$$;

CREATE OR REPLACE FUNCTION private.is_group_owner(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM private.deleted_accounts WHERE user_id = auth.uid())
            THEN NOT private.assert_account_active()
        ELSE EXISTS (
            SELECT 1 FROM public.groups
            WHERE id = p_group_id AND created_by = auth.uid()
        ) OR EXISTS (
            SELECT 1 FROM public.group_members
            WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'owner'
        )
    END;
$$;

CREATE OR REPLACE FUNCTION private.shares_group_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM private.deleted_accounts WHERE user_id = auth.uid())
            THEN NOT private.assert_account_active()
        ELSE EXISTS (
            SELECT 1
            FROM public.group_members AS mine
            JOIN public.group_members AS theirs USING (group_id)
            WHERE mine.user_id = auth.uid() AND theirs.user_id = p_user_id
        )
    END;
$$;

-- CREATE OR REPLACE сохраняет права, но повторяем явно, как в миграции.
REVOKE ALL ON FUNCTION private.is_group_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_group_owner(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.shares_group_with(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_group_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_group_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.shares_group_with(UUID) TO authenticated;
