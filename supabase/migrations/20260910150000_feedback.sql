-- Обратная связь от пользователей и гостей.
--
-- Принцип тот же, что у waitlist после 20260815000000_harden_waitlist.sql:
-- клиент не пишет в таблицу напрямую. Единственный вход — SECURITY DEFINER
-- функция submit_feedback с проверками длины и формы. Чтение закрыто всем,
-- кроме service role: содержимое отзывов не должно быть доступно анониму
-- даже частично.

CREATE TABLE public.feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Категория фиксированным словарём: свободная строка здесь стала бы
    -- вторым message и обошла бы ограничение длины.
    category text NOT NULL CHECK (category IN ('idea', 'bug', 'praise', 'other')),
    message text NOT NULL CHECK (char_length(message) BETWEEN 3 AND 2000),
    -- Контакт необязателен: отзыв можно оставить анонимно.
    contact text CHECK (contact IS NULL OR char_length(contact) <= 320),
    -- Если отзыв оставил вошедший пользователь — фиксируем связь, но не
    -- требуем её: форма доступна и с лендинга без входа.
    user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    -- Страница/платформа, откуда пришёл отзыв (web, android) — для триажа.
    source text CHECK (source IS NULL OR char_length(source) <= 40)
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Ни одной политики для anon/authenticated: прямые SELECT/INSERT/UPDATE/DELETE
-- запрещены deny-by-default. Явный REVOKE делает намерение видимым.
REVOKE ALL ON public.feedback FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_feedback(
    p_category text,
    p_message text,
    p_contact text DEFAULT NULL,
    p_source text DEFAULT NULL
)
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

-- Функция доступна и анониму (форма на лендинге), и вошедшим.
GRANT EXECUTE ON FUNCTION public.submit_feedback(text, text, text, text) TO anon, authenticated;
