-- Ужесточение таблицы waitlist.
--
-- Что было не так после 20260809000000_create_waitlist_table.sql:
--
--   CREATE POLICY "Allow anonymous inserts to waitlist" ON public.waitlist
--       FOR INSERT TO anon, authenticated WITH CHECK (true);
--
-- 1. `WITH CHECK (true)` для anon — запись в базу без единого ограничения:
--    ни формата, ни длины. Любой скрипт набивает таблицу произвольными
--    строками произвольного размера.
-- 2. `email TEXT UNIQUE` вместе с прямым INSERT даёт оракул: по коду ошибки
--    23505 посторонний проверяет, есть ли конкретный адрес в списке. Утекают
--    не данные, а факт — для списка ожидания это тоже персональные данные.
--
-- Что делает эта миграция:
--   * запрещает прямую запись клиентом (политика INSERT снимается);
--   * оставляет единственный вход — SECURITY DEFINER функцию join_waitlist,
--     которая нормализует адрес, проверяет его и молчит про дубликат
--     (ON CONFLICT DO NOTHING), поэтому оракул исчезает;
--   * добавляет CHECK-ограничения на длину и форму адреса.
--
-- Историю не переписываем: старые миграции остаются как есть, это отдельный
-- новый файл (правило из AGENTS.md).

-- --------------------------------------------------------------------------
-- 1. Ограничения значения.
-- NOT VALID: существующие строки не проверяются на месте, чтобы миграция не
-- падала на легаси-данных. На все новые и изменяемые строки ограничение
-- действует сразу. Отдельный шаг `VALIDATE CONSTRAINT` выполняется вручную
-- после preflight по фактическим строкам — см. P0-4 в todo.md.
-- --------------------------------------------------------------------------

ALTER TABLE public.waitlist
  ADD CONSTRAINT waitlist_email_length
  CHECK (char_length(email) BETWEEN 6 AND 254) NOT VALID;

ALTER TABLE public.waitlist
  ADD CONSTRAINT waitlist_email_format
  CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') NOT VALID;

-- --------------------------------------------------------------------------
-- 2. Прямая запись клиентом больше не разрешена.
-- После этого на таблице остаётся только политика "Deny client read waitlist"
-- из 20260809000001: RLS включён, политик записи нет, значит клиенту закрыто
-- всё. Единственный путь внутрь — функция ниже, она SECURITY DEFINER и RLS
-- не касается.
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow anonymous inserts to waitlist" ON public.waitlist;

-- --------------------------------------------------------------------------
-- 3. Единственный вход.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.join_waitlist(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email TEXT;
BEGIN
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

REVOKE ALL ON FUNCTION public.join_waitlist(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_waitlist(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.join_waitlist(TEXT) IS
  'Единственный путь записи в waitlist. Нормализует адрес, валидирует его и не различает вставку и дубликат.';
