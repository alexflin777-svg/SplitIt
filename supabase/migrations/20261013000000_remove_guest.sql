-- Удаление гостя из события (G4).
--
-- До этой миграции удалить гостя было нечем: у group_participants есть только
-- политика SELECT, а прямой DELETE гостя с деньгами упирается в FK
-- ON DELETE RESTRICT из expenses / expense_splits / settlements (20260802000000)
-- и отдаёт пользователю сырое «violates foreign key constraint».
--
-- RPC public.remove_guest(p_participant_id):
--   * вызывающий — участник события гостя; гость чужого события и
--     несуществующий id неразличимы (P0002), как у расходов;
--   * удаляется только гость (kind = 'guest'); участник с аккаунтом — нет;
--   * если у гостя есть расход (платил), доля или перевод — отказ P0409 с
--     понятным текстом «У гостя есть расходы — сначала перенесите или удалите их»,
--     ничего не удаляется;
--   * иначе гость удаляется. Удалить гостя без денег может любой участник
--     события — то же правило, что для переводов гостя (20261012000000);
--     итоги события от этого не меняются;
--   * блокировка как при записи расхода: параллельный расход с этим гостем
--     не проскочит между проверкой и удалением (а если проскочит — FK RESTRICT
--     всё равно не даст удалить, клиент покажет тот же текст).
--
-- SECURITY DEFINER (у authenticated нет права DELETE на group_participants),
-- search_path закреплён, EXECUTE только authenticated.
--
-- Откат: supabase/rollback/20261013000000_remove_guest.down.sql

CREATE OR REPLACE FUNCTION public.remove_guest(p_participant_id UUID)
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

REVOKE ALL ON FUNCTION public.remove_guest(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_guest(UUID) TO authenticated;
