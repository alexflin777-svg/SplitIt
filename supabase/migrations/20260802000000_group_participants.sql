-- Supabase Migration: financial participants alongside account membership
-- Version: 20260802000000
--
-- group_members stays the authorization table: it answers "which account can
-- log in and see this group". group_participants is new and answers a
-- different question: "which financial party owes or is owed money in this
-- group". The two are kept apart so that a participant without an account
-- (a future guest) can appear in expenses/splits/settlements without ever
-- being a subject of RLS or auth.
--
-- This migration is additive only: legacy profile-FK columns on expenses,
-- expense_splits and settlements are untouched and still authoritative. New
-- participant-ref columns are nullable transition columns, backfilled from
-- the current data, so client behaviour does not change in this stage.

-- ---------------------------------------------------------------------------
-- group_participants
-- ---------------------------------------------------------------------------
CREATE TABLE public.group_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('account', 'guest')),
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- An account participant always carries the profile it represents; a
    -- guest never does. This is the only thing that tells the two kinds
    -- apart, so it is enforced here rather than trusted to callers.
    CONSTRAINT group_participants_kind_profile_consistency CHECK (
        (kind = 'account' AND profile_id IS NOT NULL) OR
        (kind = 'guest' AND profile_id IS NULL)
    ),
    -- Referenced by composite FKs below so expenses/splits/settlements can
    -- pin a participant ref to the same group_id as the row that uses it.
    CONSTRAINT group_participants_group_id_id_unique UNIQUE (group_id, id)
);

-- One account participant per profile per group: prevents duplicate
-- financial identities for the same person inside one group. Partial index
-- because guests (profile_id NULL) must not collide with each other.
CREATE UNIQUE INDEX group_participants_group_profile_unique
    ON public.group_participants (group_id, profile_id)
    WHERE profile_id IS NOT NULL;

-- No separate group_id index: group_participants_group_id_id_unique above is
-- a (group_id, id) index, and group_id is its leading column, so it already
-- serves plain "WHERE group_id = ..." lookups.
CREATE INDEX group_participants_profile_id_idx ON public.group_participants (profile_id);
CREATE INDEX group_participants_created_by_idx ON public.group_participants (created_by);

DROP TRIGGER IF EXISTS group_participants_touch_updated_at ON public.group_participants;
CREATE TRIGGER group_participants_touch_updated_at
    BEFORE UPDATE ON public.group_participants
    FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill: one account participant per (group, profile) pair that is either
-- a current group_members row OR any legacy money side already recorded in
-- that group. group_members alone is not enough: a member can be removed
-- (kicked or left) after paying or splitting an expense, and settlements do
-- not require the payee to ever have been a member (settlements_insert_payer
-- only checks the payer). Either case leaves a legacy profile reference with
-- no group_members row, and a group_members-only backfill would leave it
-- pointing at no participant at all.
-- ---------------------------------------------------------------------------
-- created_by is the participant's own profile for every source here: members
-- joined themselves (owner creation or invite redemption), and there is no
-- separate actor on record to attribute a legacy-money-only participant to
-- either.
INSERT INTO public.group_participants
    (group_id, profile_id, display_name, avatar_url, kind, created_by, created_at)
WITH legacy_money_sides AS (
    SELECT group_id, user_id AS profile_id
    FROM public.group_members
    WHERE group_id IS NOT NULL AND user_id IS NOT NULL

    UNION

    SELECT group_id, paid_by_id AS profile_id
    FROM public.expenses
    WHERE group_id IS NOT NULL AND paid_by_id IS NOT NULL

    UNION

    SELECT e.group_id, es.user_id AS profile_id
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id IS NOT NULL AND es.user_id IS NOT NULL

    UNION

    SELECT group_id, payer_id AS profile_id
    FROM public.settlements
    WHERE group_id IS NOT NULL AND payer_id IS NOT NULL

    UNION

    SELECT group_id, payee_id AS profile_id
    FROM public.settlements
    WHERE group_id IS NOT NULL AND payee_id IS NOT NULL
),
participant_pairs AS (
    SELECT DISTINCT group_id, profile_id FROM legacy_money_sides
)
SELECT
    pp.group_id,
    pp.profile_id,
    p.full_name,
    p.avatar_url,
    'account',
    pp.profile_id AS created_by,
    COALESCE(gm.joined_at, NOW()) AS created_at
FROM participant_pairs pp
JOIN public.profiles p ON p.id = pp.profile_id
LEFT JOIN public.group_members gm
       ON gm.group_id = pp.group_id AND gm.user_id = pp.profile_id
ON CONFLICT (group_id, profile_id) WHERE profile_id IS NOT NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- Transition ref columns on money tables (nullable: legacy columns remain
-- authoritative until a later dual-write stage)
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
    ADD COLUMN paid_by_participant_id UUID;

ALTER TABLE public.expense_splits
    ADD COLUMN group_id UUID,
    ADD COLUMN participant_id UUID;

ALTER TABLE public.settlements
    ADD COLUMN payer_participant_id UUID,
    ADD COLUMN payee_participant_id UUID;

-- Backfill the new refs by matching (group_id, profile_id) to the account
-- participant created above. Legacy profile columns are not modified.
UPDATE public.expenses e
SET paid_by_participant_id = gp.id
FROM public.group_participants gp
WHERE gp.group_id = e.group_id AND gp.profile_id = e.paid_by_id;

UPDATE public.expense_splits es
SET group_id = e.group_id,
    participant_id = gp.id
FROM public.expenses e, public.group_participants gp
WHERE es.expense_id = e.id
  AND gp.group_id = e.group_id
  AND gp.profile_id = es.user_id;

-- payer and payee are backfilled by two independent UPDATEs, not one. A
-- single UPDATE joined on both sides at once only touches a row when BOTH
-- matches succeed, so a row with a legitimate legacy-NULL payee_id (payee_id
-- has no NOT NULL contract on this table) would leave payer_participant_id
-- NULL too - even though the payer side matched fine - and the fail-fast
-- check below would then blame the payer side for what is actually a payee
-- gap. Two independent UPDATEs let each side backfill on its own regardless
-- of what the other side is doing.
UPDATE public.settlements s
SET payer_participant_id = gp.id
FROM public.group_participants gp
WHERE gp.group_id = s.group_id AND gp.profile_id = s.payer_id;

UPDATE public.settlements s
SET payee_participant_id = gp.id
FROM public.group_participants gp
WHERE gp.group_id = s.group_id AND gp.profile_id = s.payee_id;

-- ---------------------------------------------------------------------------
-- Fail-fast: every legacy money reference that existed before this migration
-- must have found a participant above. A silently-NULL ref here would strand
-- an expense/split/settlement without a financial identity and nobody would
-- notice until a later stage depends on the ref being populated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count
    FROM public.expenses
    WHERE paid_by_id IS NOT NULL AND paid_by_participant_id IS NULL;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'group_participants backfill incomplete: % expenses.paid_by_id row(s) without paid_by_participant_id', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.expense_splits
    WHERE user_id IS NOT NULL AND participant_id IS NULL;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'group_participants backfill incomplete: % expense_splits.user_id row(s) without participant_id', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.settlements
    WHERE payer_id IS NOT NULL AND payer_participant_id IS NULL;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'group_participants backfill incomplete: % settlements.payer_id row(s) without payer_participant_id', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.settlements
    WHERE payee_id IS NOT NULL AND payee_participant_id IS NULL;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'group_participants backfill incomplete: % settlements.payee_id row(s) without payee_participant_id', v_count;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Same-group composite FKs: a participant ref must belong to the same group
-- as the row that uses it. This is the actual guarantee against wiring an
-- expense/split/settlement to a participant from a different group.
--
-- expenses.group_id and settlements.group_id are neither NOT NULL nor
-- guarded from every writer: RLS keeps an authenticated client from ever
-- reaching the FK layer with group_id = NULL (expenses_update_member and
-- settlements_update_party both require is_group_member(group_id), false for
-- NULL), but service_role bypasses RLS entirely, and MATCH SIMPLE skips FK
-- enforcement the instant any one column in the pair is NULL. Without a
-- second guard, a service_role writer could set group_id = NULL alongside a
-- *_participant_id pointing at a participant from any other group and the FK
-- would never even look at it. The CHECK constraints below close that gap:
-- they force group_id to be NOT NULL wherever a participant ref is set,
-- independent of who is writing, while still allowing the legitimate
-- transitional state (group_id set, participant ref NULL) that MATCH SIMPLE
-- itself protects for the ordinary pre-dual-write case.
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_paid_by_participant_same_group
        FOREIGN KEY (group_id, paid_by_participant_id)
        REFERENCES public.group_participants (group_id, id)
        ON DELETE RESTRICT;

ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_paid_by_participant_requires_group
        CHECK (paid_by_participant_id IS NULL OR group_id IS NOT NULL);

-- expense_splits.group_id is kept honest against the parent expense's actual
-- group by a trigger below, not by a second FK. A second FK here
-- (expense_id, group_id) -> expenses (id, group_id) would give PostgREST two
-- distinct relationships between expense_splits and expenses; the client's
-- `expenses ( ... expense_splits ( ... ) )` embed in GROUP_SELECT does not
-- (and per this stage's scope cannot) disambiguate which one to use, and
-- PostgREST refuses to embed at all when a target has more than one FK path
-- from the parent. The client is out of scope for this migration.
CREATE OR REPLACE FUNCTION private.check_expense_splits_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_expense_group_id UUID;
BEGIN
    SELECT group_id INTO v_expense_group_id
    FROM public.expenses
    WHERE id = NEW.expense_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'expense_splits.expense_id % does not reference an existing expense', NEW.expense_id;
    END IF;

    -- NULL stays legal: it is the untouched legacy transitional write this
    -- stage still allows. Anything non-NULL must match the parent exactly.
    IF NEW.group_id IS NOT NULL
       AND (v_expense_group_id IS NULL OR NEW.group_id <> v_expense_group_id) THEN
        RAISE EXCEPTION 'expense_splits.group_id (%) does not match parent expense group_id (%)',
            NEW.group_id, v_expense_group_id;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.check_expense_splits_group_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expense_splits_check_group_id ON public.expense_splits;
CREATE TRIGGER expense_splits_check_group_id
    BEFORE INSERT OR UPDATE OF expense_id, group_id ON public.expense_splits
    FOR EACH ROW EXECUTE FUNCTION private.check_expense_splits_group_id();

-- The trigger above only guards expense_splits writes. Without this second
-- guard, changing expenses.group_id after creation would silently strand
-- every expense_splits.group_id (and participant_id, via the same-group FK
-- below) already backfilled against the old group. Rather than cascading —
-- which could smuggle an expense's splits into a group its participants
-- never belonged to — the move is rejected outright; nothing in this
-- application reassigns an expense to a different group.
CREATE OR REPLACE FUNCTION private.forbid_expense_group_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
        RAISE EXCEPTION 'expenses.group_id cannot be changed after creation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.forbid_expense_group_id_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expenses_forbid_group_id_change ON public.expenses;
CREATE TRIGGER expenses_forbid_group_id_change
    BEFORE UPDATE OF group_id ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION private.forbid_expense_group_id_change();

-- Unlike expenses/settlements above, expense_splits.group_id is ALSO a new
-- nullable column added by this migration (there is no old, always-populated
-- group_id on this table, and no existing RLS check references it — the
-- table's policies join through expense_id instead). So the transitional
-- "old write" state here is genuinely group_id = NULL, participant_id =
-- NULL together, and MATCH SIMPLE's per-column-nullable skip would let a
-- crafted group_id = NULL, participant_id = <foreign group's participant>
-- row straight through. MATCH FULL closes that gap while still allowing the
-- legitimate both-NULL transitional row.
ALTER TABLE public.expense_splits
    ADD CONSTRAINT expense_splits_participant_same_group
        FOREIGN KEY (group_id, participant_id)
        REFERENCES public.group_participants (group_id, id)
        MATCH FULL
        ON DELETE RESTRICT;

ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_payer_participant_same_group
        FOREIGN KEY (group_id, payer_participant_id)
        REFERENCES public.group_participants (group_id, id)
        ON DELETE RESTRICT;

ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_payer_participant_requires_group
        CHECK (payer_participant_id IS NULL OR group_id IS NOT NULL);

ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_payee_participant_same_group
        FOREIGN KEY (group_id, payee_participant_id)
        REFERENCES public.group_participants (group_id, id)
        ON DELETE RESTRICT;

ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_payee_participant_requires_group
        CHECK (payee_participant_id IS NULL OR group_id IS NOT NULL);

CREATE INDEX expenses_paid_by_participant_id_idx ON public.expenses (paid_by_participant_id);
CREATE INDEX expense_splits_participant_id_idx ON public.expense_splits (participant_id);
CREATE INDEX expense_splits_group_id_idx ON public.expense_splits (group_id);
CREATE INDEX settlements_payer_participant_id_idx ON public.settlements (payer_participant_id);
CREATE INDEX settlements_payee_participant_id_idx ON public.settlements (payee_participant_id);

-- ---------------------------------------------------------------------------
-- RLS: deny by default. authenticated may SELECT participants of their own
-- group; there are no INSERT/UPDATE/DELETE policies and no table grant for
-- those operations, so direct writes are rejected before any policy runs.
-- No public RPC is introduced at this stage.
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_participants ENABLE ROW LEVEL SECURITY;

-- Supabase's project-level default privileges grant SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE to anon and authenticated on every table the instant it is
-- created, before this migration's own statements run. REVOKE ALL must name
-- every role that could be holding one of those default grants -
-- "authenticated" included - not just the roles this migration intends to
-- leave with nothing.
REVOKE ALL ON public.group_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.group_participants TO authenticated;

-- service_role has BYPASSRLS, but BYPASSRLS only skips policy evaluation; it
-- does not substitute for a table grant. Pin the expected privilege
-- explicitly instead of depending on ambient default privileges happening to
-- cover service_role too.
GRANT ALL ON public.group_participants TO service_role;

CREATE POLICY "group_participants_select_member" ON public.group_participants
    FOR SELECT TO authenticated
    USING (public.is_group_member(group_id));
