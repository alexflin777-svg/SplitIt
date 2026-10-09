-- Тип распределения расхода хранится и в сетевом режиме (G1, P1-16).
--
-- Дефект: экран «Редактировать расход» при сохранении делил итог поровну и
-- затирал доли «по позициям» и точные суммы. Клиент теперь сохраняет доли как
-- есть или пересчитывает их пропорционально, а чтобы при следующем открытии
-- знать, как расход был поделён, тип распределения пишется в expenses.split_mode.
--
-- Что меняется:
--   * expenses.split_mode TEXT NULL, CHECK equal|exact|items|shares.
--     NULL — тип неизвестен (старые записи и старые клиенты): клиент выводит
--     его из самих долей;
--   * add_expense_with_splits / update_expense_with_splits получают последним
--     параметром p_split_mode TEXT DEFAULT NULL.
--
-- Почему DROP + CREATE, а не перегрузка: при двух версиях (9 аргументов и 10 с
-- DEFAULT) вызов с 9 аргументами подходит обеим — PostgreSQL отвечает
-- «function is not unique», PostgREST — PGRST203. Одна функция с DEFAULT
-- обслуживает и старый клиент (9 именованных аргументов), и новый.
--
-- Тела функций — копия 20261010000000 (SECURITY DEFINER, search_path,
-- проверки членства и блокировки) плюс split_mode. DROP и CREATE выполняются
-- в одной транзакции миграции: окна без функции у клиентов нет.
--
-- Откат: supabase/rollback/20261011000000_expense_split_mode.down.sql

ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS split_mode TEXT NULL
    CONSTRAINT expenses_split_mode_check CHECK (split_mode IN ('equal', 'exact', 'items', 'shares'));

DROP FUNCTION IF EXISTS public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ);

-- ── add_expense_with_splits ───────────────────────────────────────────────
CREATE FUNCTION public.add_expense_with_splits(
    p_group_id UUID,
    p_title TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_amount_in_group_currency NUMERIC,
    p_category TEXT,
    p_paid_by_id UUID,
    p_splits JSONB,
    p_created_at TIMESTAMPTZ DEFAULT NOW(),
    p_split_mode TEXT DEFAULT NULL
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
        amount_in_group_currency, category, created_at, split_mode
    )
    VALUES (
        p_group_id, v_payer.party_profile_id, v_payer.party_participant_id, BTRIM(p_title), p_amount, p_currency,
        p_amount_in_group_currency, p_category, COALESCE(p_created_at, NOW()), p_split_mode
    )
    RETURNING id INTO v_expense_id;

    INSERT INTO public.expense_splits (expense_id, group_id, user_id, participant_id, amount_owed)
    SELECT v_expense_id, p_group_id, r.profile_id, r.participant_id, r.amount_owed
    FROM private.resolve_expense_splits(p_group_id, p_splits) AS r;

    RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT) TO authenticated;

-- ── update_expense_with_splits ────────────────────────────────────────────
CREATE FUNCTION public.update_expense_with_splits(
    p_expense_id UUID,
    p_title TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_amount_in_group_currency NUMERIC,
    p_category TEXT,
    p_paid_by_id UUID,
    p_splits JSONB,
    p_created_at TIMESTAMPTZ DEFAULT NOW(),
    p_split_mode TEXT DEFAULT NULL
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
        created_at = COALESCE(p_created_at, created_at),
        -- NULL — «тип неизвестен», а не «оставить прежний»: старый клиент без
        -- этого параметра всегда делит поровну, и прежний 'items' стал бы ложью.
        split_mode = p_split_mode
    WHERE id = p_expense_id;

    DELETE FROM public.expense_splits WHERE expense_id = p_expense_id;

    INSERT INTO public.expense_splits (expense_id, group_id, user_id, participant_id, amount_owed)
    SELECT p_expense_id, v_group_id, r.profile_id, r.participant_id, r.amount_owed
    FROM private.resolve_expense_splits(v_group_id, p_splits) AS r;

    RETURN p_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT) TO authenticated;
