-- Откат 20260925000001_lock_completed_events.sql.
DROP TRIGGER IF EXISTS expenses_locked_group ON public.expenses;
DROP TRIGGER IF EXISTS expense_splits_locked_group ON public.expense_splits;
DROP TRIGGER IF EXISTS groups_stamp_completion ON public.groups;
DROP FUNCTION IF EXISTS private.reject_write_to_locked_group();
DROP FUNCTION IF EXISTS private.stamp_group_completion();
DROP FUNCTION IF EXISTS private.group_is_locked(uuid);
ALTER TABLE public.groups DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS completed_by;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260925000001';
