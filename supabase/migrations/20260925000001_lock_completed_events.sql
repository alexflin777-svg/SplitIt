-- «Закрыть событие и подвести итог» — защита на уровне базы.
--
-- До этой миграции groups.status = 'completed' был косметикой: кнопка ставила
-- статус и запускала конфетти, а расходы закрытого события по-прежнему можно
-- было добавлять, менять и удалять — итог «плыл» после того, как его увидели.
--
-- Что меняется:
--   * groups.completed_at / completed_by — когда и кем подведён итог;
--   * триггеры на expenses и expense_splits: любая запись в событие со
--     статусом, отличным от 'active', отклоняется (ERRCODE P0423). Это
--     работает для всех ролей, включая SECURITY DEFINER функции, — UI остаётся
--     второй линией защиты, а не единственной;
--   * переоткрыть событие (status → 'active') может только владелец — это уже
--     гарантирует политика groups_update_owner.
--
-- Удаление самого события продолжает работать: при каскадном удалении строка
-- groups уже удалена, поиск статуса ничего не находит, триггер пропускает.
--
-- Откат: supabase/rollback/20260925000001_lock_completed_events.down.sql

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid;

CREATE OR REPLACE FUNCTION private.group_is_locked(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups WHERE id = p_group_id AND status IS DISTINCT FROM 'active'
  );
$$;

REVOKE ALL ON FUNCTION private.group_is_locked(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.reject_write_to_locked_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_group_ids uuid[];
  v_gid uuid;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    v_group_ids := ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.group_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.group_id END
    ];
  ELSE -- expense_splits
    SELECT array_agg(e.group_id) INTO v_group_ids
      FROM public.expenses e
     WHERE e.id IN (
       CASE WHEN TG_OP <> 'INSERT' THEN OLD.expense_id END,
       CASE WHEN TG_OP <> 'DELETE' THEN NEW.expense_id END
     );
  END IF;

  FOREACH v_gid IN ARRAY coalesce(v_group_ids, '{}'::uuid[]) LOOP
    IF v_gid IS NOT NULL AND private.group_is_locked(v_gid) THEN
      RAISE EXCEPTION 'Событие закрыто: расходы нельзя менять. Владелец может открыть его снова.'
        USING ERRCODE = 'P0423';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_write_to_locked_group() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expenses_locked_group ON public.expenses;
CREATE TRIGGER expenses_locked_group
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION private.reject_write_to_locked_group();

DROP TRIGGER IF EXISTS expense_splits_locked_group ON public.expense_splits;
CREATE TRIGGER expense_splits_locked_group
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_splits
  FOR EACH ROW EXECUTE FUNCTION private.reject_write_to_locked_group();

-- Метки времени закрытия проставляет база, а не клиент: клиентским часам и
-- клиентскому id верить нельзя.
CREATE OR REPLACE FUNCTION private.stamp_group_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      NEW.completed_at := NULL;
      NEW.completed_by := NULL;
    ELSIF OLD.status = 'active' THEN
      NEW.completed_at := now();
      NEW.completed_by := auth.uid();
    END IF;
  ELSE
    NEW.completed_at := OLD.completed_at;
    NEW.completed_by := OLD.completed_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_group_completion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS groups_stamp_completion ON public.groups;
CREATE TRIGGER groups_stamp_completion
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION private.stamp_group_completion();
