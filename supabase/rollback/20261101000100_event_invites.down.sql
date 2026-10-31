-- Откат 20261101000100_event_invites.sql.
-- Удалённые миграцией истёкшие ссылки 1.0.x не восстанавливаются: они и до неё
-- не впускали. Бессрочным ссылкам (событие открыто) возвращается правило 1.0.x —
-- 14 дней от создания, иначе после отката они остались бы вечными. Ссылки старше
-- 14 дней при этом сразу перестанут работать — владелец выпустит новую.

DROP FUNCTION IF EXISTS public.preview_group_invite(text);
DROP FUNCTION IF EXISTS private.preview_group_invite(text);

DROP TRIGGER IF EXISTS groups_sync_invite_expiry ON public.groups;
DROP FUNCTION IF EXISTS private.groups_sync_invite_expiry();

DROP TRIGGER IF EXISTS group_invites_set_expiry ON public.group_invites;
DROP FUNCTION IF EXISTS private.group_invites_set_expiry();
DROP FUNCTION IF EXISTS private.event_invite_expiry(text, timestamptz);

UPDATE public.group_invites SET expires_at = created_at + interval '14 days' WHERE expires_at IS NULL;
