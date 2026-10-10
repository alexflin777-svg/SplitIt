-- Переводы (settlements) с участием гостей (G3, P1-15).
--
-- До этой миграции перевод хранился только между аккаунтами: payer_id/payee_id
-- ссылаются на profiles, а RLS settlements_insert_payer требует payer = auth.uid().
-- Гость (group_participants, kind = 'guest') аккаунта не имеет, и «Отметить
-- перевод» с ним клиент честно отклонял (errors.settlementWithGuest) — долг
-- гостя нельзя было погасить никак.
--
-- Решение оркестратора (владелец может изменить позже): отметить перевод с
-- участием гостя может ЛЮБОЙ участник события — как в Splitwise. В закрытом
-- событии — запрещено (P0423).
--
-- Что меняется:
--   * settlements.payer_participant_id / payee_participant_id уже есть
--     (20260802000000, FK на group_participants той же группы). Добавляются:
--       - created_by — кто записал перевод (удалить запись может только он);
--         прежние строки заполняются payer_id: раньше записать перевод мог
--         только сам плательщик;
--       - CHECK «каждая сторона задана»: payer_id или payer_participant_id,
--         payee_id или payee_participant_id; и стороны различны. Строго «ровно
--         одна колонка» нельзя: у аккаунта по модели 20261010000000 заполнены
--         обе (profile + participant), как у расходов. NOT VALID — проверяются
--         новые и изменяемые строки, исторические данные не блокируют миграцию;
--   * RPC public.record_settlement(...) SECURITY DEFINER, search_path закреплён,
--     EXECUTE только authenticated:
--       - вызывающий — участник события (иначе 42501, как у расходов);
--       - закрытое событие — P0423;
--       - стороны — аккаунт-участник или гость ЭТОГО события
--         (private.resolve_money_party из 20261010000000);
--       - перевод между двумя аккаунтами — по-прежнему только от своего имени
--         (то же правило, что RLS settlements_insert_payer);
--       - не больше 30 записей через RPC за 10 минут на пользователя (P0429).
--         Прямая запись под RLS (только аккаунт → аккаунт от своего имени) не
--         ограничивается, как и раньше. У расходов
--         ограничителя частоты нет; общий private.enforce_rate_limit считает
--         по IP, а здесь нужен счёт по аккаунту — считаем по created_by;
--   * RLS: INSERT напрямую дополнительно требует created_by = auth.uid();
--     DELETE — created_by = auth.uid() (раньше payer_id = auth.uid(); для
--     прежних строк это одно и то же после заполнения created_by);
--   * group_participants добавлена в публикацию supabase_realtime (если она
--     есть): гость, добавленный на другом устройстве, приходит сразу.
--
-- Откат: supabase/rollback/20261012000000_guest_settlements.down.sql

-- ── Кто записал перевод ───────────────────────────────────────────────────
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.settlements
    ALTER COLUMN created_by SET DEFAULT auth.uid();

UPDATE public.settlements SET created_by = payer_id WHERE created_by IS NULL AND payer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS settlements_created_by_idx ON public.settlements (created_by, created_at DESC);

-- created_by нельзя переписать: settlements_update_party разрешает сторонам
-- перевода UPDATE любых колонок, и иначе можно было бы «подарить» свои записи
-- чужому аккаунту (его счётчик частоты переполнится) или забрать право удаления.
-- Разрешена только замена на NULL — её делает FK ON DELETE SET NULL при
-- удалении профиля автора.
CREATE OR REPLACE FUNCTION private.keep_settlement_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Автора перевода изменить нельзя' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.keep_settlement_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS settlements_keep_author ON public.settlements;
CREATE TRIGGER settlements_keep_author
    BEFORE UPDATE OF created_by ON public.settlements
    FOR EACH ROW EXECUTE FUNCTION private.keep_settlement_author();

-- ── Стороны перевода ──────────────────────────────────────────────────────
ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_payer_identified
        CHECK (payer_id IS NOT NULL OR payer_participant_id IS NOT NULL) NOT VALID;
ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_payee_identified
        CHECK (payee_id IS NOT NULL OR payee_participant_id IS NOT NULL) NOT VALID;
ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_participants_differ
        CHECK (payer_participant_id <> payee_participant_id) NOT VALID;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER POLICY "settlements_insert_payer" ON public.settlements
    WITH CHECK (
        public.is_group_member(group_id)
        AND payer_id = (SELECT auth.uid())
        AND created_by = (SELECT auth.uid())
    );
ALTER POLICY "settlements_delete_payer" ON public.settlements
    USING (created_by = (SELECT auth.uid()));

-- ── record_settlement ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_settlement(
    p_group_id UUID,
    p_payer_id UUID,
    p_payee_id UUID,
    p_amount NUMERIC,
    p_currency TEXT DEFAULT NULL,
    p_payment_method TEXT DEFAULT NULL
)
RETURNS UUID
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

REVOKE ALL ON FUNCTION public.record_settlement(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_settlement(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ── Realtime для гостей ───────────────────────────────────────────────────
-- FULL: иначе событие DELETE несёт только id, фильтр group_id=eq.… его не
-- пропускает, и удаление гостя (20261013000000) не дошло бы до других устройств.
-- Так же сделано для остальных таблиц в 20260731000002.
ALTER TABLE public.group_participants REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_participants'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.group_participants;
    END IF;
END
$$;
