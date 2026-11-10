-- Откат 20261110000000_fk_indexes.sql: только индексы, данные и права не затрагиваются.

DROP INDEX IF EXISTS public.expense_splits_group_participant_idx;
DROP INDEX IF EXISTS public.expenses_group_paid_by_participant_idx;
DROP INDEX IF EXISTS public.settlements_group_payer_participant_idx;
DROP INDEX IF EXISTS public.settlements_group_payee_participant_idx;
DROP INDEX IF EXISTS public.project_contribution_ledger_project_period_idx;
DROP INDEX IF EXISTS public.project_contribution_ledger_project_terms_idx;
DROP INDEX IF EXISTS public.project_operations_project_member_idx;
DROP INDEX IF EXISTS public.project_operations_project_refund_of_idx;
DROP INDEX IF EXISTS public.project_periods_project_terms_idx;
DROP INDEX IF EXISTS public.project_quantities_member_project_idx;
DROP INDEX IF EXISTS public.project_quantities_period_project_idx;
DROP INDEX IF EXISTS public.project_term_approvals_project_terms_idx;
DROP INDEX IF EXISTS public.project_term_lines_member_project_idx;
DROP INDEX IF EXISTS public.project_term_lines_terms_project_idx;
DROP INDEX IF EXISTS public.project_transfers_from_member_project_idx;
DROP INDEX IF EXISTS public.project_transfers_period_project_idx;
DROP INDEX IF EXISTS public.project_transfers_to_member_project_idx;
