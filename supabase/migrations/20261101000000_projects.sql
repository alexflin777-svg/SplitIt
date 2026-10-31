-- «Проект» (SplitIT 1.1.0): таблицы, RLS, триггеры неизменяемости и RPC.
-- Спецификация: v1.1/stage1/PROJECT-SPEC.md §5, §6, §7.
--
-- Устройство:
--   1. Двенадцать новых таблиц public.project*. Таблицы событий не меняются.
--      Все ссылки внутри проекта — составные ключи (project_id, id): участник,
--      период, условия или операция чужого проекта отклоняются самой базой.
--   2. RLS на каждой таблице. Клиенту — только SELECT, и только участнику
--      проекта (private.project_visible_seq: сначала assert_account_active).
--      Вышедший читает только периоды до выхода включительно (решение
--      31.10.2026): их операции, количества, условия, журнал, отметки и
--      историю; будущее проекта и ссылки-приглашения — нет.
--      Прав на INSERT/UPDATE/DELETE у anon/authenticated нет вовсе: любая
--      запись — только через функции ниже. Защиту от удалённых аккаунтов
--      (RESTRICTIVE deny_deleted_account + триггер deny_deleted_account_write)
--      миграция 20261022000000 ставила циклом по таблицам того времени —
--      здесь она повторена явно для каждой новой таблицы.
--   3. Неизменяемость — триггерами, они срабатывают для всех ролей, включая
--      SECURITY DEFINER и владельца схемы: принятые версии условий, журнал
--      долга, согласия, история, отметки переводов, закрытый период и его
--      операции и количества.
--   4. Функции: реализация SECURITY DEFINER в private, тонкая обёртка в public
--      (как redeem_group_invite). preview_project_invite доступна anon,
--      поэтому её обёртка сама SECURITY DEFINER: у anon нет USAGE на private.
--      Порядок проверок в каждой: активный аккаунт → членство и права →
--      связи → состояние периода.
--   5. Итог периода (close_period) считается В БАЗЕ по данным базы — тот же
--      алгоритм, что src/lib/project-calc.ts (§3а.2); клиентских цифр функция
--      не принимает, только ревизию предпросмотра. Почему не «снимок клиента +
--      проверка Σ = 0»: инварианты сумм не мешают владельцу перераспределить
--      деньги между людьми, сохранив все суммы.
--   6. Сериализация: каждая пишущая функция блокирует строку projects
--      (FOR SHARE — операции и количества, FOR UPDATE — условия и итог) и
--      только после этого читает открытый период. Запись либо входит в
--      закрываемый период до фиксации, либо после неё попадает в новый.
--
-- Суммы — bigint, копейки, > 0; тип операции — отдельное поле. Количества —
-- в сотых (150 = 1,5 ч).

-- ---------------------------------------------------------------- 1. Таблицы

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  currency text NOT NULL DEFAULT 'RUB' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Без внешнего ключа на profiles: delete_my_account может удалить профиль,
  -- а данные проекта других людей должны остаться.
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id),
  kind text NOT NULL CHECK (kind IN ('user', 'guest')),
  user_id uuid,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  position int NOT NULL CHECK (position > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  -- Номер последнего периода вышедшего: дальше он проект не читает.
  left_after_seq int,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'user') = (user_id IS NOT NULL)),
  CHECK ((status = 'left') = (left_after_seq IS NOT NULL)),
  UNIQUE (project_id, user_id),
  UNIQUE (project_id, position),
  UNIQUE (project_id, id)
);
CREATE INDEX project_members_user_idx ON public.project_members (user_id);

CREATE TABLE public.project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id),
  code text NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 16 AND 64),
  created_by uuid NOT NULL,
  expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_invites_project_idx ON public.project_invites (project_id);

CREATE TABLE public.project_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected', 'superseded')),
  proposed_by uuid NOT NULL,
  -- 1 — условия периода 1 (до первого итога их можно заменить новой версией);
  -- у изменений ставится при активации = следующий период.
  effective_from_seq int CHECK (effective_from_seq > 0),
  preset text NOT NULL DEFAULT 'custom' CHECK (preset IN ('equal', 'a', 'b', 'v', 'custom')),
  contrib_enabled boolean NOT NULL DEFAULT false,
  remainder_method text NOT NULL DEFAULT 'equal' CHECK (remainder_method IN ('equal', 'percent', 'contrib', 'hours')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (project_id, id)
);
CREATE INDEX project_terms_project_idx ON public.project_terms (project_id);

CREATE TABLE public.project_term_lines (
  project_id uuid NOT NULL,
  terms_id uuid NOT NULL,
  member_id uuid NOT NULL,
  expenses_back boolean NOT NULL DEFAULT true,
  rate_type text NOT NULL DEFAULT 'none' CHECK (rate_type IN ('none', 'fixed', 'hourly', 'piece')),
  rate_amount bigint NOT NULL DEFAULT 0 CHECK (rate_amount BETWEEN 0 AND 10000000000),
  in_remainder boolean NOT NULL DEFAULT true,
  share_bp int NOT NULL DEFAULT 0 CHECK (share_bp BETWEEN 0 AND 10000),
  contrib_new bigint NOT NULL DEFAULT 0 CHECK (contrib_new BETWEEN 0 AND 100000000000),
  contrib_kind text NOT NULL DEFAULT 'money' CHECK (contrib_kind IN ('money', 'item')),
  contrib_note text CHECK (char_length(contrib_note) <= 200),
  debt_write_off bigint NOT NULL DEFAULT 0 CHECK (debt_write_off >= 0),
  -- Участник выходит: left ставит close_period периода, в котором версия
  -- принята (§4). Явный флаг, а не «нет строки»: вошедший после предложения
  -- версии тоже без строки, но не выходит.
  leaves boolean NOT NULL DEFAULT false,
  PRIMARY KEY (terms_id, member_id),
  FOREIGN KEY (project_id, terms_id) REFERENCES public.project_terms (project_id, id),
  FOREIGN KEY (project_id, member_id) REFERENCES public.project_members (project_id, id),
  CHECK (rate_type <> 'none' OR rate_amount = 0),
  CHECK (NOT leaves OR (NOT in_remainder AND share_bp = 0 AND rate_type = 'none' AND contrib_new = 0))
);

CREATE TABLE public.project_term_approvals (
  project_id uuid NOT NULL,
  terms_id uuid NOT NULL,
  user_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accept', 'decline')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (terms_id, user_id),
  FOREIGN KEY (project_id, terms_id) REFERENCES public.project_terms (project_id, id)
);

CREATE TABLE public.project_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id),
  seq int NOT NULL CHECK (seq > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid,
  terms_id uuid NOT NULL,
  -- Счётчик изменений всего, от чего зависит итог (§5): операции, количества,
  -- состав, действующие условия, журнал долга. Растёт триггерами.
  revision bigint NOT NULL DEFAULT 0,
  snapshot jsonb,
  UNIQUE (project_id, seq),
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, terms_id) REFERENCES public.project_terms (project_id, id),
  CHECK ((status = 'closed') = (snapshot IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX project_periods_one_open ON public.project_periods (project_id) WHERE status = 'open';

CREATE TABLE public.project_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  period_id uuid NOT NULL,
  op_type text NOT NULL CHECK (op_type IN ('income', 'expense', 'income_refund')),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 100000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- Курс не округляется; округляется только сумма в валюте проекта.
  exchange_rate numeric NOT NULL DEFAULT 1 CHECK (exchange_rate > 0 AND exchange_rate <= 1000000),
  amount_in_project_currency bigint GENERATED ALWAYS AS (round(amount * exchange_rate)::bigint) STORED
    CHECK (amount_in_project_currency > 0),
  member_id uuid NOT NULL,
  refund_of uuid,
  occurred_on date NOT NULL DEFAULT current_date,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  note text CHECK (char_length(note) <= 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id) REFERENCES public.projects (id),
  FOREIGN KEY (project_id, period_id) REFERENCES public.project_periods (project_id, id),
  FOREIGN KEY (project_id, member_id) REFERENCES public.project_members (project_id, id),
  FOREIGN KEY (project_id, refund_of) REFERENCES public.project_operations (project_id, id),
  CHECK ((op_type = 'income_refund') = (refund_of IS NOT NULL))
);
CREATE INDEX project_operations_period_idx ON public.project_operations (project_id, period_id);
CREATE INDEX project_operations_refund_idx ON public.project_operations (refund_of) WHERE refund_of IS NOT NULL;

CREATE TABLE public.project_quantities (
  project_id uuid NOT NULL,
  period_id uuid NOT NULL,
  member_id uuid NOT NULL,
  hours int NOT NULL DEFAULT 0 CHECK (hours BETWEEN 0 AND 999900),
  pieces bigint NOT NULL DEFAULT 0 CHECK (pieces BETWEEN 0 AND 100000000),
  entered_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, member_id),
  FOREIGN KEY (project_id, period_id) REFERENCES public.project_periods (project_id, id),
  FOREIGN KEY (project_id, member_id) REFERENCES public.project_members (project_id, id)
);

CREATE TABLE public.project_contribution_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL,
  member_id uuid NOT NULL,
  period_id uuid NOT NULL,
  terms_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('credit', 'repay', 'write_off')),
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, member_id) REFERENCES public.project_members (project_id, id),
  FOREIGN KEY (project_id, period_id) REFERENCES public.project_periods (project_id, id),
  FOREIGN KEY (project_id, terms_id) REFERENCES public.project_terms (project_id, id)
);
CREATE INDEX project_ledger_project_idx ON public.project_contribution_ledger (project_id, member_id);

CREATE TABLE public.project_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  period_id uuid NOT NULL,
  from_member uuid NOT NULL,
  to_member uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  marked_by uuid NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, from_member, to_member),
  FOREIGN KEY (project_id, period_id) REFERENCES public.project_periods (project_id, id),
  FOREIGN KEY (project_id, from_member) REFERENCES public.project_members (project_id, id),
  FOREIGN KEY (project_id, to_member) REFERENCES public.project_members (project_id, id)
);

CREATE TABLE public.project_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects (id),
  actor_id uuid,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Период записи (ставит project_log под блокировкой проекта): по нему, а не
  -- по created_at, вышедший видит историю — now() одинаков во всей транзакции.
  period_seq int NOT NULL CHECK (period_seq > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_audit_project_idx ON public.project_audit (project_id, id);

-- ---------------------------------------------------------------- 2. Доступ

-- Последний период, который видит вызывающий: участнику — все (2147483647),
-- вышедшему — до выхода включительно, чужому — NULL. Вышедший отмечает свои
-- переводы по этим периодам (§4), но будущее проекта ему не видно.
CREATE FUNCTION private.project_visible_seq(p_project_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN private.assert_account_active() THEN (
    SELECT CASE status WHEN 'active' THEN 2147483647 ELSE left_after_seq END
    FROM public.project_members
    WHERE project_id = p_project_id AND user_id = auth.uid()
  ) END;
$$;

-- Строка периода p_period_id видна вызывающему.
CREATE FUNCTION private.project_period_visible(p_project_id uuid, p_period_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, private
AS $$
  -- Явно первой: при пустом p_period_id EXISTS не дошёл бы до project_visible_seq.
  SELECT CASE WHEN private.assert_account_active() THEN EXISTS (
    SELECT 1 FROM public.project_periods
    WHERE id = p_period_id AND project_id = p_project_id AND seq <= private.project_visible_seq(p_project_id)
  ) END;
$$;

-- Версия условий видна участнику вся, вышедшему — если по ней шёл видимый ему период.
CREATE FUNCTION private.project_terms_visible(p_project_id uuid, p_terms_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, private
AS $$
  SELECT s.v = 2147483647 OR EXISTS (
    SELECT 1 FROM public.project_periods
    WHERE project_id = p_project_id AND terms_id = p_terms_id AND seq <= s.v
  )
  FROM (SELECT private.project_visible_seq(p_project_id) AS v) s;
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.project_visible_seq(uuid)', 'private.project_period_visible(uuid, uuid)',
    'private.project_terms_visible(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$$;

DO $$
DECLARE
  t text;
  expr text;
BEGIN
  FOR t, expr IN SELECT * FROM (VALUES
    ('projects', 'private.project_visible_seq(id) IS NOT NULL'),
    ('project_members', 'private.project_visible_seq(project_id) IS NOT NULL'),
    ('project_invites', 'private.project_visible_seq(project_id) = 2147483647'),
    ('project_terms', 'private.project_terms_visible(project_id, id)'),
    ('project_term_lines', 'private.project_terms_visible(project_id, terms_id)'),
    ('project_term_approvals', 'private.project_terms_visible(project_id, terms_id)'),
    ('project_periods', 'seq <= private.project_visible_seq(project_id)'),
    ('project_operations', 'private.project_period_visible(project_id, period_id)'),
    ('project_quantities', 'private.project_period_visible(project_id, period_id)'),
    ('project_contribution_ledger', 'private.project_period_visible(project_id, period_id)'),
    ('project_transfers', 'private.project_period_visible(project_id, period_id)'),
    ('project_audit', 'period_seq <= private.project_visible_seq(project_id)')
  ) AS x(t, expr) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', t || '_select_member', t, expr);
    -- Как в 20261022000000, но явно: та миграция новые таблицы не покрывает.
    EXECUTE format(
      'CREATE POLICY deny_deleted_account ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (NOT (SELECT private.is_deleted_account()))
         WITH CHECK (NOT (SELECT private.is_deleted_account()))', t);
    EXECUTE format(
      'CREATE TRIGGER deny_deleted_account_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION private.deny_deleted_account_write()', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------- 3. Триггеры

-- Таблицы «только вставка»: журнал долга, согласия, история, отметки переводов.
CREATE FUNCTION private.project_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_TABLE_NAME = 'project_contribution_ledger' THEN
    RAISE EXCEPTION 'Журнал долга по вкладам не меняется и не удаляется' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'Записи % неизменяемы', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.project_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER project_ledger_append_only BEFORE UPDATE OR DELETE ON public.project_contribution_ledger
  FOR EACH ROW EXECUTE FUNCTION private.project_append_only();
CREATE TRIGGER project_ledger_no_truncate BEFORE TRUNCATE ON public.project_contribution_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION private.project_append_only();
CREATE TRIGGER project_approvals_append_only BEFORE UPDATE OR DELETE ON public.project_term_approvals
  FOR EACH ROW EXECUTE FUNCTION private.project_append_only();
CREATE TRIGGER project_audit_append_only BEFORE UPDATE OR DELETE ON public.project_audit
  FOR EACH ROW EXECUTE FUNCTION private.project_append_only();
CREATE TRIGGER project_transfers_append_only BEFORE UPDATE OR DELETE ON public.project_transfers
  FOR EACH ROW EXECUTE FUNCTION private.project_append_only();

-- TRUNCATE обходит построчные триггеры: запрещён на всех таблицах проекта,
-- включая владельца БД (журнал — project_ledger_no_truncate выше).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'project_members', 'project_invites', 'project_terms', 'project_term_lines',
    'project_term_approvals', 'project_periods', 'project_operations', 'project_quantities',
    'project_transfers', 'project_audit'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I
                      FOR EACH STATEMENT EXECUTE FUNCTION private.project_append_only()', t || '_no_truncate', t);
  END LOOP;
END
$$;

-- Всё, от чего зависит итог открытого периода, увеличивает его revision:
-- close_period по предпросмотру, сделанному до изменения, отклоняется.
-- Операции и количества — в project_period_rows_guard; здесь состав (вход,
-- выход), действующие условия (активация и замена, в том числе условий
-- периода 1) и журнал долга.
CREATE FUNCTION private.project_bump_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.project_periods SET revision = revision + 1 WHERE project_id = NEW.project_id AND status = 'open';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.project_bump_revision() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER project_members_revision AFTER INSERT OR UPDATE OF status ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION private.project_bump_revision();
CREATE TRIGGER project_terms_revision AFTER UPDATE OF status ON public.project_terms
  FOR EACH ROW WHEN (NEW.status = 'active' OR OLD.status = 'active') EXECUTE FUNCTION private.project_bump_revision();
CREATE TRIGGER project_ledger_revision AFTER INSERT ON public.project_contribution_ledger
  FOR EACH ROW EXECUTE FUNCTION private.project_bump_revision();

-- Версия условий: блоки не меняются никогда, статус — только по допустимым переходам.
CREATE FUNCTION private.project_terms_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Версии условий неизменяемы: удалить нельзя' USING ERRCODE = '42501';
  END IF;
  IF (NEW.project_id, NEW.proposed_by, NEW.preset, NEW.contrib_enabled, NEW.remainder_method, NEW.created_at)
     IS DISTINCT FROM
     (OLD.project_id, OLD.proposed_by, OLD.preset, OLD.contrib_enabled, OLD.remainder_method, OLD.created_at)
     OR (OLD.status <> 'proposed' AND NEW.effective_from_seq IS DISTINCT FROM OLD.effective_from_seq)
     OR NOT (
       (OLD.status = 'proposed' AND NEW.status IN ('proposed', 'active', 'rejected', 'superseded'))
       OR (OLD.status = 'active' AND NEW.status = 'superseded')
     ) THEN
    RAISE EXCEPTION 'Версии условий неизменяемы: изменение — только новой версией' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.project_terms_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER project_terms_guard BEFORE UPDATE OR DELETE ON public.project_terms
  FOR EACH ROW EXECUTE FUNCTION private.project_terms_guard();

-- Строки версии: вставка — только в версию proposed (её пишет propose_terms), правка и удаление — никогда.
CREATE FUNCTION private.project_term_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR EXISTS (
    SELECT 1 FROM public.project_terms WHERE id = NEW.terms_id AND status <> 'proposed'
  ) THEN
    RAISE EXCEPTION 'Строки условий неизменяемы: изменение — только новой версией' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.project_term_lines_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER project_term_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_term_lines
  FOR EACH ROW EXECUTE FUNCTION private.project_term_lines_guard();

-- Период: закрытый не меняется, никакой не удаляется; проект и номер — никогда.
CREATE FUNCTION private.project_periods_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Периоды не удаляются' USING ERRCODE = 'P0423';
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Период закрыт: он не меняется' USING ERRCODE = 'P0423';
  END IF;
  IF (NEW.project_id, NEW.seq, NEW.opened_at) IS DISTINCT FROM (OLD.project_id, OLD.seq, OLD.opened_at) THEN
    RAISE EXCEPTION 'Период: проект и номер не меняются' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.project_periods_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER project_periods_guard BEFORE UPDATE OR DELETE ON public.project_periods
  FOR EACH ROW EXECUTE FUNCTION private.project_periods_guard();

-- Операции и количества: период ставит база (текущий открытый), в закрытом
-- ничего не меняется; любое изменение увеличивает revision периода.
CREATE FUNCTION private.project_period_rows_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_period uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'project_operations' THEN
      -- Значение клиента игнорируется: только текущий открытый период.
      SELECT id INTO NEW.period_id FROM public.project_periods
      WHERE project_id = NEW.project_id AND status = 'open';
    END IF;
    v_period := NEW.period_id;
  ELSE
    IF TG_OP = 'UPDATE' AND (NEW.project_id, NEW.period_id) IS DISTINCT FROM (OLD.project_id, OLD.period_id) THEN
      RAISE EXCEPTION 'Запись нельзя перенести в другой период или проект' USING ERRCODE = '42501';
    END IF;
    -- Вложенный IF: plpgsql вычисляет условие целиком, а у количеств нет op_type.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'project_operations' THEN
      IF (NEW.op_type, NEW.refund_of, NEW.created_by) IS DISTINCT FROM (OLD.op_type, OLD.refund_of, OLD.created_by) THEN
        RAISE EXCEPTION 'Тип операции, исходный доход и автор не меняются' USING ERRCODE = '42501';
      END IF;
    END IF;
    v_period := OLD.period_id;
  END IF;

  IF v_period IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.project_periods WHERE id = v_period AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Период закрыт: записи в нём не меняются' USING ERRCODE = 'P0423';
  END IF;

  UPDATE public.project_periods SET revision = revision + 1 WHERE id = v_period;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION private.project_period_rows_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER project_operations_period_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_operations
  FOR EACH ROW EXECUTE FUNCTION private.project_period_rows_guard();
CREATE TRIGGER project_quantities_period_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_quantities
  FOR EACH ROW EXECUTE FUNCTION private.project_period_rows_guard();

-- Удаление аккаунта: имя в проектах обезличивается в той же транзакции, деньги
-- остаются (как group_participants в delete_my_account). Триггер на реестре —
-- чтобы не переписывать delete_my_account.
CREATE FUNCTION private.project_anonymize_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.project_members SET display_name = 'Удалённый пользователь' WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.project_anonymize_deleted() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER project_anonymize_deleted AFTER INSERT ON private.deleted_accounts
  FOR EACH ROW EXECUTE FUNCTION private.project_anonymize_deleted();

-- ---------------------------------------------------------------- 4. Помощники (клиенту недоступны)

-- Вызывающий — участник проекта с аккаунтом. Проверка до блокировки (чужой не
-- встаёт в очередь на чужой проект) и после (статус мог измениться в ожидании).
CREATE FUNCTION private.project_caller(p_project_id uuid, p_exclusive boolean, p_allow_left boolean DEFAULT false)
RETURNS public.project_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v public.project_members;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
  END IF;
  FOR k IN 1..2 LOOP
    SELECT * INTO v FROM public.project_members
    WHERE project_id = p_project_id AND user_id = auth.uid() AND (status = 'active' OR p_allow_left);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Проект не найден или недоступен' USING ERRCODE = '42501';
    END IF;
    IF k = 1 THEN
      IF p_exclusive THEN
        PERFORM 1 FROM public.projects WHERE id = p_project_id FOR UPDATE;
      ELSE
        PERFORM 1 FROM public.projects WHERE id = p_project_id FOR SHARE;
      END IF;
    END IF;
  END LOOP;
  RETURN v;
END;
$$;

-- Открытый период. Вызывать после блокировки проекта: новый запрос — свежий снимок.
CREATE FUNCTION private.project_open_period(p_project_id uuid)
RETURNS public.project_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v public.project_periods;
BEGIN
  SELECT * INTO v FROM public.project_periods WHERE project_id = p_project_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'В проекте нет открытого периода' USING ERRCODE = 'P0423';
  END IF;
  RETURN v;
END;
$$;

-- p_period_seq — период, к которому относится запись; по умолчанию последний
-- (открытый) на момент записи, до первого периода — 1. Вызывающие держат
-- блокировку проекта, поэтому итог не проскочит между выбором seq и записью.
CREATE FUNCTION private.project_log(p_project_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb,
                                    p_period_seq int DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.project_audit (project_id, actor_id, action, payload, period_seq)
  VALUES (p_project_id, auth.uid(), p_action, coalesce(p_payload, '{}'::jsonb), coalesce(
    p_period_seq, (SELECT max(seq) FROM public.project_periods WHERE project_id = p_project_id), 1));
$$;

-- Баланс журнала долга (credit − repay − write_off) участника.
CREATE FUNCTION private.project_debt(p_project_id uuid, p_member_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(sum(CASE kind WHEN 'credit' THEN amount ELSE -amount END), 0)::bigint
  FROM public.project_contribution_ledger
  WHERE project_id = p_project_id AND member_id = p_member_id;
$$;

-- 1000000 → «10 000 ₽», 333333 → «3 333,33 ₽» (как formatRub в project-calc.ts).
CREATE FUNCTION private.project_rub(p_cents bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN p_cents < 0 THEN '−' ELSE '' END
    || regexp_replace((abs(p_cents) / 100)::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
    || CASE WHEN abs(p_cents) % 100 <> 0 THEN ',' || lpad((abs(p_cents) % 100)::text, 2, '0') ELSE '' END
    || ' ₽';
$$;

-- Деление total ≥ 0 пропорционально целым весам ≥ 0 (Σ > 0) методом наибольшего
-- остатка; ничья — меньшему индексу (вход в порядке position). Точная
-- целочисленная арифметика numeric, как BigInt в allocate() клиента.
CREATE FUNCTION private.project_allocate(p_total bigint, p_weights numeric[])
RETURNS bigint[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  WITH w AS (
    SELECT i, wt FROM unnest(p_weights) WITH ORDINALITY AS u(wt, i)
  ), s AS (
    SELECT sum(wt) AS tot FROM w
  ), q AS (
    SELECT i, div(p_total * wt, tot) AS base, mod(p_total * wt, tot) AS rem FROM w, s
  ), r AS (
    SELECT i, base, row_number() OVER (ORDER BY rem DESC, i) AS rk FROM q
  )
  SELECT array_agg((base + CASE WHEN rk <= p_total - (SELECT sum(base) FROM q) THEN 1 ELSE 0 END)::bigint ORDER BY i)
  FROM r;
$$;

-- То же для любого знака: при минусе делится модуль, ставится минус.
CREATE FUNCTION private.project_allocate_signed(p_total bigint, p_weights numeric[])
RETURNS bigint[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, private
AS $$
  SELECT CASE
    WHEN p_total = 0 THEN array_fill(0::bigint, ARRAY[cardinality(p_weights)])
    WHEN p_total > 0 THEN private.project_allocate(p_total, p_weights)
    ELSE (SELECT array_agg(-x ORDER BY i) FROM unnest(private.project_allocate(-p_total, p_weights)) WITH ORDINALITY AS u(x, i))
  END;
$$;

-- Записывает версию условий и проверяет её (§3а.7). Строки ссылаются на
-- участников по member_id. Ошибка — исключение, транзакция откатывается.
CREATE FUNCTION private.project_insert_terms(p_project_id uuid, p_terms jsonb, p_effective_from_seq int)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_id uuid;
  v_method text := coalesce(p_terms->>'remainder_method', 'equal');
  v_contrib boolean := coalesce((p_terms->>'contrib_enabled')::boolean, false);
  v_owner uuid;
  v_sum bigint;
  r record;
BEGIN
  IF jsonb_typeof(p_terms->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_terms->'lines') = 0 THEN
    RAISE EXCEPTION 'Кто-то должен получать остаток' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_terms (project_id, proposed_by, effective_from_seq, preset, contrib_enabled, remainder_method)
  VALUES (p_project_id, auth.uid(), p_effective_from_seq, coalesce(p_terms->>'preset', 'custom'), v_contrib, v_method)
  RETURNING id INTO v_id;

  -- Дробные копейки и не-числа отклоняет приведение к bigint/int.
  INSERT INTO public.project_term_lines (
    project_id, terms_id, member_id, expenses_back, rate_type, rate_amount, in_remainder, share_bp,
    contrib_new, contrib_kind, contrib_note, debt_write_off, leaves
  )
  SELECT p_project_id, v_id, x.member_id, coalesce(x.expenses_back, true), coalesce(x.rate_type, 'none'),
         coalesce(x.rate_amount, 0), coalesce(x.in_remainder, true), coalesce(x.share_bp, 0),
         coalesce(x.contrib_new, 0), coalesce(x.contrib_kind, 'money'), nullif(btrim(x.contrib_note), ''),
         coalesce(x.debt_write_off, 0), coalesce(x.leaves, false)
  FROM jsonb_to_recordset(p_terms->'lines') AS x(
    member_id uuid, expenses_back boolean, rate_type text, rate_amount bigint, in_remainder boolean, share_bp int,
    contrib_new bigint, contrib_kind text, contrib_note text, debt_write_off bigint, leaves boolean
  );

  IF EXISTS (
    SELECT 1 FROM public.project_term_lines l JOIN public.project_members m ON m.id = l.member_id
    WHERE l.terms_id = v_id AND m.status <> 'active'
  ) THEN
    RAISE EXCEPTION 'Условия — только для участников проекта, по одной строке на человека' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF EXISTS (
    SELECT 1 FROM public.project_term_lines l JOIN public.project_members m ON m.id = l.member_id
    WHERE l.terms_id = v_id AND l.leaves AND m.user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'Владелец не может выйти из проекта' USING ERRCODE = '22023';
  END IF;
  IF p_effective_from_seq = 1 AND EXISTS (SELECT 1 FROM public.project_term_lines WHERE terms_id = v_id AND leaves) THEN
    RAISE EXCEPTION 'Выйти можно только после первого итога' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.project_term_lines WHERE terms_id = v_id AND in_remainder) THEN
    RAISE EXCEPTION 'Кто-то должен получать остаток' USING ERRCODE = '22023';
  END IF;

  IF v_method = 'percent' THEN
    SELECT coalesce(sum(share_bp), 0) INTO v_sum FROM public.project_term_lines WHERE terms_id = v_id AND in_remainder;
    IF v_sum <> 10000 THEN
      RAISE EXCEPTION 'Сейчас % %%, нужно 100 %%', replace(trim_scale(v_sum / 100.0)::text, '.', ',') USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.project_term_lines WHERE terms_id = v_id AND in_remainder <> (share_bp > 0)) THEN
      RAISE EXCEPTION 'Доля > 0 — только у участвующих в остатке' USING ERRCODE = '22023';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.project_term_lines WHERE terms_id = v_id AND share_bp <> 0) THEN
    RAISE EXCEPTION 'Доля в процентах — только для способа «по %%»' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_term_lines
    WHERE terms_id = v_id AND contrib_kind = 'item' AND (contrib_new <= 0 OR contrib_note IS NULL)
  ) THEN
    RAISE EXCEPTION 'Опиши вещь и укажи оценку' USING ERRCODE = '22023';
  END IF;

  -- Списание: X ≤ текущего долга; при выключении блока 2 и у выходящего X = весь долг.
  FOR r IN
    SELECT m.display_name, private.project_debt(p_project_id, m.id) AS debt,
           coalesce(l.debt_write_off, 0) AS x, coalesce(l.leaves, false) AS leaves
    FROM public.project_members m
    LEFT JOIN public.project_term_lines l ON l.terms_id = v_id AND l.member_id = m.id
    WHERE m.project_id = p_project_id
    ORDER BY m.position
  LOOP
    IF r.x > r.debt THEN
      RAISE EXCEPTION 'Можно списать не больше %', private.project_rub(r.debt) USING ERRCODE = '22023';
    END IF;
    IF r.debt > 0 AND (NOT v_contrib OR r.leaves) AND r.x < r.debt THEN
      RAISE EXCEPTION 'Сначала верните или спишите весь долг: % %', r.display_name, private.project_rub(r.debt)
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN v_id;
END;
$$;

-- Активирует версию, если её приняли все участники с аккаунтом (удалённые не
-- считаются). Версия периода 1 заменяет действующие условия периода 1; изменение
-- вступает со следующего периода. Вклады версии периода 1 пишет close_period.
--
-- Продуктовые решения 31.10.2026 (отклонения от §7 спецификации, приняты):
--   - до первого итога условия периода 1 можно заменить новой версией (её
--     принимают все участники с аккаунтом); замена увеличивает revision
--     (триггер project_terms_revision), итог по старому предпросмотру не
--     фиксируется;
--   - credit вкладов первоначальной версии пишется при первом итоге, а не при
--     активации. Цифры те же: в расчёте периода 1 эти вклады уже входят в долг
--     D_i (project_calc, p_initial_credit). Зато заменённая до итога версия не
--     оставляет вкладов в неизменяемом журнале.
CREATE FUNCTION private.project_try_activate(p_terms_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_terms public.project_terms;
  v_period public.project_periods;
  r record;
BEGIN
  SELECT * INTO v_terms FROM public.project_terms WHERE id = p_terms_id;
  IF EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = v_terms.project_id AND m.kind = 'user' AND m.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM private.deleted_accounts da WHERE da.user_id = m.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.project_term_approvals a
        WHERE a.terms_id = p_terms_id AND a.user_id = m.user_id AND a.decision = 'accept'
      )
  ) THEN
    RETURN false;
  END IF;

  v_period := private.project_open_period(v_terms.project_id);

  IF v_terms.effective_from_seq = 1 THEN
    IF v_period.seq <> 1 THEN
      RAISE EXCEPTION 'Первый итог уже подведён — предложите условия заново' USING ERRCODE = 'P0409';
    END IF;
    UPDATE public.project_terms SET status = 'superseded'
    WHERE id = v_period.terms_id AND id <> p_terms_id AND status = 'active';
    UPDATE public.project_terms SET status = 'active', decided_at = now() WHERE id = p_terms_id;
    UPDATE public.project_periods SET terms_id = p_terms_id WHERE id = v_period.id;
  ELSE
    -- Последнее согласие (§3а.7): долг мог вырасти на границе периодов.
    FOR r IN
      SELECT m.display_name, private.project_debt(v_terms.project_id, m.id) AS debt,
             coalesce(l.debt_write_off, 0) AS x, coalesce(l.leaves, false) AS leaves
      FROM public.project_members m
      LEFT JOIN public.project_term_lines l ON l.terms_id = p_terms_id AND l.member_id = m.id
      WHERE m.project_id = v_terms.project_id
      ORDER BY m.position
    LOOP
      IF r.debt > 0 AND (NOT v_terms.contrib_enabled OR r.leaves) AND r.x < r.debt THEN
        RAISE EXCEPTION '%: долг вырос до % — предложите условия заново', r.display_name, private.project_rub(r.debt)
          USING ERRCODE = 'P0409';
      END IF;
    END LOOP;
    -- Принятая ранее версия на тот же период уступает новой.
    UPDATE public.project_terms SET status = 'superseded'
    WHERE project_id = v_terms.project_id AND status = 'active' AND effective_from_seq = v_period.seq + 1;
    UPDATE public.project_terms SET status = 'active', effective_from_seq = v_period.seq + 1, decided_at = now()
    WHERE id = p_terms_id;
  END IF;

  PERFORM private.project_log(v_terms.project_id, 'terms_activated', jsonb_build_object('terms_id', p_terms_id));
  RETURN true;
END;
$$;

-- Расчёт итога периода по §3а.2 по данным базы. Ничего не пишет.
-- p_initial_credit — период 1: вклады первоначальной версии ещё не в журнале
-- (их записывает close_period вместе с итогом), но уже входят в долг D_i.
CREATE FUNCTION private.project_calc(p_period_id uuid, p_initial_credit boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_period public.project_periods;
  v_terms public.project_terms;
  ids uuid[]; names text[]; positions int[];
  e bigint[]; inc bigint[]; ref bigint[]; d bigint[]; acc bigint[];
  in_rem boolean[]; w numeric[]; hrs bigint[]; pcs bigint[];
  ri bigint[]; si bigint[]; oi bigint[]; owed bigint[] := '{}'; onhand bigint[] := '{}'; tr bigint[] := '{}';
  zeros bigint[];
  n int; i int; j int;
  v_net bigint; v_p bigint; v_sum_d bigint; v_r bigint; v_sum_acc bigint; v_s bigint; v_o bigint;
  sub_w numeric[] := '{}'; sub_idx int[] := '{}'; parts bigint[];
  members jsonb := '[]'; transfers jsonb := '[]';
  deb_i int[]; deb_a bigint[]; cre_i int[]; cre_a bigint[]; v_x bigint;
BEGIN
  SELECT * INTO v_period FROM public.project_periods WHERE id = p_period_id;
  SELECT * INTO v_terms FROM public.project_terms WHERE id = v_period.terms_id;

  -- Участники периода в порядке position: активные и все, у кого есть операции.
  WITH mm AS (
    SELECT pm.* FROM public.project_members pm
    WHERE pm.project_id = v_period.project_id
      AND (pm.status = 'active' OR EXISTS (
        SELECT 1 FROM public.project_operations o WHERE o.period_id = p_period_id AND o.member_id = pm.id))
  ), ops AS (
    SELECT o.member_id,
           sum(o.amount_in_project_currency) FILTER (WHERE o.op_type = 'income') AS s_inc,
           sum(o.amount_in_project_currency) FILTER (WHERE o.op_type = 'income_refund') AS s_ref,
           sum(o.amount_in_project_currency) FILTER (WHERE o.op_type = 'expense') AS s_exp
    FROM public.project_operations o WHERE o.period_id = p_period_id GROUP BY o.member_id
  ), contrib AS (
    -- Вес «по вкладам»: Σ contrib_new всех версий, действовавших к этому периоду;
    -- возврат и списание вес не уменьшают (§3а.2, шаг 7).
    SELECT l.member_id, sum(l.contrib_new) AS total
    FROM public.project_term_lines l
    WHERE l.terms_id IN (
      SELECT pp.terms_id FROM public.project_periods pp
      WHERE pp.project_id = v_period.project_id AND pp.seq <= v_period.seq)
    GROUP BY l.member_id
  )
  SELECT array_agg(mm.id ORDER BY mm.position),
         array_agg(mm.display_name ORDER BY mm.position),
         array_agg(mm.position ORDER BY mm.position),
         array_agg(CASE WHEN coalesce(l.expenses_back, true) THEN coalesce(ops.s_exp, 0) ELSE 0 END::bigint ORDER BY mm.position),
         array_agg(coalesce(ops.s_inc, 0)::bigint ORDER BY mm.position),
         array_agg(coalesce(ops.s_ref, 0)::bigint ORDER BY mm.position),
         array_agg((private.project_debt(v_period.project_id, mm.id)
                    + CASE WHEN p_initial_credit AND v_terms.contrib_enabled THEN coalesce(l.contrib_new, 0) ELSE 0 END)::bigint
                   ORDER BY mm.position),
         array_agg(CASE coalesce(l.rate_type, 'none')
                     WHEN 'fixed' THEN l.rate_amount
                     WHEN 'hourly' THEN (l.rate_amount * coalesce(q.hours, 0) + 50) / 100
                     WHEN 'piece' THEN (l.rate_amount * coalesce(q.pieces, 0) + 50) / 100
                     ELSE 0 END::bigint ORDER BY mm.position),
         array_agg(coalesce(l.in_remainder, false) ORDER BY mm.position),
         array_agg(CASE v_terms.remainder_method
                     WHEN 'percent' THEN coalesce(l.share_bp, 0)
                     WHEN 'contrib' THEN coalesce(c.total, 0)
                     WHEN 'hours' THEN coalesce(q.hours, 0)
                     ELSE 1 END::numeric ORDER BY mm.position),
         array_agg(coalesce(q.hours, 0)::bigint ORDER BY mm.position),
         array_agg(coalesce(q.pieces, 0)::bigint ORDER BY mm.position)
  INTO ids, names, positions, e, inc, ref, d, acc, in_rem, w, hrs, pcs
  FROM mm
  LEFT JOIN public.project_term_lines l ON l.terms_id = v_terms.id AND l.member_id = mm.id
  LEFT JOIN public.project_quantities q ON q.period_id = p_period_id AND q.member_id = mm.id
  LEFT JOIN ops ON ops.member_id = mm.id
  LEFT JOIN contrib c ON c.member_id = mm.id;

  n := coalesce(cardinality(ids), 0);
  IF n = 0 THEN
    RAISE EXCEPTION 'В проекте нет участников' USING ERRCODE = 'P0001';
  END IF;
  zeros := array_fill(0::bigint, ARRAY[n]);

  -- 1–3. Чистые доходы, общие расходы, прибыль.
  SELECT sum(a) - sum(b) INTO v_net FROM unnest(inc, ref) AS u(a, b);
  SELECT v_net - sum(a) INTO v_p FROM unnest(e) AS u(a);

  -- 4. Вклады: блок выключен → R = 0 (долг журнала при этом не меняется).
  ri := zeros;
  v_r := 0;
  IF v_terms.contrib_enabled THEN
    SELECT sum(a) INTO v_sum_d FROM unnest(d) AS u(a);
    v_r := CASE WHEN v_sum_d > 0 THEN least(greatest(v_p, 0), v_sum_d) ELSE 0 END;
    IF v_r > 0 THEN
      ri := private.project_allocate(v_r, d::numeric[]);
    END IF;
  END IF;

  -- 5. Ставки: урезаются в одной пропорции, невыплаченное не переносится.
  SELECT sum(a) INTO v_sum_acc FROM unnest(acc) AS u(a);
  v_s := CASE WHEN v_sum_acc > 0 THEN greatest(0, least(v_sum_acc, v_p - v_r)) ELSE 0 END;
  si := CASE WHEN v_s = 0 THEN zeros WHEN v_s < v_sum_acc THEN private.project_allocate(v_s, acc::numeric[]) ELSE acc END;

  -- 6–7. Остаток по весам участвующих; Σ весов = 0 → поровну; убыток — по тем же весам.
  v_o := v_p - v_r - v_s;
  oi := zeros;
  FOR i IN 1..n LOOP
    IF in_rem[i] THEN
      sub_idx := sub_idx || i;
      sub_w := sub_w || w[i];
    END IF;
  END LOOP;
  IF cardinality(sub_idx) = 0 THEN
    IF v_o <> 0 THEN
      RAISE EXCEPTION 'Кто-то должен получать остаток' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF (SELECT sum(a) FROM unnest(sub_w) AS u(a)) = 0 THEN
      sub_w := array_fill(1::numeric, ARRAY[cardinality(sub_idx)]);
    END IF;
    parts := private.project_allocate_signed(v_o, sub_w);
    FOR j IN 1..cardinality(sub_idx) LOOP
      oi[sub_idx[j]] := parts[j];
    END LOOP;
  END IF;

  -- 8–10. Положено, на руках, перевод.
  FOR i IN 1..n LOOP
    owed := owed || (e[i] + ri[i] + si[i] + oi[i]);
    onhand := onhand || (inc[i] - ref[i]);
    tr := tr || (owed[i] - onhand[i]);
    members := members || jsonb_build_object(
      'member_id', ids[i], 'name', names[i], 'position', positions[i],
      'expenses_back', e[i], 'contribution_back', ri[i], 'rate_accrued', acc[i], 'rate', si[i],
      'remainder_share', oi[i], 'owed', owed[i], 'on_hand', onhand[i], 'transfer', tr[i],
      'debt_before', d[i], 'debt_after', d[i] - ri[i], 'hours', hrs[i], 'pieces', pcs[i]);
  END LOOP;

  IF (SELECT sum(a) FROM unnest(owed) AS u(a)) <> v_net OR (SELECT sum(a) FROM unnest(onhand) AS u(a)) <> v_net THEN
    RAISE EXCEPTION 'Расчёт не сошёлся: Σ положено ≠ Σ на руках' USING ERRCODE = 'P0001';
  END IF;

  -- Переводы — как simplifyDebts: по убыванию суммы, ничья — по position.
  SELECT array_agg(g.k ORDER BY -tr[g.k] DESC, g.k), array_agg(-tr[g.k] ORDER BY -tr[g.k] DESC, g.k)
  INTO deb_i, deb_a FROM generate_series(1, n) AS g(k) WHERE tr[g.k] < 0;
  SELECT array_agg(g.k ORDER BY tr[g.k] DESC, g.k), array_agg(tr[g.k] ORDER BY tr[g.k] DESC, g.k)
  INTO cre_i, cre_a FROM generate_series(1, n) AS g(k) WHERE tr[g.k] > 0;
  i := 1;
  j := 1;
  WHILE i <= coalesce(cardinality(deb_i), 0) AND j <= coalesce(cardinality(cre_i), 0) LOOP
    v_x := least(deb_a[i], cre_a[j]);
    transfers := transfers || jsonb_build_object('from_member', ids[deb_i[i]], 'to_member', ids[cre_i[j]], 'amount', v_x);
    deb_a[i] := deb_a[i] - v_x;
    cre_a[j] := cre_a[j] - v_x;
    IF deb_a[i] = 0 THEN i := i + 1; END IF;
    IF cre_a[j] = 0 THEN j := j + 1; END IF;
  END LOOP;
  IF i <= coalesce(cardinality(deb_i), 0) OR j <= coalesce(cardinality(cre_i), 0) THEN
    RAISE EXCEPTION 'Расчёт не сошёлся: Σ переводов ≠ 0' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'period_id', v_period.id, 'seq', v_period.seq, 'terms_id', v_terms.id, 'revision', v_period.revision,
    'remainder_method', v_terms.remainder_method, 'contrib_enabled', v_terms.contrib_enabled,
    'net_income', v_net, 'profit', v_p, 'contributions_repaid', v_r,
    'rates_accrued', v_sum_acc, 'rates_paid', v_s, 'remainder', v_o,
    'members', members, 'transfers', transfers);
END;
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.project_caller(uuid, boolean, boolean)', 'private.project_open_period(uuid)',
    'private.project_log(uuid, text, jsonb, int)', 'private.project_debt(uuid, uuid)', 'private.project_rub(bigint)',
    'private.project_allocate(bigint, numeric[])', 'private.project_allocate_signed(bigint, numeric[])',
    'private.project_insert_terms(uuid, jsonb, int)', 'private.project_try_activate(uuid)',
    'private.project_calc(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------- 5. RPC (реализация в private)

CREATE FUNCTION private.create_project(p_name text, p_currency text, p_guest_names text[], p_terms jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pid uuid;
  v_terms uuid;
  v_lines jsonb;
  v_name text;
  v_pos int := 1;
BEGIN
  PERFORM private.assert_account_active();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL OR char_length(btrim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Название проекта — от 1 до 80 символов' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_guest_names), 0) > 50 THEN
    RAISE EXCEPTION 'Не больше 50 гостей' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.projects (name, currency, owner_id)
  VALUES (btrim(p_name), coalesce(nullif(btrim(p_currency), ''), 'RUB'), v_uid)
  RETURNING id INTO v_pid;

  INSERT INTO public.project_members (project_id, kind, user_id, display_name, position)
  VALUES (v_pid, 'user', v_uid,
          coalesce(nullif(left(btrim((SELECT full_name FROM public.profiles WHERE id = v_uid)), 80), ''), 'Участник'), 1);

  FOREACH v_name IN ARRAY coalesce(p_guest_names, '{}') LOOP
    v_pos := v_pos + 1;
    IF NULLIF(btrim(v_name), '') IS NULL OR char_length(btrim(v_name)) > 80 THEN
      RAISE EXCEPTION 'Имя гостя — от 1 до 80 символов' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.project_members (project_id, kind, display_name, position)
    VALUES (v_pid, 'guest', btrim(v_name), v_pos);
  END LOOP;

  -- Строки условий при создании ссылаются на участников по position.
  SELECT jsonb_agg((ln - 'position') || jsonb_build_object('member_id', pm.id))
  INTO v_lines
  FROM jsonb_array_elements(coalesce(p_terms->'lines', '[]'::jsonb)) AS ln
  LEFT JOIN public.project_members pm ON pm.project_id = v_pid AND pm.position = (ln->>'position')::int;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_lines, '[]'::jsonb)) AS ln WHERE ln->'member_id' = 'null'::jsonb) THEN
    RAISE EXCEPTION 'Условия — только для участников проекта, по одной строке на человека' USING ERRCODE = '22023';
  END IF;

  -- Период ссылается на версию условий: сначала версия, потом период.
  v_terms := private.project_insert_terms(
    v_pid, jsonb_set(coalesce(p_terms, '{}'::jsonb), '{lines}', coalesce(v_lines, '[]'::jsonb)), 1);
  INSERT INTO public.project_periods (project_id, seq, terms_id) VALUES (v_pid, 1, v_terms);
  INSERT INTO public.project_term_approvals (project_id, terms_id, user_id, decision) VALUES (v_pid, v_terms, v_uid, 'accept');

  PERFORM private.project_log(v_pid, 'project_created', jsonb_build_object('terms_id', v_terms));
  PERFORM private.project_try_activate(v_terms);
  RETURN v_pid;
END;
$$;

CREATE FUNCTION private.preview_project_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v record;
BEGIN
  -- Для anon (auth.uid() = NULL) проверка проходит; удалённый получает отказ.
  PERFORM private.assert_account_active();
  SELECT p.name, p.id, i.created_by, i.disabled_at, i.expires_at INTO v
  FROM public.project_invites i JOIN public.projects p ON p.id = i.project_id
  WHERE i.code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Приглашение не найдено' USING ERRCODE = 'P0002';
  END IF;
  -- Только эти четыре поля: ни сумм, ни операций, ни условий, ни списка участников.
  RETURN jsonb_build_object(
    'project_name', v.name,
    'inviter_name', (SELECT display_name FROM public.project_members WHERE project_id = v.id AND user_id = v.created_by),
    'member_count', (SELECT count(*) FROM public.project_members WHERE project_id = v.id AND status = 'active'),
    'is_active', v.disabled_at IS NULL AND (v.expires_at IS NULL OR v.expires_at > now()));
END;
$$;

CREATE FUNCTION private.join_project_by_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pid uuid;
  v_member uuid;
BEGIN
  PERFORM private.assert_account_active();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
  END IF;
  -- Проверка до блокировки и после: disable_project_invite держит FOR SHARE
  -- проекта, и ссылку могли отключить, пока вход ждал.
  FOR k IN 1..2 LOOP
    SELECT i.project_id INTO v_pid FROM public.project_invites i
    WHERE i.code = p_code AND i.disabled_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > now());
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Приглашение недействительно или отключено' USING ERRCODE = '22023';
    END IF;
    IF k = 1 THEN
      -- Блокировка проекта: position выдаётся по порядку, два входа не делят номер.
      PERFORM 1 FROM public.projects WHERE id = v_pid FOR UPDATE;
    END IF;
  END LOOP;

  SELECT id INTO v_member FROM public.project_members WHERE project_id = v_pid AND user_id = v_uid;
  IF v_member IS NOT NULL THEN
    RETURN v_member; -- уже участник: ничего не создаём
  END IF;

  INSERT INTO public.project_members (project_id, kind, user_id, display_name, position)
  VALUES (v_pid, 'user', v_uid,
          coalesce(nullif(left(btrim((SELECT full_name FROM public.profiles WHERE id = v_uid)), 80), ''), 'Участник'),
          (SELECT max(position) + 1 FROM public.project_members WHERE project_id = v_pid))
  RETURNING id INTO v_member;

  PERFORM private.project_log(v_pid, 'member_joined', jsonb_build_object('member_id', v_member));
  RETURN v_member;
END;
$$;

CREATE FUNCTION private.create_project_invite(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  -- 244 случайных бита: код нельзя подобрать.
  v_code text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  PERFORM private.assert_account_active();
  PERFORM private.project_caller(p_project_id, false);
  INSERT INTO public.project_invites (project_id, code, created_by) VALUES (p_project_id, v_code, auth.uid());
  PERFORM private.project_log(p_project_id, 'invite_created', '{}'::jsonb);
  RETURN v_code;
END;
$$;

CREATE FUNCTION private.disable_project_invite(p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v public.project_invites;
BEGIN
  PERFORM private.assert_account_active();
  SELECT * INTO v FROM public.project_invites WHERE code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Приглашение не найдено или недоступно' USING ERRCODE = '42501';
  END IF;
  PERFORM private.project_caller(v.project_id, false);
  IF v.created_by <> auth.uid() AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v.project_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Отключить ссылку может владелец или автор ссылки' USING ERRCODE = '42501';
  END IF;
  UPDATE public.project_invites SET disabled_at = now() WHERE id = v.id AND disabled_at IS NULL;
  PERFORM private.project_log(v.project_id, 'invite_disabled', '{}'::jsonb);
END;
$$;

CREATE FUNCTION private.propose_terms(p_project_id uuid, p_terms jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_period public.project_periods;
  v_id uuid;
BEGIN
  PERFORM private.assert_account_active();
  PERFORM private.project_caller(p_project_id, true);
  v_period := private.project_open_period(p_project_id);
  -- До первого итога предложение заменяет условия периода 1 (их должны принять
  -- и вошедшие по приглашению); после — действует со следующего периода.
  v_id := private.project_insert_terms(p_project_id, p_terms, CASE WHEN v_period.seq = 1 THEN 1 END);
  INSERT INTO public.project_term_approvals (project_id, terms_id, user_id, decision)
  VALUES (p_project_id, v_id, auth.uid(), 'accept');
  PERFORM private.project_log(p_project_id, 'terms_proposed', jsonb_build_object('terms_id', v_id, 'terms', p_terms));
  PERFORM private.project_try_activate(v_id);
  RETURN v_id;
END;
$$;

CREATE FUNCTION private.decide_terms(p_terms_id uuid, p_accept boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_pid uuid;
  v_terms public.project_terms;
  v_period public.project_periods;
BEGIN
  PERFORM private.assert_account_active();
  SELECT project_id INTO v_pid FROM public.project_terms WHERE id = p_terms_id;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Проект не найден или недоступен' USING ERRCODE = '42501';
  END IF;
  PERFORM private.project_caller(v_pid, true);
  v_period := private.project_open_period(v_pid);
  SELECT * INTO v_terms FROM public.project_terms WHERE id = p_terms_id;

  IF EXISTS (SELECT 1 FROM public.project_term_approvals WHERE terms_id = p_terms_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Ты уже ответил на эти условия' USING ERRCODE = 'P0409';
  END IF;
  -- Действующие условия периода 1 ещё принимают вошедшие по приглашению до
  -- первого итога (§6); отказаться от них нельзя — только предложить другие.
  IF NOT (v_terms.status = 'proposed'
          OR (p_accept AND v_terms.status = 'active' AND v_terms.id = v_period.terms_id AND v_period.seq = 1)) THEN
    RAISE EXCEPTION 'Эти условия уже не ждут согласия' USING ERRCODE = 'P0409';
  END IF;

  INSERT INTO public.project_term_approvals (project_id, terms_id, user_id, decision)
  VALUES (v_pid, p_terms_id, auth.uid(), CASE WHEN p_accept THEN 'accept' ELSE 'decline' END);

  IF NOT p_accept THEN
    UPDATE public.project_terms SET status = 'rejected', decided_at = now() WHERE id = p_terms_id;
    PERFORM private.project_log(v_pid, 'terms_declined', jsonb_build_object('terms_id', p_terms_id));
    RETURN 'rejected';
  END IF;
  PERFORM private.project_log(v_pid, 'terms_accepted', jsonb_build_object('terms_id', p_terms_id));
  IF v_terms.status = 'proposed' THEN
    PERFORM private.project_try_activate(p_terms_id);
  END IF;
  RETURN (SELECT status FROM public.project_terms WHERE id = p_terms_id);
END;
$$;

CREATE FUNCTION private.add_operation(
  p_project_id uuid, p_op_type text, p_amount bigint, p_member_id uuid, p_refund_of uuid,
  p_currency text, p_exchange_rate numeric, p_occurred_on date, p_title text, p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_project public.projects;
  v_currency text;
  v_rate numeric := coalesce(p_exchange_rate, 1);
  v_income public.project_operations;
  v_id uuid;
BEGIN
  PERFORM private.assert_account_active();
  PERFORM private.project_caller(p_project_id, false);
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;

  IF NOT EXISTS (SELECT 1 FROM public.project_members WHERE id = p_member_id AND project_id = p_project_id AND status = 'active') THEN
    RAISE EXCEPTION 'Участник не из этого проекта' USING ERRCODE = '22023';
  END IF;
  v_currency := coalesce(nullif(btrim(p_currency), ''), v_project.currency);
  IF v_currency = v_project.currency AND v_rate <> 1 THEN
    RAISE EXCEPTION 'Курс для валюты проекта — 1' USING ERRCODE = '22023';
  END IF;
  IF (p_op_type = 'income_refund') <> (p_refund_of IS NOT NULL) THEN
    RAISE EXCEPTION 'Возврат дохода — только со ссылкой на доход' USING ERRCODE = '22023';
  END IF;
  IF p_refund_of IS NOT NULL THEN
    SELECT * INTO v_income FROM public.project_operations
    WHERE id = p_refund_of AND project_id = p_project_id AND op_type = 'income' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Доход для возврата не найден в этом проекте' USING ERRCODE = '22023';
    END IF;
    IF (SELECT coalesce(sum(amount_in_project_currency), 0) FROM public.project_operations WHERE refund_of = p_refund_of)
       + round(p_amount * v_rate) > v_income.amount_in_project_currency THEN
      RAISE EXCEPTION 'Возвраты по доходу больше дохода' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- period_id ставит триггер (текущий открытый период).
  INSERT INTO public.project_operations (
    project_id, period_id, op_type, amount, currency, exchange_rate, member_id, refund_of,
    occurred_on, title, note, created_by
  ) VALUES (
    p_project_id, NULL, p_op_type, p_amount, v_currency, v_rate, p_member_id, p_refund_of,
    coalesce(p_occurred_on, current_date), coalesce(btrim(p_title), ''), nullif(btrim(p_note), ''), auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM private.project_log(p_project_id, 'operation_added', jsonb_build_object(
    'operation_id', v_id, 'op_type', p_op_type, 'amount', p_amount, 'currency', v_currency, 'member_id', p_member_id));
  RETURN v_id;
END;
$$;

-- Общая часть правки и удаления: проверки в порядке §7.3 п. 7.
CREATE FUNCTION private.project_lock_operation(p_operation_id uuid)
RETURNS public.project_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_pid uuid;
  v public.project_operations;
BEGIN
  SELECT project_id INTO v_pid FROM public.project_operations WHERE id = p_operation_id;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Операция не найдена или недоступна' USING ERRCODE = 'P0002';
  END IF;
  PERFORM private.project_caller(v_pid, false);
  SELECT * INTO v FROM public.project_operations WHERE id = p_operation_id FOR UPDATE;
  IF v.created_by <> auth.uid() AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_pid AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Править и удалять операцию может автор или владелец' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION private.project_lock_operation(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.edit_operation(
  p_operation_id uuid, p_amount bigint, p_member_id uuid, p_currency text, p_exchange_rate numeric,
  p_occurred_on date, p_title text, p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v public.project_operations;
  v_project_currency text;
  v_amount bigint;
  v_currency text;
  v_rate numeric;
  v_new_pc numeric;
BEGIN
  PERFORM private.assert_account_active();
  v := private.project_lock_operation(p_operation_id);
  SELECT currency INTO v_project_currency FROM public.projects WHERE id = v.project_id;

  IF p_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_members WHERE id = p_member_id AND project_id = v.project_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Участник не из этого проекта' USING ERRCODE = '22023';
  END IF;
  v_amount := coalesce(p_amount, v.amount);
  v_currency := coalesce(nullif(btrim(p_currency), ''), v.currency);
  v_rate := coalesce(p_exchange_rate, CASE WHEN v_currency = v.currency THEN v.exchange_rate ELSE 1 END);
  IF v_currency = v_project_currency AND v_rate <> 1 THEN
    RAISE EXCEPTION 'Курс для валюты проекта — 1' USING ERRCODE = '22023';
  END IF;
  v_new_pc := round(v_amount * v_rate);
  IF v.op_type = 'income_refund' THEN
    PERFORM 1 FROM public.project_operations WHERE id = v.refund_of FOR UPDATE;
    IF (SELECT coalesce(sum(amount_in_project_currency), 0) FROM public.project_operations
        WHERE refund_of = v.refund_of AND id <> v.id) + v_new_pc
       > (SELECT amount_in_project_currency FROM public.project_operations WHERE id = v.refund_of) THEN
      RAISE EXCEPTION 'Возвраты по доходу больше дохода' USING ERRCODE = '22023';
    END IF;
  ELSIF v.op_type = 'income' AND v_new_pc
        < (SELECT coalesce(sum(amount_in_project_currency), 0) FROM public.project_operations WHERE refund_of = v.id) THEN
    RAISE EXCEPTION 'Возвраты по доходу больше дохода' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_periods WHERE id = v.period_id AND status = 'open') THEN
    RAISE EXCEPTION 'Период закрыт: операцию нельзя изменить' USING ERRCODE = 'P0423';
  END IF;

  UPDATE public.project_operations SET
    amount = v_amount, currency = v_currency, exchange_rate = v_rate,
    member_id = coalesce(p_member_id, member_id), occurred_on = coalesce(p_occurred_on, occurred_on),
    title = coalesce(btrim(p_title), title), note = CASE WHEN p_note IS NULL THEN note ELSE nullif(btrim(p_note), '') END,
    updated_at = now()
  WHERE id = v.id;

  PERFORM private.project_log(v.project_id, 'operation_edited', jsonb_build_object(
    'operation_id', v.id,
    'before', jsonb_build_object('amount', v.amount, 'currency', v.currency, 'member_id', v.member_id),
    'after', jsonb_build_object('amount', v_amount, 'currency', v_currency, 'member_id', coalesce(p_member_id, v.member_id))));
  RETURN v.id;
END;
$$;

CREATE FUNCTION private.delete_operation(p_operation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v public.project_operations;
BEGIN
  PERFORM private.assert_account_active();
  v := private.project_lock_operation(p_operation_id);
  IF EXISTS (SELECT 1 FROM public.project_operations WHERE refund_of = v.id) THEN
    RAISE EXCEPTION 'Сначала удалите возвраты по этому доходу' USING ERRCODE = 'P0409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_periods WHERE id = v.period_id AND status = 'open') THEN
    RAISE EXCEPTION 'Период закрыт: операцию нельзя удалить' USING ERRCODE = 'P0423';
  END IF;
  DELETE FROM public.project_operations WHERE id = v.id;
  PERFORM private.project_log(v.project_id, 'operation_deleted', jsonb_build_object(
    'operation_id', v.id, 'op_type', v.op_type, 'amount', v.amount, 'currency', v.currency, 'member_id', v.member_id));
END;
$$;

CREATE FUNCTION private.set_quantity(p_project_id uuid, p_member_id uuid, p_hours int, p_pieces bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_member public.project_members;
  v_period public.project_periods;
  v_method text;
  v_rate text;
BEGIN
  PERFORM private.assert_account_active();
  PERFORM private.project_caller(p_project_id, false);
  SELECT * INTO v_member FROM public.project_members WHERE id = p_member_id AND project_id = p_project_id;
  -- За другого участника с аккаунтом не вносит никто, включая владельца.
  -- coalesce: у гостя user_id = NULL, и NOT (NULL OR false) пропустил бы любого.
  IF NOT FOUND OR NOT (
    coalesce(v_member.user_id = auth.uid(), false)
    OR (v_member.kind = 'guest' AND EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND owner_id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Часы и штуки вносят только за себя; за гостя — владелец' USING ERRCODE = '42501';
  END IF;
  IF v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Участник вышел из проекта' USING ERRCODE = '22023';
  END IF;

  v_period := private.project_open_period(p_project_id);
  SELECT t.remainder_method, l.rate_type INTO v_method, v_rate
  FROM public.project_terms t
  LEFT JOIN public.project_term_lines l ON l.terms_id = t.id AND l.member_id = p_member_id
  WHERE t.id = v_period.terms_id;
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Участника нет в условиях этого периода' USING ERRCODE = '22023';
  END IF;
  IF p_hours IS NOT NULL AND NOT (v_rate = 'hourly' OR v_method = 'hours') THEN
    RAISE EXCEPTION 'Часы не нужны: нет ставки «за час» и остаток не «по часам»' USING ERRCODE = '22023';
  END IF;
  IF p_pieces IS NOT NULL AND v_rate <> 'piece' THEN
    RAISE EXCEPTION 'Штуки не нужны: нет ставки «за штуку»' USING ERRCODE = '22023';
  END IF;
  IF p_hours NOT BETWEEN 0 AND 999900 OR p_pieces NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Количество: от 0 до 9 999 ч и до 1 000 000 шт.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_quantities AS q (project_id, period_id, member_id, hours, pieces, entered_by)
  VALUES (p_project_id, v_period.id, p_member_id, coalesce(p_hours, 0), coalesce(p_pieces, 0), auth.uid())
  ON CONFLICT (period_id, member_id) DO UPDATE SET
    hours = coalesce(p_hours, q.hours), pieces = coalesce(p_pieces, q.pieces),
    entered_by = auth.uid(), updated_at = now();

  PERFORM private.project_log(p_project_id, 'quantity_set', jsonb_build_object(
    'member_id', p_member_id, 'period_id', v_period.id, 'hours', p_hours, 'pieces', p_pieces));
END;
$$;

CREATE FUNCTION private.close_period(p_project_id uuid, p_revision bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_period public.project_periods;
  v_terms public.project_terms;
  v_next public.project_terms;
  v_next_period uuid;
  v_waiting text;
  v_snap jsonb;
  v_ledger jsonb := '[]';
  v_m jsonb;
  r record;
  v_x bigint;
  v_wo bigint;
BEGIN
  PERFORM private.assert_account_active();
  PERFORM private.project_caller(p_project_id, true);
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Зафиксировать итог может только владелец' USING ERRCODE = '42501';
  END IF;
  v_period := private.project_open_period(p_project_id);
  SELECT * INTO v_terms FROM public.project_terms WHERE id = v_period.terms_id;

  -- Условия периода приняты всеми участниками с аккаунтом (для периода 1 —
  -- включая вошедших по приглашению до первого итога).
  SELECT string_agg(pm.display_name, ', ' ORDER BY pm.position) INTO v_waiting
  FROM public.project_members pm
  WHERE pm.project_id = p_project_id AND pm.kind = 'user' AND pm.status = 'active'
    AND (v_period.seq = 1 OR v_terms.status <> 'active')
    AND NOT EXISTS (SELECT 1 FROM private.deleted_accounts da WHERE da.user_id = pm.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.project_term_approvals a
                    WHERE a.terms_id = v_terms.id AND a.user_id = pm.user_id AND a.decision = 'accept');
  IF v_terms.status <> 'active' OR v_waiting IS NOT NULL THEN
    RAISE EXCEPTION 'Ждём согласия: %', coalesce(v_waiting, '—') USING ERRCODE = 'P0409';
  END IF;
  IF p_revision IS DISTINCT FROM v_period.revision THEN
    RAISE EXCEPTION 'Данные изменились — посмотрите итог ещё раз' USING ERRCODE = 'P0409';
  END IF;

  v_snap := private.project_calc(v_period.id, v_period.seq = 1);

  SELECT * INTO v_next FROM public.project_terms
  WHERE project_id = p_project_id AND status = 'active' AND effective_from_seq = v_period.seq + 1;

  -- Журнал (§3а.2): [период 1: credit первоначальной версии] → repay → write_off
  -- min(X, остаток) → credit новой версии (ровно один раз).
  IF v_period.seq = 1 AND v_terms.contrib_enabled THEN
    FOR r IN
      SELECT l.member_id, l.contrib_new FROM public.project_term_lines l
      JOIN public.project_members pm ON pm.id = l.member_id
      WHERE l.terms_id = v_terms.id AND l.contrib_new > 0 ORDER BY pm.position
    LOOP
      v_ledger := v_ledger || jsonb_build_object('member_id', r.member_id, 'kind', 'credit', 'amount', r.contrib_new,
                                                 'period', 'current', 'terms_id', v_terms.id);
    END LOOP;
  END IF;
  FOR v_m IN SELECT value FROM jsonb_array_elements(v_snap->'members') LOOP
    IF (v_m->>'contribution_back')::bigint > 0 THEN
      v_ledger := v_ledger || jsonb_build_object('member_id', v_m->'member_id', 'kind', 'repay',
                                                 'amount', (v_m->>'contribution_back')::bigint, 'period', 'current',
                                                 'terms_id', v_terms.id);
    END IF;
  END LOOP;
  IF v_next.id IS NOT NULL THEN
    FOR v_m IN SELECT value FROM jsonb_array_elements(v_snap->'members') LOOP
      SELECT l.debt_write_off INTO v_x FROM public.project_term_lines l
      WHERE l.terms_id = v_next.id AND l.member_id = (v_m->>'member_id')::uuid;
      v_wo := least(coalesce(v_x, 0), (v_m->>'debt_after')::bigint);
      IF v_wo > 0 THEN
        v_ledger := v_ledger || jsonb_build_object('member_id', v_m->'member_id', 'kind', 'write_off',
                                                   'amount', v_wo, 'period', 'next', 'terms_id', v_next.id);
      END IF;
    END LOOP;
    IF v_next.contrib_enabled THEN
      FOR r IN
        SELECT l.member_id, l.contrib_new FROM public.project_term_lines l
        JOIN public.project_members pm ON pm.id = l.member_id
        WHERE l.terms_id = v_next.id AND l.contrib_new > 0 ORDER BY pm.position
      LOOP
        v_ledger := v_ledger || jsonb_build_object('member_id', r.member_id, 'kind', 'credit', 'amount', r.contrib_new,
                                                   'period', 'next', 'terms_id', v_next.id);
      END LOOP;
    END IF;
  END IF;
  v_snap := v_snap || jsonb_build_object('ledger', v_ledger);

  -- Сбой на любом шаге ниже откатывает всю транзакцию — не меняется ничего.
  UPDATE public.project_periods
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(), snapshot = v_snap
  WHERE id = v_period.id;

  -- revision продолжает счёт: повторное «Зафиксировать» с той же ревизией не
  -- закроет следом новый пустой период.
  INSERT INTO public.project_periods (project_id, seq, terms_id, revision)
  VALUES (p_project_id, v_period.seq + 1, coalesce(v_next.id, v_terms.id), v_period.revision + 1)
  RETURNING id INTO v_next_period;

  INSERT INTO public.project_contribution_ledger (project_id, member_id, period_id, terms_id, kind, amount)
  SELECT p_project_id, (u.e->>'member_id')::uuid,
         CASE u.e->>'period' WHEN 'current' THEN v_period.id ELSE v_next_period END,
         (u.e->>'terms_id')::uuid, u.e->>'kind', (u.e->>'amount')::bigint
  FROM jsonb_array_elements(v_ledger) WITH ORDINALITY AS u(e, ord)
  ORDER BY u.ord;

  IF EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project_id AND private.project_debt(p_project_id, pm.id) < 0
  ) THEN
    RAISE EXCEPTION 'Долг по вкладу ушёл бы в минус' USING ERRCODE = 'P0001';
  END IF;

  IF v_next.id IS NOT NULL THEN
    -- Выходящие: долг уже списан, ставим left.
    IF EXISTS (
      SELECT 1 FROM public.project_term_lines l
      WHERE l.terms_id = v_next.id AND l.leaves AND private.project_debt(p_project_id, l.member_id) <> 0
    ) THEN
      RAISE EXCEPTION 'У выходящего остался долг по вкладу' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.project_members SET status = 'left', left_after_seq = v_period.seq
    WHERE id IN (SELECT member_id FROM public.project_term_lines WHERE terms_id = v_next.id AND leaves);
    UPDATE public.project_terms SET status = 'superseded' WHERE id = v_terms.id AND status = 'active';
  END IF;

  PERFORM private.project_log(p_project_id, 'period_closed', jsonb_build_object(
    'period_id', v_period.id, 'seq', v_period.seq, 'next_period_id', v_next_period), v_period.seq);
  RETURN v_snap;
END;
$$;

CREATE FUNCTION private.mark_transfer_paid(p_period_id uuid, p_from_member uuid, p_to_member uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_period public.project_periods;
  v_me public.project_members;
  v_from public.project_members;
  v_amount bigint;
  v_id uuid;
BEGIN
  PERFORM private.assert_account_active();
  SELECT * INTO v_period FROM public.project_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Проект не найден или недоступен' USING ERRCODE = '42501';
  END IF;
  -- Вышедший отмечает свои переводы по закрытым периодам (§4).
  v_me := private.project_caller(v_period.project_id, false, true);
  SELECT * INTO v_from FROM public.project_members WHERE id = p_from_member AND project_id = v_period.project_id;
  IF NOT FOUND OR NOT (v_from.id = v_me.id OR (v_from.kind = 'guest' AND v_me.status = 'active')) THEN
    RAISE EXCEPTION 'Отметить перевод может отправитель; за гостя — любой участник' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_members WHERE id = p_to_member AND project_id = v_period.project_id) THEN
    RAISE EXCEPTION 'Получатель не из этого проекта' USING ERRCODE = '22023';
  END IF;
  IF v_period.status <> 'closed' THEN
    RAISE EXCEPTION 'Период не закрыт: переводов по итогу ещё нет' USING ERRCODE = 'P0423';
  END IF;
  SELECT (t->>'amount')::bigint INTO v_amount
  FROM jsonb_array_elements(v_period.snapshot->'transfers') AS t
  WHERE (t->>'from_member')::uuid = p_from_member AND (t->>'to_member')::uuid = p_to_member;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Такого перевода нет в итоге периода' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_transfers (project_id, period_id, from_member, to_member, amount, marked_by)
  VALUES (v_period.project_id, p_period_id, p_from_member, p_to_member, v_amount, auth.uid())
  ON CONFLICT (period_id, from_member, to_member) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.project_transfers
    WHERE period_id = p_period_id AND from_member = p_from_member AND to_member = p_to_member;
    RETURN v_id; -- уже отмечен
  END IF;
  PERFORM private.project_log(v_period.project_id, 'transfer_marked', jsonb_build_object(
    'period_id', p_period_id, 'from_member', p_from_member, 'to_member', p_to_member, 'amount', v_amount));
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.create_project(text, text, text[], jsonb)',
    'private.join_project_by_invite(text)', 'private.create_project_invite(uuid)', 'private.disable_project_invite(text)',
    'private.propose_terms(uuid, jsonb)', 'private.decide_terms(uuid, boolean)',
    'private.add_operation(uuid, text, bigint, uuid, uuid, text, numeric, date, text, text)',
    'private.edit_operation(uuid, bigint, uuid, text, numeric, date, text, text)', 'private.delete_operation(uuid)',
    'private.set_quantity(uuid, uuid, int, bigint)', 'private.close_period(uuid, bigint)',
    'private.mark_transfer_paid(uuid, uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$$;
-- preview вызывается только из public-обёртки (DEFINER), напрямую клиенту не нужна.
REVOKE ALL ON FUNCTION private.preview_project_invite(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 6. Публичные обёртки

CREATE FUNCTION public.create_project(p_name text, p_currency text, p_guest_names text[], p_terms jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.create_project(p_name, p_currency, p_guest_names, p_terms) $$;

-- Доступна anon: обёртка сама SECURITY DEFINER (у anon нет USAGE на private).
CREATE FUNCTION public.preview_project_invite(p_code text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.preview_project_invite(p_code) $$;

CREATE FUNCTION public.join_project_by_invite(p_code text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.join_project_by_invite(p_code) $$;

CREATE FUNCTION public.create_project_invite(p_project_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.create_project_invite(p_project_id) $$;

CREATE FUNCTION public.disable_project_invite(p_code text)
RETURNS void LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.disable_project_invite(p_code) $$;

CREATE FUNCTION public.propose_terms(p_project_id uuid, p_terms jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.propose_terms(p_project_id, p_terms) $$;

CREATE FUNCTION public.accept_terms(p_terms_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.decide_terms(p_terms_id, true) $$;

CREATE FUNCTION public.decline_terms(p_terms_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.decide_terms(p_terms_id, false) $$;

CREATE FUNCTION public.add_operation(
  p_project_id uuid, p_op_type text, p_amount bigint, p_member_id uuid, p_refund_of uuid DEFAULT NULL,
  p_currency text DEFAULT NULL, p_exchange_rate numeric DEFAULT 1, p_occurred_on date DEFAULT NULL,
  p_title text DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS uuid LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.add_operation(p_project_id, p_op_type, p_amount, p_member_id, p_refund_of,
                                   p_currency, p_exchange_rate, p_occurred_on, p_title, p_note) $$;

CREATE FUNCTION public.edit_operation(
  p_operation_id uuid, p_amount bigint DEFAULT NULL, p_member_id uuid DEFAULT NULL, p_currency text DEFAULT NULL,
  p_exchange_rate numeric DEFAULT NULL, p_occurred_on date DEFAULT NULL, p_title text DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS uuid LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.edit_operation(p_operation_id, p_amount, p_member_id, p_currency, p_exchange_rate,
                                    p_occurred_on, p_title, p_note) $$;

CREATE FUNCTION public.delete_operation(p_operation_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.delete_operation(p_operation_id) $$;

CREATE FUNCTION public.set_quantity(p_project_id uuid, p_member_id uuid, p_hours int DEFAULT NULL, p_pieces bigint DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.set_quantity(p_project_id, p_member_id, p_hours, p_pieces) $$;

CREATE FUNCTION public.close_period(p_project_id uuid, p_revision bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.close_period(p_project_id, p_revision) $$;

CREATE FUNCTION public.mark_transfer_paid(p_period_id uuid, p_from_member uuid, p_to_member uuid)
RETURNS uuid LANGUAGE sql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, private
AS $$ SELECT private.mark_transfer_paid(p_period_id, p_from_member, p_to_member) $$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_project(text, text, text[], jsonb)', 'public.join_project_by_invite(text)',
    'public.create_project_invite(uuid)', 'public.disable_project_invite(text)', 'public.propose_terms(uuid, jsonb)',
    'public.accept_terms(uuid)', 'public.decline_terms(uuid)',
    'public.add_operation(uuid, text, bigint, uuid, uuid, text, numeric, date, text, text)',
    'public.edit_operation(uuid, bigint, uuid, text, numeric, date, text, text)', 'public.delete_operation(uuid)',
    'public.set_quantity(uuid, uuid, int, bigint)', 'public.close_period(uuid, bigint)',
    'public.mark_transfer_paid(uuid, uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.preview_project_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_project_invite(text) TO anon, authenticated;
