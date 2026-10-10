-- Откат 20261012000000_guest_settlements.sql.
-- Применять вручную (SQL editor / psql). Последняя команда — удаление строки
-- версии из supabase_migrations.schema_migrations (вне транзакции отката).
--
-- ВНИМАНИЕ: переводы с гостями, записанные через record_settlement, остаются
-- в базе (payer_id/payee_id = NULL, *_participant_id заполнен). Клиент без
-- чтения *_participant_id покажет у них пустую сторону. Перед откатом верните
-- веб-сборку, которая отклоняет переводы с гостями.

BEGIN;

DROP FUNCTION IF EXISTS public.record_settlement(UUID, UUID, UUID, NUMERIC, TEXT, TEXT);

ALTER POLICY "settlements_insert_payer" ON public.settlements
    WITH CHECK (public.is_group_member(group_id) AND payer_id = (SELECT auth.uid()));
ALTER POLICY "settlements_delete_payer" ON public.settlements
    USING (payer_id = (SELECT auth.uid()));

ALTER TABLE public.settlements DROP CONSTRAINT IF EXISTS settlements_participants_differ;
ALTER TABLE public.settlements DROP CONSTRAINT IF EXISTS settlements_payee_identified;
ALTER TABLE public.settlements DROP CONSTRAINT IF EXISTS settlements_payer_identified;

DROP TRIGGER IF EXISTS settlements_keep_author ON public.settlements;
DROP FUNCTION IF EXISTS private.keep_settlement_author();

DROP INDEX IF EXISTS public.settlements_created_by_idx;
ALTER TABLE public.settlements DROP COLUMN IF EXISTS created_by;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_participants'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.group_participants;
    END IF;
END
$$;

ALTER TABLE public.group_participants REPLICA IDENTITY DEFAULT;

COMMIT;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261012000000';
