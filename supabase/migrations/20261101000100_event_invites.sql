-- Приглашения событий (SplitIT 1.1.0, этап 3г): «посмотреть приглашение» и срок
-- ссылки по правилу базы. Спецификация: v1.1/stage1/SCENARIOS-AUDIT.md §4 п. 2–3.
--
-- 1. Срок ссылки события: пока событие открыто — бессрочно (expires_at = NULL),
--    после закрытия — completed_at + 30 дней. Повторное открытие снова делает
--    ссылку бессрочной. Срок считает только база:
--      - BEFORE INSERT/UPDATE на group_invites перезаписывает expires_at клиента
--        (клиент 1.0.x присылает «+14 дней» — запись проходит, срок берётся наш);
--      - AFTER UPDATE статуса на groups пересчитывает срок всех ссылок события.
--    Клиенту UPDATE group_invites не разрешён (политик нет). Отключение
--    владельцем — по-прежнему удаление строки. redeem_group_invite не меняется:
--    она уже отклоняет expires_at <= now().
-- 2. Уже истёкшие ссылки 1.0.x удаляются: по новому правилу они бы ожили
--    (событие открыто → бессрочно), а владелец считает их мёртвыми. Живые
--    получают срок по новому правилу.
-- 3. preview_group_invite(code) — для anon и authenticated: название события,
--    имя пригласившего, число участников, действует ли ссылка и до какого
--    момента. Ни сумм, ни расходов, ни списка участников. Удалённый аккаунт —
--    отказ (assert_account_active первой строкой). Реализация в private,
--    обёртка в public сама SECURITY DEFINER (у anon нет USAGE на private),
--    как preview_project_invite.
--
-- Откат: supabase/rollback/20261101000100_event_invites.down.sql

-- Срок ссылки события по его состоянию. NULL — бессрочно (событие открыто).
CREATE OR REPLACE FUNCTION private.event_invite_expiry(p_status text, p_completed_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN p_status = 'active' THEN NULL
              ELSE coalesce(p_completed_at, now()) + interval '30 days' END;
$$;
REVOKE ALL ON FUNCTION private.event_invite_expiry(text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.group_invites_set_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  -- FOR SHARE: ссылка, создаваемая во время закрытия, ждёт его и берёт новый срок,
  -- иначе AFTER-триггер закрытия её не видит и она остаётся бессрочной.
  SELECT private.event_invite_expiry(g.status, g.completed_at) INTO NEW.expires_at
  FROM public.groups g WHERE g.id = NEW.group_id
  FOR SHARE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.group_invites_set_expiry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS group_invites_set_expiry ON public.group_invites;
CREATE TRIGGER group_invites_set_expiry
  BEFORE INSERT OR UPDATE ON public.group_invites
  FOR EACH ROW EXECUTE FUNCTION private.group_invites_set_expiry();

-- Закрытие и повторное открытие события. AFTER: completed_at уже выставлен
-- BEFORE-триггером из 20260925000001_lock_completed_events.
CREATE OR REPLACE FUNCTION private.groups_sync_invite_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  -- Значение пересчитает BEFORE-триггер group_invites_set_expiry.
  UPDATE public.group_invites SET expires_at = NULL WHERE group_id = NEW.id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.groups_sync_invite_expiry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS groups_sync_invite_expiry ON public.groups;
CREATE TRIGGER groups_sync_invite_expiry
  AFTER UPDATE ON public.groups
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.completed_at IS DISTINCT FROM NEW.completed_at)
  EXECUTE FUNCTION private.groups_sync_invite_expiry();

-- Ссылки 1.0.x: истёкшие — удалить (иначе ожили бы), живые — к новому правилу.
DELETE FROM public.group_invites WHERE expires_at IS NOT NULL AND expires_at <= now();
UPDATE public.group_invites SET expires_at = NULL;

CREATE OR REPLACE FUNCTION private.preview_group_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v record;
BEGIN
  -- Для anon (auth.uid() = NULL) проверка проходит; удалённый получает отказ.
  PERFORM private.assert_account_active();
  SELECT g.id, g.name, i.created_by, i.expires_at INTO v
  FROM public.group_invites i JOIN public.groups g ON g.id = i.group_id
  WHERE i.invite_code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Приглашение недействительно или истекло' USING ERRCODE = 'P0002';
  END IF;
  -- Только эти пять полей: ни сумм, ни расходов, ни списка участников.
  RETURN jsonb_build_object(
    'event_name', v.name,
    'inviter_name', (SELECT full_name FROM public.profiles WHERE id = v.created_by),
    'member_count', (SELECT count(*) FROM public.group_members WHERE group_id = v.id)
                  + (SELECT count(*) FROM public.group_participants WHERE group_id = v.id AND kind = 'guest'),
    'is_active', v.expires_at IS NULL OR v.expires_at > now(),
    'expires_at', v.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION private.preview_group_invite(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_group_invite(p_code text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.preview_group_invite(p_code) $$;
REVOKE ALL ON FUNCTION public.preview_group_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_group_invite(text) TO anon, authenticated;
