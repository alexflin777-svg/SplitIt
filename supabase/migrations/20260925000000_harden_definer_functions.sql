-- Закрытие замечаний Security Advisor от 25.09.2026 (аудит docs/LAUNCH_PLAN_2026-09.md).
--
-- 1. add_virtual_member — SECURITY DEFINER без фиксированного search_path
--    (function_search_path_mutable) и исполним ролью anon. Функция пересоздаётся
--    с тем же контрактом (сигнатура и форма JSON-ответа не меняются), но:
--      * search_path закреплён;
--      * имя гостя проверяется по длине (раньше в БД можно было положить
--        строку любой длины);
--      * исполнять может только authenticated.
-- 2. create_ghost_member — есть в production, но отсутствует в миграциях
--    репозитория и не вызывается клиентом (дрейф схемы). Не удаляем: откат
--    DROP невозможен без исходника. Отзываем исполнение у всех клиентских ролей.
-- 3. join_waitlist / submit_feedback — единственные публичные точки записи,
--    обязаны быть доступны anon, но не имели ограничения частоты. Добавляется
--    ограничитель по хешу IP (из заголовков PostgREST) + глобальный потолок.
--
-- Откат: supabase/rollback/20260925000000_harden_definer_functions.down.sql

-- ── 1. add_virtual_member ────────────────────────────────────────────────
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

REVOKE ALL ON FUNCTION public.add_virtual_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_virtual_member(uuid, text) TO authenticated;

-- ── 2. create_ghost_member (дрейф, только в production) ──────────────────
DO $$
BEGIN
  IF to_regprocedure('public.create_ghost_member(uuid, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_ghost_member(uuid, text) FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

-- ── 3. Ограничитель частоты для публичных точек записи ───────────────────
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.rate_limit_hits (
  bucket   text        NOT NULL,
  subject  text        NOT NULL,
  hit_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_hits_lookup
  ON private.rate_limit_hits (bucket, subject, hit_at DESC);

REVOKE ALL ON private.rate_limit_hits FROM PUBLIC, anon, authenticated;

-- Хеш IP клиента. Сам адрес не хранится (минимизация данных, GDPR).
-- Вне PostgREST (тесты, SQL-консоль) заголовков нет — субъект 'unknown'.
CREATE OR REPLACE FUNCTION private.client_fingerprint()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_headers text := current_setting('request.headers', true);
  v_ip text;
BEGIN
  IF v_headers IS NULL OR v_headers = '' THEN
    RETURN 'unknown';
  END IF;
  v_ip := split_part(coalesce(v_headers::json->>'x-forwarded-for', v_headers::json->>'cf-connecting-ip', ''), ',', 1);
  IF btrim(v_ip) = '' THEN
    RETURN 'unknown';
  END IF;
  RETURN md5('splitit-rl:' || btrim(v_ip));
EXCEPTION WHEN others THEN
  RETURN 'unknown';
END;
$$;

-- Бросает исключение P0429, если субъект превысил p_per_subject попыток за окно
-- или бакет целиком превысил p_global. Иначе засчитывает попытку.
CREATE OR REPLACE FUNCTION private.enforce_rate_limit(
  p_bucket text,
  p_per_subject integer,
  p_global integer,
  p_window interval
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, private
AS $$
DECLARE
  v_subject text := private.client_fingerprint();
BEGIN
  -- Уборка устаревших записей этого бакета: таблица не растёт бесконечно.
  DELETE FROM private.rate_limit_hits
   WHERE bucket = p_bucket AND hit_at < now() - p_window;

  IF (SELECT count(*) FROM private.rate_limit_hits
       WHERE bucket = p_bucket AND subject = v_subject AND hit_at >= now() - p_window) >= p_per_subject
     OR (SELECT count(*) FROM private.rate_limit_hits
       WHERE bucket = p_bucket AND hit_at >= now() - p_window) >= p_global
  THEN
    RAISE EXCEPTION 'Слишком много запросов. Попробуйте позже.' USING ERRCODE = 'P0429';
  END IF;

  INSERT INTO private.rate_limit_hits (bucket, subject) VALUES (p_bucket, v_subject);
END;
$$;

REVOKE ALL ON FUNCTION private.client_fingerprint() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enforce_rate_limit(text, integer, integer, interval) FROM PUBLIC, anon, authenticated;

-- Встраивание в публичные функции без переписывания их тел: BEFORE INSERT
-- триггер на целевых таблицах. Функции SECURITY DEFINER, значит триггер
-- исполняется владельцем и имеет доступ к private.
CREATE OR REPLACE FUNCTION private.rate_limit_public_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, private
AS $$
BEGIN
  IF TG_TABLE_NAME = 'waitlist' THEN
    PERFORM private.enforce_rate_limit('waitlist', 5, 300, interval '1 hour');
  ELSIF TG_TABLE_NAME = 'feedback' THEN
    PERFORM private.enforce_rate_limit('feedback', 10, 300, interval '1 hour');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.rate_limit_public_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS waitlist_rate_limit ON public.waitlist;
CREATE TRIGGER waitlist_rate_limit
  BEFORE INSERT ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION private.rate_limit_public_write();

DROP TRIGGER IF EXISTS feedback_rate_limit ON public.feedback;
CREATE TRIGGER feedback_rate_limit
  BEFORE INSERT ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION private.rate_limit_public_write();
