-- Откат 20261010000000_guest_participants_in_expenses.sql.
--
-- Возвращает add_expense_with_splits / update_expense_with_splits к версии из
-- 20260801000000 (SECURITY INVOKER, участники только из group_members) и
-- удаляет вспомогательные функции. Колонки и данные не трогаются.
--
-- ВНИМАНИЕ: после отката расходы с долями гостей, сохранённые новой версией,
-- остаются в базе (user_id/paid_by_id = NULL, participant_id заполнен), но
-- старая функция их отредактировать не сможет — снова «пользователь вне группы».
-- Клиент со «старым» чтением (без participant_id) покажет у таких долей пустой id.

CREATE OR REPLACE FUNCTION public.add_expense_with_splits(
    p_group_id UUID,
    p_title TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_amount_in_group_currency NUMERIC,
    p_category TEXT,
    p_paid_by_id UUID,
    p_splits JSONB,
    p_created_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_expense_id UUID;
BEGIN
    IF jsonb_typeof(p_splits) IS DISTINCT FROM 'array' OR jsonb_array_length(p_splits) = 0 THEN
        RAISE EXCEPTION 'У расхода должен быть хотя бы один участник' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = p_paid_by_id
    ) THEN
        RAISE EXCEPTION 'Плательщик не состоит в группе' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_splits) AS split(user_id UUID, amount_owed NUMERIC)
        LEFT JOIN public.group_members member
          ON member.group_id = p_group_id AND member.user_id = split.user_id
        WHERE member.user_id IS NULL OR split.amount_owed < 0
    ) THEN
        RAISE EXCEPTION 'Доли содержат пользователя вне группы или отрицательную сумму' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.expenses (
        group_id, paid_by_id, title, amount, currency,
        amount_in_group_currency, category, created_at
    )
    VALUES (
        p_group_id, p_paid_by_id, BTRIM(p_title), p_amount, p_currency,
        p_amount_in_group_currency, p_category, p_created_at
    )
    RETURNING id INTO v_expense_id;

    INSERT INTO public.expense_splits (expense_id, user_id, amount_owed)
    SELECT v_expense_id, split.user_id, split.amount_owed
    FROM jsonb_to_recordset(p_splits) AS split(user_id UUID, amount_owed NUMERIC);

    RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_expense_with_splits(
    p_expense_id UUID,
    p_title TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_amount_in_group_currency NUMERIC,
    p_category TEXT,
    p_paid_by_id UUID,
    p_splits JSONB,
    p_created_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
BEGIN
    SELECT group_id INTO v_group_id
    FROM public.expenses
    WHERE id = p_expense_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Расход не найден или недоступен' USING ERRCODE = 'P0002';
    END IF;

    IF jsonb_typeof(p_splits) IS DISTINCT FROM 'array' OR jsonb_array_length(p_splits) = 0 THEN
        RAISE EXCEPTION 'У расхода должен быть хотя бы один участник' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = v_group_id AND user_id = p_paid_by_id
    ) THEN
        RAISE EXCEPTION 'Плательщик не состоит в группе' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_splits) AS split(user_id UUID, amount_owed NUMERIC)
        LEFT JOIN public.group_members member
          ON member.group_id = v_group_id AND member.user_id = split.user_id
        WHERE member.user_id IS NULL OR split.amount_owed < 0
    ) THEN
        RAISE EXCEPTION 'Доли содержат пользователя вне группы или отрицательную сумму' USING ERRCODE = '22023';
    END IF;

    UPDATE public.expenses
    SET title = BTRIM(p_title),
        amount = p_amount,
        currency = p_currency,
        amount_in_group_currency = p_amount_in_group_currency,
        category = p_category,
        paid_by_id = p_paid_by_id,
        created_at = p_created_at
    WHERE id = p_expense_id;

    DELETE FROM public.expense_splits WHERE expense_id = p_expense_id;

    INSERT INTO public.expense_splits (expense_id, user_id, amount_owed)
    SELECT p_expense_id, split.user_id, split.amount_owed
    FROM jsonb_to_recordset(p_splits) AS split(user_id UUID, amount_owed NUMERIC);

    RETURN p_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;

-- Права как после 20260801000001_harden_function_privileges.sql.
REVOKE EXECUTE ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;

DROP FUNCTION IF EXISTS private.resolve_expense_splits(UUID, JSONB);
DROP FUNCTION IF EXISTS private.resolve_money_party(UUID, UUID);
DROP FUNCTION IF EXISTS private.lock_group_for_money_write(UUID);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261010000000';
