-- Откат 20261101000000_projects.sql — БЕЗОПАСНЫЙ: «Проект» выключается, данные
-- остаются. Применять вручную (SQL editor / psql), только с бэкапом.
--
-- Что откат делает:
--   - отзывает EXECUTE у всех функций проекта (public-обёртки и private-реализации):
--     ни участник, ни посторонний, ни anon ничего не вызывают;
--   - удаляет политики чтения *_select_member: при deny-by-default таблицы проекта
--     не читает никто из клиентов, в том числе удалённые аккаунты.
--
-- Что откат НЕ делает (сознательно):
--   - не удаляет таблицы и строки: деньги, журнал долга и итоги людей нельзя
--     восстановить; удаление — отдельное решение владельца;
--   - не снимает deny_deleted_account / deny_deleted_account_write с таблиц
--     проекта и триггер обезличивания на private.deleted_accounts: удалённый
--     аккаунт не должен получить доступ ни при каком состоянии;
--   - не снимает триггеры неизменяемости (журнал, условия, закрытые периоды);
--   - не трогает таблицы и функции событий.
-- Запись в supabase_migrations.schema_migrations остаётся: повторный db push
-- миграцию не накатывает. Вернуть «Проект» — повторить GRANT EXECUTE и
-- CREATE POLICY *_select_member из миграции.

DO $$
DECLARE
  f record;
  t text;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname IN (
             'create_project', 'preview_project_invite', 'join_project_by_invite', 'create_project_invite',
             'disable_project_invite', 'propose_terms', 'accept_terms', 'decline_terms', 'add_operation',
             'edit_operation', 'delete_operation', 'set_quantity', 'close_period', 'mark_transfer_paid'))
       OR (n.nspname = 'private' AND (p.proname LIKE 'project\_%' OR p.proname IN (
             'is_project_member', 'create_project', 'preview_project_invite', 'join_project_by_invite',
             'create_project_invite', 'disable_project_invite', 'propose_terms', 'decide_terms', 'add_operation',
             'edit_operation', 'delete_operation', 'set_quantity', 'close_period', 'mark_transfer_paid')))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'projects', 'project_members', 'project_invites', 'project_terms', 'project_term_lines',
    'project_term_approvals', 'project_periods', 'project_operations', 'project_quantities',
    'project_contribution_ledger', 'project_transfers', 'project_audit'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_member', t);
  END LOOP;
END
$$;
