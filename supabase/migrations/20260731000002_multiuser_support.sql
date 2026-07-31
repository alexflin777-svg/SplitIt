-- Supabase Migration: многопользовательский режим
-- Version: 20260731000002
--
-- Три вещи, без которых схема работает, но приложение — нет:
--   1. Статус события: без него нельзя завершить расчёт и заморозить группу.
--   2. Профиль при регистрации: RLS ссылается на profiles, и пользователь без
--      строки в этой таблице не увидит даже себя.
--   3. Публикация Realtime: подписки на изменения не приходят, если таблица не
--      входит в публикацию.

-- 1. Статус события ---------------------------------------------------------
ALTER TABLE public.groups
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.groups
    DROP CONSTRAINT IF EXISTS groups_status_valid;
ALTER TABLE public.groups
    ADD CONSTRAINT groups_status_valid CHECK (status IN ('active', 'completed', 'archived'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS groups_touch_updated_at ON public.groups;
CREATE TRIGGER groups_touch_updated_at
    BEFORE UPDATE ON public.groups
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Профиль при регистрации ------------------------------------------------
-- Клиент не может вставить профиль до того, как получит сессию, а без профиля
-- политики на profiles и shares_group_with() не находят пользователя. Поэтому
-- строка создаётся триггером на auth.users — до первого запроса клиента.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Пользователь'),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', '👤'),
        NEW.email
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Блок в DO: в PGlite схемы auth.users нет, и без проверки миграция не
-- применилась бы в тестовом харнессе. На настоящем Supabase таблица есть.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'users'
    ) THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    END IF;
END
$$;

-- 3. Публикация Realtime ----------------------------------------------------
-- Подписки на postgres_changes приходят только для таблиц в публикации
-- supabase_realtime. RLS применяется к этим событиям, поэтому чужие изменения
-- до клиента не долетают — в отличие от прежней схемы, где клиенты сами
-- рассылали друг другу всё своё состояние в общий broadcast-канал.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_splits;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.settlements;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- таблица уже в публикации
END
$$;

-- Полные строки в событиях UPDATE/DELETE: без REPLICA IDENTITY FULL подписчик
-- получает только первичный ключ и не может обновить состояние у себя.
ALTER TABLE public.groups REPLICA IDENTITY FULL;
ALTER TABLE public.group_members REPLICA IDENTITY FULL;
ALTER TABLE public.expenses REPLICA IDENTITY FULL;
ALTER TABLE public.expense_splits REPLICA IDENTITY FULL;
ALTER TABLE public.settlements REPLICA IDENTITY FULL;

-- 4. Индексы под фактические запросы ----------------------------------------
CREATE INDEX IF NOT EXISTS group_members_user_id_idx ON public.group_members (user_id);
CREATE INDEX IF NOT EXISTS expenses_group_id_idx ON public.expenses (group_id);
CREATE INDEX IF NOT EXISTS expense_splits_expense_id_idx ON public.expense_splits (expense_id);
CREATE INDEX IF NOT EXISTS settlements_group_id_idx ON public.settlements (group_id);
CREATE INDEX IF NOT EXISTS group_invites_code_idx ON public.group_invites (invite_code);
