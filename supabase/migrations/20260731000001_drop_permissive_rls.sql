-- Supabase Migration: снятие permissive-политик RLS
-- Version: 20260731000001
--
-- Зачем отдельная миграция, если политики уже переписаны в init-миграции.
--
-- Первая редакция 20260731000000 содержала пять политик, открывавших groups,
-- group_members, expenses, expense_splits и settlements всем на чтение,
-- изменение и удаление. Permissive-политики в PostgreSQL объединяются через OR,
-- поэтому каждая из них в одиночку обнуляла соседнюю политику «только участники
-- группы».
--
-- Init-миграция исправлена, так что на чистой базе этих политик уже не будет и
-- миграция ниже отработает вхолостую. Она нужна для баз, куда первая редакция
-- успела примениться: без неё такая база остаётся полностью открытой, а по
-- номеру версии выглядит обновлённой.
--
-- Все операции идемпотентны.

DROP POLICY IF EXISTS "Allow all actions for demo/authenticated" ON public.groups;
DROP POLICY IF EXISTS "Allow all actions for demo members" ON public.group_members;
DROP POLICY IF EXISTS "Allow all actions for demo expenses" ON public.expenses;
DROP POLICY IF EXISTS "Allow all actions for demo splits" ON public.expense_splits;
DROP POLICY IF EXISTS "Allow all actions for demo settlements" ON public.settlements;

-- Публичное чтение профилей: таблица хранит email и телефон.
DROP POLICY IF EXISTS "Allow public select profiles" ON public.profiles;

-- Заменена на политику с WITH CHECK.
DROP POLICY IF EXISTS "Allow individual update profiles" ON public.profiles;

-- Заменена на groups_select_member.
DROP POLICY IF EXISTS "Allow group members to read groups" ON public.groups;

-- Две таблицы в первой редакции вовсе не имели RLS.
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

-- Проверка после применения: политик с квалификатором `true` на финансовых
-- таблицах остаться не должно.
--
--   SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE schemaname = 'public' AND qual = 'true'
--     AND tablename <> 'exchange_rates';
--
-- Ожидаемый результат — пустая выборка. exchange_rates исключён намеренно:
-- это справочник курсов, его читают все аутентифицированные пользователи.
