-- 1.1.1: индексы под внешние ключи, у которых их не было (проверка prod 2026-11-10,
-- v1.1/perf/baseline-net.txt). Без индекса проверка ключа при удалении/изменении
-- родительской строки и выборки «расходы события / строки периода» читают таблицу целиком.
--
-- Без CONCURRENTLY: миграция идёт одной транзакцией, таблицы маленькие (блокировка
-- записи на время построения — доли секунды). Смысл данных и права не меняются.
-- Откат: supabase/rollback/20261110000000_fk_indexes.down.sql.

CREATE INDEX IF NOT EXISTS expense_splits_group_participant_idx ON public.expense_splits (group_id, participant_id);
CREATE INDEX IF NOT EXISTS expenses_group_paid_by_participant_idx ON public.expenses (group_id, paid_by_participant_id);
CREATE INDEX IF NOT EXISTS settlements_group_payer_participant_idx ON public.settlements (group_id, payer_participant_id);
CREATE INDEX IF NOT EXISTS settlements_group_payee_participant_idx ON public.settlements (group_id, payee_participant_id);

CREATE INDEX IF NOT EXISTS project_contribution_ledger_project_period_idx ON public.project_contribution_ledger (project_id, period_id);
CREATE INDEX IF NOT EXISTS project_contribution_ledger_project_terms_idx ON public.project_contribution_ledger (project_id, terms_id);
CREATE INDEX IF NOT EXISTS project_operations_project_member_idx ON public.project_operations (project_id, member_id);
CREATE INDEX IF NOT EXISTS project_operations_project_refund_of_idx ON public.project_operations (project_id, refund_of);
CREATE INDEX IF NOT EXISTS project_periods_project_terms_idx ON public.project_periods (project_id, terms_id);
CREATE INDEX IF NOT EXISTS project_quantities_member_project_idx ON public.project_quantities (member_id, project_id);
CREATE INDEX IF NOT EXISTS project_quantities_period_project_idx ON public.project_quantities (period_id, project_id);
CREATE INDEX IF NOT EXISTS project_term_approvals_project_terms_idx ON public.project_term_approvals (project_id, terms_id);
CREATE INDEX IF NOT EXISTS project_term_lines_member_project_idx ON public.project_term_lines (member_id, project_id);
CREATE INDEX IF NOT EXISTS project_term_lines_terms_project_idx ON public.project_term_lines (terms_id, project_id);
CREATE INDEX IF NOT EXISTS project_transfers_from_member_project_idx ON public.project_transfers (from_member, project_id);
CREATE INDEX IF NOT EXISTS project_transfers_period_project_idx ON public.project_transfers (period_id, project_id);
CREATE INDEX IF NOT EXISTS project_transfers_to_member_project_idx ON public.project_transfers (to_member, project_id);
