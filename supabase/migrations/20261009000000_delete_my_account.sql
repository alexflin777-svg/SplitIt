-- Удаление аккаунта пользователем (требование Google Play и App Store).
--
-- public.delete_my_account() удаляет профиль и личные данные ВЫЗЫВАЮЩЕГО.
-- Параметров нет: удалить можно только себя (auth.uid()), чужой id передать
-- некуда.
--
-- Что происходит:
--   1. События, где кроме пользователя нет других аккаунтов (гости не в счёт),
--      удаляются целиком вместе с расходами.
--   2. В событиях с другими людьми владение переходит к участнику, вступившему
--      раньше остальных; созданные пользователем гости переписываются на него же.
--   3. Если на пользователя в таком событии ссылаются деньги (платил, должен,
--      переводил) — участие остаётся, но имя обезличивается: итоги других
--      людей не должны поменяться ни на копейку. Если не ссылаются — участие
--      удаляется.
--   4. Приглашения пользователя удаляются (его ссылки перестают работать),
--      отзывы обезличиваются (и по user_id, и по email в contact), запись в
--      waitlist удаляется.
--
-- Что остаётся: в общих событиях — суммы, названия, чеки расходов и
-- groups.completed_by (голый uuid обезличенного профиля; триггер
-- stamp_group_completion не даёт его менять).
--   5. Профиль удаляется, если на него больше ничего не ссылается, иначе
--      обезличивается («Удалённый пользователь», без email/телефона/Telegram).
--
-- Строку auth.users из SQL клиента удалить нельзя: это делает Edge Function
-- supabase/functions/delete-account (service role) ПОСЛЕ успешного вызова этой
-- функции. Повторный вызов безопасен (идемпотентен).
--
-- Откат: supabase/rollback/20261009000000_delete_my_account.down.sql

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
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
  -- снимку.
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    -- Уже удалён: повтор после сбоя Edge Function не должен падать.
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

-- REVOKE после CREATE: Supabase выдаёт anon права на новые функции.
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
