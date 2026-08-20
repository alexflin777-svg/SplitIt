-- Добавление виртуального участника (гостя) в сетевое событие
-- Виртуальные участники хранятся в group_participants (kind = 'guest') и привязываются к событию.

CREATE OR REPLACE FUNCTION add_virtual_member(p_group_id uuid, p_member_name text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_participant_id uuid;
  v_result json;
BEGIN
  -- Проверка прав: только создатель события может добавлять гостей (упрощенная модель)
  -- В реальном приложении можно проверять наличие юзера в group_members
  IF NOT EXISTS (
    SELECT 1 FROM groups WHERE id = p_group_id AND created_by = auth.uid()
  ) THEN
    -- Если не создатель, проверим, есть ли юзер вообще в группе (позволим любому участнику добавлять)
    IF NOT EXISTS (
      SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Недостаточно прав для добавления участников.';
    END IF;
  END IF;

  -- Создаем запись participant
  INSERT INTO group_participants (group_id, display_name, kind, created_by)
  VALUES (p_group_id, p_member_name, 'guest', auth.uid())
  RETURNING id INTO v_participant_id;

  -- Формируем результат, совместимый с GroupMember
  SELECT json_build_object(
    'id', v_participant_id,
    'name', p_member_name,
    'avatar', '👤',
    'role', 'member'
  ) INTO v_result;

  RETURN v_result;
END;
$$;