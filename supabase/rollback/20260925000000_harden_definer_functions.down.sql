-- Откат 20260925000000_harden_definer_functions.sql.
-- Возвращает add_virtual_member в состояние 20260816210725 и снимает ограничитель.
-- Применять вручную (SQL editor / psql), затем удалить строку версии из
-- supabase_migrations.schema_migrations.

DROP TRIGGER IF EXISTS waitlist_rate_limit ON public.waitlist;
DROP TRIGGER IF EXISTS feedback_rate_limit ON public.feedback;
DROP FUNCTION IF EXISTS private.rate_limit_public_write();
DROP FUNCTION IF EXISTS private.enforce_rate_limit(text, integer, integer, interval);
DROP FUNCTION IF EXISTS private.client_fingerprint();
DROP TABLE IF EXISTS private.rate_limit_hits;

CREATE OR REPLACE FUNCTION public.add_virtual_member(p_group_id uuid, p_member_name text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_participant_id uuid;
  v_result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id AND created_by = auth.uid()) THEN
    IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Недостаточно прав для добавления участников.';
    END IF;
  END IF;
  INSERT INTO group_participants (group_id, display_name, kind, created_by)
  VALUES (p_group_id, p_member_name, 'guest', auth.uid())
  RETURNING id INTO v_participant_id;
  SELECT json_build_object('id', v_participant_id, 'name', p_member_name, 'avatar', '👤', 'role', 'member') INTO v_result;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.add_virtual_member(uuid, text) RESET search_path;
GRANT EXECUTE ON FUNCTION public.add_virtual_member(uuid, text) TO PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.create_ghost_member(uuid, text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_ghost_member(uuid, text) TO PUBLIC, anon, authenticated';
  END IF;
END
$$;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260925000000';
