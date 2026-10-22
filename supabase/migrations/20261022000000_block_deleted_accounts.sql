-- Удалённый аккаунт не получает никакого доступа, даже со старым токеном.
--
-- Дефект: после delete_my_account() + auth.admin.deleteUser уже выданный
-- access JWT остаётся валидным до истечения (~1 ч). Если у пользователя были
-- деньги в общем событии, его group_members сохраняется (20261009000000), а
-- проверки доступа смотрят только на членство и auth.uid(). Со старым токеном
-- удалённый аккаунт мог читать и менять общие данные и восстановить профиль.
--
-- Что делает миграция:
--   1. private.deleted_accounts — реестр удалённых uid. Клиентам недоступен;
--      заполняется внутри delete_my_account() в той же транзакции.
--   2. На каждой таблице public с RLS — RESTRICTIVE-политика для authenticated:
--      удалённый uid не видит и не меняет ни одной строки.
--   3. В начале каждой SECURITY DEFINER функции, доступной authenticated (они
--      обходят RLS), и в create_group_with_owner — проверка
--      private.assert_account_active(). Публичные обёртки is_group_member,
--      is_group_owner, shares_group_with, redeem_group_invite проверяются через
--      свои private-реализации.
--   4. delete_my_account(): повтор для uid из реестра — 'already_deleted' без
--      ошибки и без повторной обработки.
--
-- Деньги, обезличенные строки и ссылки на удалённый uid не меняются.
--
-- Тела функций ниже скопированы из последних миграций без изменений, кроме
-- строки PERFORM private.assert_account_active() (и реестра в delete_my_account).

-- 1. Реестр.
CREATE TABLE IF NOT EXISTS private.deleted_accounts (
  user_id uuid PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.deleted_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.deleted_accounts FROM PUBLIC, anon, authenticated;

-- Удалён ли вызывающий. Для anon (auth.uid() = NULL) — false. Нужна
-- authenticated: на неё ссылаются политики. Сообщает только про себя.
CREATE OR REPLACE FUNCTION private.is_deleted_account()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM private.deleted_accounts WHERE user_id = auth.uid());
$$;

-- Ошибка 42501 для удалённого аккаунта, иначе true (удобно в CASE внутри SQL-функций).
CREATE OR REPLACE FUNCTION private.assert_account_active()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF private.is_deleted_account() THEN
    RAISE EXCEPTION 'Аккаунт удалён' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.is_deleted_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.assert_account_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_deleted_account() TO authenticated;
GRANT EXECUTE ON FUNCTION private.assert_account_active() TO authenticated;

-- 2. RESTRICTIVE-политика на всех таблицах public с RLS. (SELECT ...) —
--    один вызов на запрос, а не на строку.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS deny_deleted_account ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY deny_deleted_account ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (NOT (SELECT private.is_deleted_account()))
         WITH CHECK (NOT (SELECT private.is_deleted_account()))',
      r.relname);
  END LOOP;
END
$$;

-- 3. Проверки доступа. CASE гарантирует, что проверка выполнится первой.
CREATE OR REPLACE FUNCTION private.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT CASE WHEN private.assert_account_active() THEN EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = auth.uid()
    ) END;
$$;

CREATE OR REPLACE FUNCTION private.is_group_owner(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT CASE WHEN private.assert_account_active() THEN (EXISTS (
        SELECT 1 FROM public.groups
        WHERE id = p_group_id AND created_by = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'owner'
    )) END;
$$;

CREATE OR REPLACE FUNCTION private.shares_group_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT CASE WHEN private.assert_account_active() THEN EXISTS (
        SELECT 1
        FROM public.group_members AS mine
        JOIN public.group_members AS theirs USING (group_id)
        WHERE mine.user_id = auth.uid() AND theirs.user_id = p_user_id
    ) END;
$$;

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
    PERFORM private.assert_account_active();

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

CREATE OR REPLACE FUNCTION public.create_group_with_owner(p_name text, p_category text, p_default_currency text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_group_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;
    PERFORM private.assert_account_active();

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

CREATE OR REPLACE FUNCTION public.add_expense_with_splits(p_group_id uuid, p_title text, p_amount numeric, p_currency text, p_amount_in_group_currency numeric, p_category text, p_paid_by_id uuid, p_splits jsonb, p_created_at timestamp with time zone DEFAULT now(), p_split_mode text DEFAULT NULL::text)
RETURNS uuid
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
    PERFORM private.assert_account_active();

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

CREATE OR REPLACE FUNCTION public.update_expense_with_splits(p_expense_id uuid, p_title text, p_amount numeric, p_currency text, p_amount_in_group_currency numeric, p_category text, p_paid_by_id uuid, p_splits jsonb, p_created_at timestamp with time zone DEFAULT now(), p_split_mode text DEFAULT NULL::text)
RETURNS uuid
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
    PERFORM private.assert_account_active();

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

CREATE OR REPLACE FUNCTION public.record_settlement(p_group_id uuid, p_payer_id uuid, p_payee_id uuid, p_amount numeric, p_currency text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_payer RECORD;
    v_payee RECORD;
    v_currency TEXT;
    v_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;
    PERFORM private.assert_account_active();

    -- Проверка до блокировок и повторно после — как в add_expense_with_splits.
    IF p_group_id IS NULL OR NOT public.is_group_member(p_group_id) THEN
        RAISE EXCEPTION 'Событие не найдено или недоступно' USING ERRCODE = '42501';
    END IF;
    PERFORM private.lock_group_for_money_write(p_group_id);
    IF NOT public.is_group_member(p_group_id) THEN
        RAISE EXCEPTION 'Событие не найдено или недоступно' USING ERRCODE = '42501';
    END IF;

    IF private.group_is_locked(p_group_id) THEN
        RAISE EXCEPTION 'Событие закрыто: переводы с гостями нельзя отмечать. Владелец может открыть его снова.'
            USING ERRCODE = 'P0423';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Сумма перевода должна быть положительной' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_payer FROM private.resolve_money_party(p_group_id, p_payer_id);
    SELECT * INTO v_payee FROM private.resolve_money_party(p_group_id, p_payee_id);
    IF v_payer.party_participant_id IS NULL OR v_payee.party_participant_id IS NULL THEN
        RAISE EXCEPTION 'Участник перевода не состоит в событии' USING ERRCODE = '22023';
    END IF;
    IF v_payer.party_participant_id = v_payee.party_participant_id THEN
        RAISE EXCEPTION 'Плательщик и получатель совпадают' USING ERRCODE = '22023';
    END IF;

    -- Между двумя аккаунтами — прежнее правило: только от своего имени.
    -- За гостя (у него нет аккаунта) отмечает любой участник события.
    IF v_payer.party_profile_id IS NOT NULL AND v_payee.party_profile_id IS NOT NULL
       AND v_payer.party_profile_id <> v_uid THEN
        RAISE EXCEPTION 'Отметить перевод между аккаунтами может только плательщик' USING ERRCODE = '42501';
    END IF;

    IF (SELECT count(*) FROM public.settlements s
        WHERE s.created_by = v_uid AND s.created_at > now() - interval '10 minutes') >= 30 THEN
        RAISE EXCEPTION 'Слишком много переводов подряд. Попробуйте позже.' USING ERRCODE = 'P0429';
    END IF;

    SELECT COALESCE(NULLIF(BTRIM(p_currency), ''), g.default_currency, 'RUB') INTO v_currency
    FROM public.groups g WHERE g.id = p_group_id;

    INSERT INTO public.settlements (
        group_id, payer_id, payee_id, payer_participant_id, payee_participant_id,
        amount, currency, payment_method, status, created_by
    )
    VALUES (
        p_group_id, v_payer.party_profile_id, v_payee.party_profile_id,
        v_payer.party_participant_id, v_payee.party_participant_id,
        p_amount, v_currency, COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'sbp'), 'completed', v_uid
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_guest(p_participant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_group_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
    END IF;
    PERFORM private.assert_account_active();

    SELECT gp.group_id INTO v_group_id
    FROM public.group_participants gp
    WHERE gp.id = p_participant_id AND gp.kind = 'guest';

    IF v_group_id IS NULL OR NOT public.is_group_member(v_group_id) THEN
        RAISE EXCEPTION 'Гость не найден или недоступен' USING ERRCODE = 'P0002';
    END IF;
    PERFORM private.lock_group_for_money_write(v_group_id);
    IF NOT public.is_group_member(v_group_id) THEN
        RAISE EXCEPTION 'Гость не найден или недоступен' USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (SELECT 1 FROM public.expenses WHERE paid_by_participant_id = p_participant_id)
       OR EXISTS (SELECT 1 FROM public.expense_splits WHERE participant_id = p_participant_id)
       OR EXISTS (
           SELECT 1 FROM public.settlements
           WHERE payer_participant_id = p_participant_id OR payee_participant_id = p_participant_id
       ) THEN
        RAISE EXCEPTION 'У гостя есть расходы — сначала перенесите или удалите их' USING ERRCODE = 'P0409';
    END IF;

    DELETE FROM public.group_participants WHERE id = p_participant_id AND kind = 'guest';
END;
$$;

CREATE OR REPLACE FUNCTION public.add_virtual_member(p_group_id uuid, p_member_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_participant_id uuid;
  v_name text := btrim(coalesce(p_member_name, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
  END IF;
  PERFORM private.assert_account_active();

  IF char_length(v_name) < 1 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Имя участника должно быть от 1 до 80 символов.' USING ERRCODE = '22023';
  END IF;

  -- Добавлять гостей может создатель события или любой его участник.
  IF NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND created_by = auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid())
  THEN
    RAISE EXCEPTION 'Недостаточно прав для добавления участников.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.group_participants (group_id, display_name, kind, created_by)
  VALUES (p_group_id, v_name, 'guest', auth.uid())
  RETURNING id INTO v_participant_id;

  RETURN json_build_object('id', v_participant_id, 'name', v_name, 'avatar', '👤', 'role', 'member');
END;
$$;

-- join_waitlist и submit_feedback доступны и anon: для него auth.uid() = NULL,
-- проверка ничего не меняет.
CREATE OR REPLACE FUNCTION public.join_waitlist(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  PERFORM private.assert_account_active();
  v_email := lower(btrim(coalesce(p_email, '')));

  IF char_length(v_email) < 6
     OR char_length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;

  -- Молчание про дубликат — намеренное: вызывающий не должен различать
  -- «записали» и «уже было», иначе функция снова становится оракулом.
  INSERT INTO public.waitlist (email)
  VALUES (v_email)
  ON CONFLICT (email) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_feedback(p_category text, p_message text, p_contact text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_message text := btrim(coalesce(p_message, ''));
    v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
    v_category text := lower(btrim(coalesce(p_category, '')));
    v_source text := nullif(btrim(coalesce(p_source, '')), '');
BEGIN
    PERFORM private.assert_account_active();

    IF v_category NOT IN ('idea', 'bug', 'praise', 'other') THEN
        RAISE EXCEPTION 'Недопустимая категория отзыва.';
    END IF;

    IF char_length(v_message) < 3 OR char_length(v_message) > 2000 THEN
        RAISE EXCEPTION 'Текст отзыва должен быть от 3 до 2000 символов.';
    END IF;

    IF v_contact IS NOT NULL AND char_length(v_contact) > 320 THEN
        RAISE EXCEPTION 'Контакт слишком длинный.';
    END IF;

    INSERT INTO public.feedback (category, message, contact, user_id, source)
    VALUES (v_category, v_message, v_contact, auth.uid(), left(v_source, 40));
END;
$$;

-- 4. delete_my_account(): тело из 20261009000000 плюс реестр.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_profile_found boolean;
  v_deleted_name constant text := 'Удалённый пользователь';
  v_solo uuid[];
  v_shared uuid[];
  v_group uuid;
  v_successor uuid;
  v_profile_kept boolean;
  v_promoted int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
  END IF;

  -- Блокировка профиля: два одновременных вызова не работают по устаревшему
  -- снимку. Реестр проверяется после неё: второй вызов увидит запись первого.
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid FOR UPDATE;
  v_profile_found := FOUND;

  -- Уже удалён: повтор после сбоя Edge Function не должен падать. Профиль с
  -- деньгами остаётся обезличенным, поэтому одного NOT FOUND недостаточно.
  IF EXISTS (SELECT 1 FROM private.deleted_accounts WHERE user_id = v_uid) THEN
    RETURN json_build_object('status', 'already_deleted');
  END IF;

  -- С этого момента у uid нет доступа (политики deny_deleted_account и
  -- assert_account_active), даже если токен ещё жив.
  INSERT INTO private.deleted_accounts (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;

  IF NOT v_profile_found THEN
    RETURN json_build_object('status', 'already_deleted');
  END IF;

  -- Блокируем затронутые события до классификации: иначе человек, вступивший
  -- в «личное» событие между проверкой и удалением, потерял бы свои данные.
  -- Порядок по id исключает взаимоблокировки.
  PERFORM 1 FROM public.groups g
  WHERE g.id IN (
    SELECT id FROM public.groups WHERE created_by = v_uid
    UNION
    SELECT group_id FROM public.group_members WHERE user_id = v_uid
    UNION
    SELECT group_id FROM public.group_participants WHERE profile_id = v_uid
  )
  ORDER BY g.id
  FOR UPDATE;

  -- События, к которым пользователь причастен, делятся на личные и общие.
  -- Общее — если в нём есть другой аккаунт в любой роли: участник, создатель
  -- события (даже если сам вышел) или создатель гостя.
  WITH mine AS (
    SELECT id FROM public.groups WHERE created_by = v_uid
    UNION
    SELECT group_id FROM public.group_members WHERE user_id = v_uid AND group_id IS NOT NULL
    UNION
    SELECT group_id FROM public.group_participants WHERE profile_id = v_uid
  ),
  classified AS (
    SELECT m.id,
           EXISTS (SELECT 1 FROM public.group_members gm
                   WHERE gm.group_id = m.id AND gm.user_id <> v_uid)
        OR EXISTS (SELECT 1 FROM public.group_participants gp
                   WHERE gp.group_id = m.id
                     AND ((gp.profile_id IS NOT NULL AND gp.profile_id <> v_uid) OR gp.created_by <> v_uid))
        OR EXISTS (SELECT 1 FROM public.groups g
                   WHERE g.id = m.id AND g.created_by IS NOT NULL AND g.created_by <> v_uid)
           AS shared
    FROM mine m
  )
  SELECT
    coalesce(array_agg(id) FILTER (WHERE NOT shared), '{}'),
    coalesce(array_agg(id) FILTER (WHERE shared), '{}')
  INTO v_solo, v_shared
  FROM classified;

  -- 1. Личные события удаляются целиком. Порядок явный: расходы и переводы
  --    ссылаются на group_participants с RESTRICT, а закрытое событие
  --    защищено триггером блокировки — его сначала открываем.
  IF cardinality(v_solo) > 0 THEN
    UPDATE public.groups SET status = 'active' WHERE id = ANY (v_solo) AND status IS DISTINCT FROM 'active';
    DELETE FROM public.expense_splits es USING public.expenses e
      WHERE es.expense_id = e.id AND e.group_id = ANY (v_solo);
    DELETE FROM public.expenses WHERE group_id = ANY (v_solo);
    DELETE FROM public.settlements WHERE group_id = ANY (v_solo);
    DELETE FROM public.group_invites WHERE group_id = ANY (v_solo);
    DELETE FROM public.group_participants WHERE group_id = ANY (v_solo);
    DELETE FROM public.group_members WHERE group_id = ANY (v_solo);
    DELETE FROM public.groups WHERE id = ANY (v_solo);
  END IF;

  -- 2–3. Общие события.
  FOREACH v_group IN ARRAY v_shared LOOP
    v_successor := NULL;
    SELECT gm.user_id INTO v_successor
    FROM public.group_members gm
    WHERE gm.group_id = v_group AND gm.user_id <> v_uid
    ORDER BY gm.joined_at NULLS LAST, gm.user_id
    LIMIT 1;

    IF v_successor IS NULL THEN
      -- Другие аккаунты есть только как стороны денег, без членства.
      SELECT gp.profile_id INTO v_successor
      FROM public.group_participants gp
      WHERE gp.group_id = v_group AND gp.profile_id IS NOT NULL AND gp.profile_id <> v_uid
      ORDER BY gp.created_at, gp.profile_id
      LIMIT 1;
    END IF;

    IF v_successor IS NULL THEN
      -- Другой аккаунт — только создатель события или гостя.
      SELECT coalesce(
               (SELECT created_by FROM public.groups WHERE id = v_group AND created_by <> v_uid),
               (SELECT gp.created_by FROM public.group_participants gp
                WHERE gp.group_id = v_group AND gp.created_by <> v_uid
                ORDER BY gp.created_at LIMIT 1))
        INTO v_successor;
    END IF;

    UPDATE public.groups SET created_by = v_successor WHERE id = v_group AND created_by = v_uid;
    UPDATE public.group_participants SET created_by = v_successor
      WHERE group_id = v_group AND created_by = v_uid;

    IF EXISTS (SELECT 1 FROM public.group_members
               WHERE group_id = v_group AND user_id = v_uid AND role = 'owner') THEN
      UPDATE public.group_members SET role = 'owner' WHERE group_id = v_group AND user_id = v_successor;
      GET DIAGNOSTICS v_promoted = ROW_COUNT;
      -- Понижаем себя, только если владелец среди участников появился:
      -- событие не должно остаться без owner-участника.
      IF v_promoted > 0 THEN
        UPDATE public.group_members SET role = 'member' WHERE group_id = v_group AND user_id = v_uid;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.expenses WHERE group_id = v_group AND paid_by_id = v_uid)
       OR EXISTS (SELECT 1 FROM public.expense_splits es JOIN public.expenses e ON e.id = es.expense_id
                  WHERE e.group_id = v_group AND es.user_id = v_uid)
       OR EXISTS (SELECT 1 FROM public.settlements
                  WHERE group_id = v_group AND (payer_id = v_uid OR payee_id = v_uid))
    THEN
      -- Деньги остаются, имя — нет.
      UPDATE public.group_participants
        SET display_name = v_deleted_name, avatar_url = NULL
        WHERE group_id = v_group AND profile_id = v_uid;
    ELSE
      DELETE FROM public.group_members WHERE group_id = v_group AND user_id = v_uid;
      DELETE FROM public.group_participants WHERE group_id = v_group AND profile_id = v_uid;
    END IF;
  END LOOP;

  -- 4. Прочие личные следы.
  DELETE FROM public.group_invites WHERE created_by = v_uid;
  UPDATE public.feedback SET user_id = NULL, contact = NULL WHERE user_id = v_uid;
  IF v_email IS NOT NULL THEN
    -- Отзывы и заявки, оставленные без входа с этим адресом.
    UPDATE public.feedback SET contact = NULL WHERE lower(contact) = lower(v_email);
    DELETE FROM public.waitlist WHERE lower(email) = lower(v_email);
  END IF;

  -- 5. Профиль.
  v_profile_kept :=
       EXISTS (SELECT 1 FROM public.groups WHERE created_by = v_uid)
    OR EXISTS (SELECT 1 FROM public.group_members WHERE user_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.group_participants WHERE profile_id = v_uid OR created_by = v_uid)
    OR EXISTS (SELECT 1 FROM public.expenses WHERE paid_by_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.expense_splits WHERE user_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.settlements WHERE payer_id = v_uid OR payee_id = v_uid);

  IF v_profile_kept THEN
    UPDATE public.profiles
      SET full_name = v_deleted_name,
          avatar_url = NULL,
          phone = NULL,
          email = NULL,
          telegram_id = NULL
      WHERE id = v_uid;
  ELSE
    DELETE FROM public.profiles WHERE id = v_uid;
  END IF;

  RETURN json_build_object(
    'status', 'deleted',
    'deleted_groups', cardinality(v_solo),
    'anonymized', v_profile_kept
  );
END;
$$;

-- Права те же, что были: CREATE OR REPLACE их сохраняет, но Supabase при
-- пересоздании может вернуть anon — повторяем явно.
REVOKE EXECUTE ON FUNCTION public.create_group_with_owner(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_expense_with_splits(uuid, text, numeric, text, numeric, text, uuid, jsonb, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_expense_with_splits(uuid, text, numeric, text, numeric, text, uuid, jsonb, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_settlement(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_guest(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_virtual_member(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_group_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_group_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.shares_group_with(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.redeem_group_invite(text) FROM PUBLIC, anon;
