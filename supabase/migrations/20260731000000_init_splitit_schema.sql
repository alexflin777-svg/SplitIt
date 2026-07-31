-- Supabase Migration: SplitIT Core Database Schema
-- Version: 20260731000000

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    phone TEXT,
    email TEXT,
    telegram_id TEXT,
    default_currency TEXT DEFAULT 'RUB',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT DEFAULT 'trip',
    default_currency TEXT DEFAULT 'RUB',
    created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_members (
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.exchange_rates (
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate NUMERIC(14, 6) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (from_currency, to_currency)
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    paid_by_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    exchange_rate NUMERIC(14, 6) DEFAULT 1.0,
    amount_in_group_currency NUMERIC(12, 2) NOT NULL,
    category TEXT DEFAULT 'food',
    split_type TEXT DEFAULT 'equal',
    receipt_url TEXT,
    ocr_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount_owed NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    payer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    payee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT DEFAULT 'RUB',
    payment_method TEXT DEFAULT 'sbp',
    proof_url TEXT,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    invite_code TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Денежные величины не бывают отрицательными. Проверка на уровне БД —
-- последний рубеж: клиентская валидация обходится, запись в обход UI тоже.
ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0),
    ADD CONSTRAINT expenses_amount_in_group_currency_positive CHECK (amount_in_group_currency > 0),
    ADD CONSTRAINT expenses_exchange_rate_positive CHECK (exchange_rate > 0);

ALTER TABLE public.expense_splits
    ADD CONSTRAINT expense_splits_amount_owed_non_negative CHECK (amount_owed >= 0);

ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_amount_positive CHECK (amount > 0),
    ADD CONSTRAINT settlements_parties_differ CHECK (payer_id <> payee_id);

ALTER TABLE public.exchange_rates
    ADD CONSTRAINT exchange_rates_rate_positive CHECK (rate > 0);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Принцип: deny by default. RLS включён на КАЖДОЙ таблице, для каждой операции
-- заведена отдельная политика с USING и WITH CHECK.
--
-- Чего здесь намеренно нет: политик вида `FOR ALL USING (true)`. Permissive-
-- политики в PostgreSQL объединяются через OR, поэтому одна такая политика
-- обнуляет все остальные ограничения на таблице — рядом стоящая политика
-- «только участники группы» становится декоративной.

-- Проверка членства вынесена в SECURITY DEFINER функцию по двум причинам:
-- 1. Политика на group_members, которая читает group_members, даёт бесконечную
--    рекурсию — Postgres применит RLS к вложенному запросу.
-- 2. Одно место для правила членства вместо копии в каждой политике.
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.groups
        WHERE id = p_group_id AND created_by = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'owner'
    );
$$;

CREATE OR REPLACE FUNCTION public.shares_group_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.group_members AS mine
        JOIN public.group_members AS theirs USING (group_id)
        WHERE mine.user_id = auth.uid() AND theirs.user_id = p_user_id
    );
$$;

REVOKE ALL ON FUNCTION public.is_group_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_group_with(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_group_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_group_with(UUID) TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

-- Табличные права выданы явно, а не унаследованы от настроек проекта.
-- RLS работает поверх GRANT: без GRANT роль не дойдёт до политик и получит
-- «permission denied», а с GRANT, но без RLS — увидит всё. Нужны оба слоя,
-- и оба должны лежать в миграции, иначе схема не воспроизводится.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.profiles,
    public.groups,
    public.group_members,
    public.expenses,
    public.expense_splits,
    public.settlements,
    public.group_invites
TO authenticated;
GRANT SELECT ON public.exchange_rates TO authenticated;

-- Анонимной роли в схеме делать нечего: приложение требует входа.
REVOKE ALL ON SCHEMA public FROM anon;

-- profiles ------------------------------------------------------------------
-- Публичный SELECT убран: таблица хранит email и телефон, это не справочник.
CREATE POLICY "profiles_select_self_or_co_member" ON public.profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.shares_group_with(id));

CREATE POLICY "profiles_insert_self" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_self" ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_delete_self" ON public.profiles
    FOR DELETE TO authenticated
    USING (id = auth.uid());

-- groups --------------------------------------------------------------------
CREATE POLICY "groups_select_member" ON public.groups
    FOR SELECT TO authenticated
    USING (created_by = auth.uid() OR public.is_group_member(id));

CREATE POLICY "groups_insert_own" ON public.groups
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "groups_update_owner" ON public.groups
    FOR UPDATE TO authenticated
    USING (public.is_group_owner(id))
    WITH CHECK (public.is_group_owner(id));

CREATE POLICY "groups_delete_owner" ON public.groups
    FOR DELETE TO authenticated
    USING (created_by = auth.uid());

-- group_members -------------------------------------------------------------
CREATE POLICY "group_members_select_member" ON public.group_members
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_group_member(group_id));

-- Владелец добавляет кого угодно. Самостоятельное вступление идёт только через
-- redeem_group_invite() — прямой INSERT себя в чужую группу запрещён.
CREATE POLICY "group_members_insert_owner" ON public.group_members
    FOR INSERT TO authenticated
    WITH CHECK (public.is_group_owner(group_id));

CREATE POLICY "group_members_update_owner" ON public.group_members
    FOR UPDATE TO authenticated
    USING (public.is_group_owner(group_id))
    WITH CHECK (public.is_group_owner(group_id));

-- Выйти из группы может сам участник, исключить — владелец.
CREATE POLICY "group_members_delete_self_or_owner" ON public.group_members
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR public.is_group_owner(group_id));

-- expenses ------------------------------------------------------------------
CREATE POLICY "expenses_select_member" ON public.expenses
    FOR SELECT TO authenticated
    USING (public.is_group_member(group_id));

CREATE POLICY "expenses_insert_member" ON public.expenses
    FOR INSERT TO authenticated
    WITH CHECK (public.is_group_member(group_id));

CREATE POLICY "expenses_update_member" ON public.expenses
    FOR UPDATE TO authenticated
    USING (public.is_group_member(group_id))
    WITH CHECK (public.is_group_member(group_id));

CREATE POLICY "expenses_delete_member" ON public.expenses
    FOR DELETE TO authenticated
    USING (public.is_group_member(group_id));

-- expense_splits ------------------------------------------------------------
-- Доступ наследуется от группы расхода.
CREATE POLICY "expense_splits_select_member" ON public.expense_splits
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE e.id = expense_splits.expense_id AND public.is_group_member(e.group_id)
    ));

CREATE POLICY "expense_splits_insert_member" ON public.expense_splits
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE e.id = expense_splits.expense_id AND public.is_group_member(e.group_id)
    ));

CREATE POLICY "expense_splits_update_member" ON public.expense_splits
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE e.id = expense_splits.expense_id AND public.is_group_member(e.group_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE e.id = expense_splits.expense_id AND public.is_group_member(e.group_id)
    ));

CREATE POLICY "expense_splits_delete_member" ON public.expense_splits
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE e.id = expense_splits.expense_id AND public.is_group_member(e.group_id)
    ));

-- settlements ---------------------------------------------------------------
CREATE POLICY "settlements_select_member" ON public.settlements
    FOR SELECT TO authenticated
    USING (public.is_group_member(group_id));

-- Записать перевод можно только от своего имени.
CREATE POLICY "settlements_insert_payer" ON public.settlements
    FOR INSERT TO authenticated
    WITH CHECK (public.is_group_member(group_id) AND payer_id = auth.uid());

CREATE POLICY "settlements_update_party" ON public.settlements
    FOR UPDATE TO authenticated
    USING (public.is_group_member(group_id) AND (payer_id = auth.uid() OR payee_id = auth.uid()))
    WITH CHECK (public.is_group_member(group_id) AND (payer_id = auth.uid() OR payee_id = auth.uid()));

CREATE POLICY "settlements_delete_payer" ON public.settlements
    FOR DELETE TO authenticated
    USING (payer_id = auth.uid());

-- group_invites -------------------------------------------------------------
-- Таблица хранит коды приглашений, поэтому прямого SELECT для посторонних нет:
-- иначе любой аутентифицированный клиент выкачал бы все коды и вступил куда
-- угодно. Вступление идёт через redeem_group_invite() ниже.
CREATE POLICY "group_invites_select_member" ON public.group_invites
    FOR SELECT TO authenticated
    USING (public.is_group_member(group_id));

CREATE POLICY "group_invites_insert_owner" ON public.group_invites
    FOR INSERT TO authenticated
    WITH CHECK (public.is_group_owner(group_id) AND created_by = auth.uid());

CREATE POLICY "group_invites_delete_owner" ON public.group_invites
    FOR DELETE TO authenticated
    USING (public.is_group_owner(group_id));

-- exchange_rates ------------------------------------------------------------
-- Справочные данные: читают все аутентифицированные, пишет только service_role
-- (для него RLS не применяется).
CREATE POLICY "exchange_rates_select_authenticated" ON public.exchange_rates
    FOR SELECT TO authenticated
    USING (true);

-- ---------------------------------------------------------------------------
-- Вступление по приглашению
-- ---------------------------------------------------------------------------
-- Единственный путь попасть в чужую группу. Функция проверяет код и срок
-- действия, после чего добавляет вызывающего в участники. Прямой INSERT в
-- group_members для не-владельца закрыт политикой выше.
CREATE OR REPLACE FUNCTION public.redeem_group_invite(p_invite_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;

    SELECT group_id INTO v_group_id
    FROM public.group_invites
    WHERE invite_code = p_invite_code
      AND (expires_at IS NULL OR expires_at > NOW());

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Приглашение недействительно или истекло' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.group_members (group_id, user_id, role)
    VALUES (v_group_id, auth.uid(), 'member')
    ON CONFLICT (group_id, user_id) DO NOTHING;

    RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_group_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_group_invite(TEXT) TO authenticated;
