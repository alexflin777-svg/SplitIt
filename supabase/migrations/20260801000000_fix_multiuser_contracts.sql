-- Supabase Migration: atomic multi-user contracts
-- Version: 20260801000000
--
-- Fixes found during the CODEX integration review:
--   1. invite codes were described as one-time, but were never consumed;
--   2. creating a group required two HTTP requests and could leave an ownerless
--      half-created group;
--   3. rewriting an expense and its splits was not transactional, so a failed
--      split insert could erase the previous split.

-- A group and its owner membership are one transaction. The caller cannot
-- choose another owner: auth.uid() is the only identity used by the function.
CREATE OR REPLACE FUNCTION public.create_group_with_owner(
    p_name TEXT,
    p_category TEXT,
    p_default_currency TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_group_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;

    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Название события обязательно' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.groups (name, category, default_currency, created_by)
    VALUES (BTRIM(p_name), p_category, p_default_currency, v_user_id)
    RETURNING id INTO v_group_id;

    INSERT INTO public.group_members (group_id, user_id, role)
    VALUES (v_group_id, v_user_id, 'owner');

    RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_with_owner(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_group_with_owner(TEXT, TEXT, TEXT) TO authenticated;

-- An expense and all of its splits are written in the transaction that wraps
-- a PostgREST RPC call. Direct table writes remain protected by RLS, while this
-- function removes the partial-write window from the client implementation.
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

-- DELETE ... RETURNING both validates and consumes the code atomically. If the
-- following membership insert fails, the surrounding function transaction
-- rolls the deletion back as well.
CREATE OR REPLACE FUNCTION public.redeem_group_invite(p_invite_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_group_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;

    DELETE FROM public.group_invites
    WHERE invite_code = p_invite_code
      AND (expires_at IS NULL OR expires_at > NOW())
    RETURNING group_id INTO v_group_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Приглашение недействительно, уже использовано или истекло' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.group_members (group_id, user_id, role)
    VALUES (v_group_id, v_user_id, 'member')
    ON CONFLICT (group_id, user_id) DO NOTHING;

    RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_group_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_group_invite(TEXT) TO authenticated;
