-- Гости в расходах: расход с долей гостя или оплаченный гостем сохраняется.
--
-- Дефект (воспроизведён на проде 2026-10-09, iPhone-фидбек F5):
--   add_virtual_member создаёт гостя в group_participants (kind = 'guest'),
--   клиент показывает его участником события, но add_expense_with_splits и
--   update_expense_with_splits проверяли каждый id только по group_members.
--   Итог: «Доли содержат пользователя вне группы…» (22023) для любой доли
--   гостя и «Плательщик не состоит в группе», если платил гость, — расход в
--   событии с гостями не сохранялся никогда.
--
-- Что меняется (сигнатуры функций прежние, клиент шлёт те же параметры):
--   * id плательщика и каждой доли — это либо user_id участника из
--     group_members, либо id гостя из group_participants ЭТОЙ группы;
--   * для аккаунта заполняются обе пары колонок: paid_by_id/user_id и
--     paid_by_participant_id/participant_id (account-participant создаётся,
--     если его ещё нет, так же, как бэкфилл в 20260802000000);
--   * для гостя paid_by_id/user_id = NULL, а *_participant_id = id гостя;
--     expense_splits.group_id заполняется всегда (MATCH FULL FK из
--     20260802000000 требует пары group_id + participant_id);
--   * функции становятся SECURITY DEFINER: authenticated не имеет права
--     INSERT в group_participants, а account-participant нужно уметь создать.
--     Поэтому право на запись, которое раньше давала RLS (is_group_member),
--     проверяется здесь явно. search_path закреплён, исполняет только
--     authenticated;
--   * закрытое событие по-прежнему отклоняется триггерами из 20260925000001
--     (P0423) — они срабатывают и для SECURITY DEFINER.
--
-- Функция plpgsql атомарна: ошибка в любой доле откатывает и сам расход.
--
-- Откат: supabase/rollback/20261010000000_guest_participants_in_expenses.down.sql

-- ── Разрешение id из запроса в денежную сторону ───────────────────────────
-- Возвращает (party_profile_id, party_participant_id), либо два NULL, если id не
-- принадлежит этой группе. Вызывается только из функций ниже.
CREATE OR REPLACE FUNCTION private.resolve_money_party(
    p_group_id UUID,
    p_id UUID,
    OUT party_profile_id UUID,
    OUT party_participant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    party_profile_id := NULL;
    party_participant_id := NULL;
    IF p_group_id IS NULL OR p_id IS NULL THEN
        RETURN;
    END IF;

    -- 1. Аккаунт-участник группы.
    IF EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id AND gm.user_id = p_id
    ) THEN
        SELECT gp.id INTO party_participant_id
        FROM public.group_participants gp
        WHERE gp.group_id = p_group_id AND gp.profile_id = p_id;

        IF party_participant_id IS NULL THEN
            -- Как в бэкфилле 20260802000000: участник — сам себе создатель.
            INSERT INTO public.group_participants
                (group_id, profile_id, display_name, avatar_url, kind, created_by)
            SELECT p_group_id, p.id, p.full_name, p.avatar_url, 'account', p.id
            FROM public.profiles p
            WHERE p.id = p_id
            ON CONFLICT (group_id, profile_id) WHERE profile_id IS NOT NULL DO NOTHING;

            SELECT gp.id INTO party_participant_id
            FROM public.group_participants gp
            WHERE gp.group_id = p_group_id AND gp.profile_id = p_id;
        END IF;

        IF party_participant_id IS NOT NULL THEN
            party_profile_id := p_id;
        END IF;
        RETURN;
    END IF;

    -- 2. Гость именно этой группы. Гость чужой группы сюда не попадает.
    SELECT gp.id INTO party_participant_id
    FROM public.group_participants gp
    WHERE gp.group_id = p_group_id AND gp.id = p_id AND gp.kind = 'guest';
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_money_party(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Проверка и разрешение долей ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.resolve_expense_splits(p_group_id UUID, p_splits JSONB)
RETURNS TABLE (profile_id UUID, participant_id UUID, amount_owed NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_split RECORD;
    v_party RECORD;
    v_seen UUID[] := '{}';
BEGIN
    IF jsonb_typeof(p_splits) IS DISTINCT FROM 'array' OR jsonb_array_length(p_splits) = 0 THEN
        RAISE EXCEPTION 'У расхода должен быть хотя бы один участник' USING ERRCODE = '22023';
    END IF;

    FOR v_split IN
        SELECT s.user_id, s.amount_owed
        FROM jsonb_to_recordset(p_splits) AS s(user_id UUID, amount_owed NUMERIC)
    LOOP
        IF v_split.amount_owed IS NULL OR v_split.amount_owed < 0 THEN
            RAISE EXCEPTION 'Доли содержат пользователя вне группы или отрицательную сумму' USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_party FROM private.resolve_money_party(p_group_id, v_split.user_id);
        IF v_party.party_participant_id IS NULL THEN
            RAISE EXCEPTION 'Доли содержат пользователя вне группы или отрицательную сумму' USING ERRCODE = '22023';
        END IF;

        -- Один человек — одна доля: иначе баланс посчитает его дважды.
        IF v_party.party_participant_id = ANY (v_seen) THEN
            RAISE EXCEPTION 'Участник указан в долях дважды' USING ERRCODE = '22023';
        END IF;
        v_seen := v_seen || v_party.party_participant_id;

        profile_id := v_party.party_profile_id;
        participant_id := v_party.party_participant_id;
        amount_owed := v_split.amount_owed;
        RETURN NEXT;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_expense_splits(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── Блокировки на время записи расхода ────────────────────────────────────
-- delete_my_account берёт профиль FOR UPDATE, затем события FOR UPDATE. Здесь
-- тот же порядок: сначала профили участников события (FOR KEY SHARE — этого
-- требует и FK при ленивом создании account-participant), затем строка
-- события FOR SHARE. Обратный порядок давал взаимоблокировку (40P01), если
-- расход с человеком сохранялся в ту же секунду, когда он удалял аккаунт.
CREATE OR REPLACE FUNCTION private.lock_group_for_money_write(p_group_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    PERFORM 1
    FROM public.profiles p
    WHERE p.id IN (SELECT gm.user_id FROM public.group_members gm WHERE gm.group_id = p_group_id)
    ORDER BY p.id
    FOR KEY SHARE;

    PERFORM 1 FROM public.groups WHERE id = p_group_id FOR SHARE;
END;
$$;

REVOKE ALL ON FUNCTION private.lock_group_for_money_write(UUID) FROM PUBLIC, anon, authenticated;

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
