-- Откат 20261011000000_expense_split_mode.sql.
-- Применять вручную (SQL editor / psql), затем удалить строку версии из
-- supabase_migrations.schema_migrations (последняя команда).
--
-- Возвращает 9-аргументные add/update_expense_with_splits из 20261010000000
-- (с гостями) и удаляет колонку expenses.split_mode.
-- ВНИМАНИЕ: сохранённые типы распределения теряются; сами доли не меняются.
-- Перед откатом верните веб-сборку без чтения split_mode, иначе запрос
-- расходов упадёт с 42703 (нет колонки).

BEGIN;

DROP FUNCTION IF EXISTS public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT);

-- ── add_expense_with_splits ───────────────────────────────────────────────
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
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_expense_id UUID;
    v_payer RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;

    -- Раньше это проверяла RLS (expenses_insert_member); DEFINER её обходит.
    -- Проверка до блокировок (посторонний не встаёт в очередь на чужое
    -- событие) и повторно после них (членство могло измениться в ожидании).
    IF p_group_id IS NULL OR NOT public.is_group_member(p_group_id) THEN
        RAISE EXCEPTION 'Событие не найдено или недоступно' USING ERRCODE = '42501';
    END IF;
    PERFORM private.lock_group_for_money_write(p_group_id);
    IF NOT public.is_group_member(p_group_id) THEN
        RAISE EXCEPTION 'Событие не найдено или недоступно' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_payer FROM private.resolve_money_party(p_group_id, p_paid_by_id);
    IF v_payer.party_participant_id IS NULL THEN
        RAISE EXCEPTION 'Плательщик не состоит в группе' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.expenses (
        group_id, paid_by_id, paid_by_participant_id, title, amount, currency,
        amount_in_group_currency, category, created_at
    )
    VALUES (
        p_group_id, v_payer.party_profile_id, v_payer.party_participant_id, BTRIM(p_title), p_amount, p_currency,
        p_amount_in_group_currency, p_category, COALESCE(p_created_at, NOW())
    )
    RETURNING id INTO v_expense_id;

    INSERT INTO public.expense_splits (expense_id, group_id, user_id, participant_id, amount_owed)
    SELECT v_expense_id, p_group_id, r.profile_id, r.participant_id, r.amount_owed
    FROM private.resolve_expense_splits(p_group_id, p_splits) AS r;

    RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;

-- ── update_expense_with_splits ────────────────────────────────────────────
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
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_group_id UUID;
    v_payer RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;

    SELECT group_id INTO v_group_id
    FROM public.expenses
    WHERE id = p_expense_id;

    -- «Нет такого» и «нет доступа» неразличимы, как и при RLS: по ответу
    -- нельзя перебирать чужие id расходов. Блокировки — см. add_expense_with_splits.
    IF v_group_id IS NULL OR NOT public.is_group_member(v_group_id) THEN
        RAISE EXCEPTION 'Расход не найден или недоступен' USING ERRCODE = 'P0002';
    END IF;
    PERFORM private.lock_group_for_money_write(v_group_id);
    IF NOT public.is_group_member(v_group_id) THEN
        RAISE EXCEPTION 'Расход не найден или недоступен' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_payer FROM private.resolve_money_party(v_group_id, p_paid_by_id);
    IF v_payer.party_participant_id IS NULL THEN
        RAISE EXCEPTION 'Плательщик не состоит в группе' USING ERRCODE = '22023';
    END IF;

    UPDATE public.expenses
    SET title = BTRIM(p_title),
        amount = p_amount,
        currency = p_currency,
        amount_in_group_currency = p_amount_in_group_currency,
        category = p_category,
        paid_by_id = v_payer.party_profile_id,
        paid_by_participant_id = v_payer.party_participant_id,
        created_at = COALESCE(p_created_at, created_at)
    WHERE id = p_expense_id;

    DELETE FROM public.expense_splits WHERE expense_id = p_expense_id;

    INSERT INTO public.expense_splits (expense_id, group_id, user_id, participant_id, amount_owed)
    SELECT p_expense_id, v_group_id, r.profile_id, r.participant_id, r.amount_owed
    FROM private.resolve_expense_splits(v_group_id, p_splits) AS r;

    RETURN p_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;

ALTER TABLE public.expenses DROP COLUMN IF EXISTS split_mode;

COMMIT;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011000000';
