-- Supabase Migration: harden function privileges and policy plans
-- Version: 20260801000001
--
-- Supabase grants EXECUTE on newly created public functions directly to anon,
-- authenticated and service_role. REVOKE ... FROM PUBLIC does not remove those
-- direct grants. Keep externally callable wrappers SECURITY INVOKER, move the
-- privileged implementation to a non-exposed schema, and revoke anon explicitly.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

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

REVOKE ALL ON FUNCTION private.is_group_member(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_group_owner(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.shares_group_with(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_group_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_group_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.shares_group_with(UUID) TO authenticated;

-- Policies already reference these public names. They become unprivileged
-- wrappers; PostgREST can expose them without exposing SECURITY DEFINER code.
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, private
AS $$ SELECT private.is_group_member(p_group_id) $$;

CREATE OR REPLACE FUNCTION public.is_group_owner(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, private
AS $$ SELECT private.is_group_owner(p_group_id) $$;

CREATE OR REPLACE FUNCTION public.shares_group_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, private
AS $$ SELECT private.shares_group_with(p_user_id) $$;

-- The privileged invite implementation is private; the public RPC is an
-- authenticated SECURITY INVOKER wrapper.
CREATE OR REPLACE FUNCTION private.redeem_group_invite(p_invite_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

REVOKE ALL ON FUNCTION private.redeem_group_invite(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.redeem_group_invite(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_group_invite(p_invite_code TEXT)
RETURNS UUID
LANGUAGE SQL
SECURITY INVOKER
VOLATILE
SET search_path = pg_catalog, private
AS $$ SELECT private.redeem_group_invite(p_invite_code) $$;

-- Group creation does not need elevated privileges: existing INSERT policies
-- allow the caller to create only a group owned by auth.uid(), then add its
-- owner membership inside the same RPC transaction.
ALTER FUNCTION public.create_group_with_owner(TEXT, TEXT, TEXT) SECURITY INVOKER;
ALTER FUNCTION public.create_group_with_owner(TEXT, TEXT, TEXT) SET search_path = pg_catalog, public;

-- Trigger-only functions are not RPC endpoints.
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.touch_updated_at() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'users'
    ) THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();
    END IF;
END
$$;

DROP TRIGGER IF EXISTS groups_touch_updated_at ON public.groups;
CREATE TRIGGER groups_touch_updated_at
    BEFORE UPDATE ON public.groups
    FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.touch_updated_at();

-- Explicit role revokes must come after every CREATE OR REPLACE because the
-- Supabase project default privileges add anon back on function creation.
REVOKE EXECUTE ON FUNCTION public.is_group_member(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_group_owner(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shares_group_with(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_group_invite(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_group_with_owner(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_group_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_group_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_group_invite(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_with_owner(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_expense_with_splits(UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, UUID, JSONB, TIMESTAMPTZ) TO authenticated;

-- Cache auth.uid() once per statement in policies instead of per row.
ALTER POLICY "profiles_select_self_or_co_member" ON public.profiles
    USING (id = (SELECT auth.uid()) OR public.shares_group_with(id));
ALTER POLICY "profiles_insert_self" ON public.profiles
    WITH CHECK (id = (SELECT auth.uid()));
ALTER POLICY "profiles_update_self" ON public.profiles
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));
ALTER POLICY "profiles_delete_self" ON public.profiles
    USING (id = (SELECT auth.uid()));

ALTER POLICY "groups_select_member" ON public.groups
    USING (created_by = (SELECT auth.uid()) OR public.is_group_member(id));
ALTER POLICY "groups_insert_own" ON public.groups
    WITH CHECK (created_by = (SELECT auth.uid()));
ALTER POLICY "groups_delete_owner" ON public.groups
    USING (created_by = (SELECT auth.uid()));

ALTER POLICY "group_members_select_member" ON public.group_members
    USING (user_id = (SELECT auth.uid()) OR public.is_group_member(group_id));
ALTER POLICY "group_members_delete_self_or_owner" ON public.group_members
    USING (user_id = (SELECT auth.uid()) OR public.is_group_owner(group_id));

ALTER POLICY "settlements_insert_payer" ON public.settlements
    WITH CHECK (public.is_group_member(group_id) AND payer_id = (SELECT auth.uid()));
ALTER POLICY "settlements_update_party" ON public.settlements
    USING (public.is_group_member(group_id) AND (payer_id = (SELECT auth.uid()) OR payee_id = (SELECT auth.uid())))
    WITH CHECK (public.is_group_member(group_id) AND (payer_id = (SELECT auth.uid()) OR payee_id = (SELECT auth.uid())));
ALTER POLICY "settlements_delete_payer" ON public.settlements
    USING (payer_id = (SELECT auth.uid()));

ALTER POLICY "group_invites_insert_owner" ON public.group_invites
    WITH CHECK (public.is_group_owner(group_id) AND created_by = (SELECT auth.uid()));

-- Cover every foreign key used by joins, deletes and RLS checks.
CREATE INDEX IF NOT EXISTS expense_splits_user_id_idx ON public.expense_splits (user_id);
CREATE INDEX IF NOT EXISTS expenses_paid_by_id_idx ON public.expenses (paid_by_id);
CREATE INDEX IF NOT EXISTS group_invites_created_by_idx ON public.group_invites (created_by);
CREATE INDEX IF NOT EXISTS group_invites_group_id_idx ON public.group_invites (group_id);
CREATE INDEX IF NOT EXISTS groups_created_by_idx ON public.groups (created_by);
CREATE INDEX IF NOT EXISTS settlements_payee_id_idx ON public.settlements (payee_id);
CREATE INDEX IF NOT EXISTS settlements_payer_id_idx ON public.settlements (payer_id);
