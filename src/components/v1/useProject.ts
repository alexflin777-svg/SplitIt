'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MemberRow, OperationRow, ProjectData } from '@/lib/projects-store';
import { currentUserId, projects } from '@/lib/projects-client';

export interface LoadedProject {
  data: ProjectData;
  /** Операции открытого периода (или запрошенного). */
  ops: OperationRow[];
  uid: string | null;
  me: MemberRow | null;
  isOwner: boolean;
}

/**
 * Проект целиком + операции периода. Ошибка загрузки не превращается в пустой
 * проект: экран показывает её и «Повторить», а прежние данные остаются.
 */
export function useProject(projectId: string | null, periodId?: string | null) {
  const [state, setState] = useState<LoadedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Чтение без setState: результат применяет вызывающий. */
  const load = useCallback(async (): Promise<{ next: LoadedProject | null; error: string | null }> => {
    if (!projectId) return { next: null, error: null };
    const [uid, d] = await Promise.all([currentUserId(), projects.fetchProject(projectId)]);
    if (!d.data) return { next: null, error: d.error };
    const period = periodId ? d.data.periods.find((p) => p.id === periodId) : d.data.periods.find((p) => p.status === 'open');
    const ops = period ? await projects.fetchPeriodOperations(projectId, period.id) : { data: [], error: null };
    if (!ops.data) return { next: null, error: ops.error };
    const me = d.data.members.find((m) => m.user_id === uid) ?? null;
    return { next: { data: d.data, ops: ops.data, uid, me, isOwner: d.data.project.owner_id === uid }, error: null };
  }, [projectId, periodId]);

  const apply = useCallback((r: { next: LoadedProject | null; error: string | null }) => {
    if (r.next) setState(r.next);
    setError(r.error);
    setLoading(false);
    return r.next;
  }, []);

  const reload = useCallback(async () => apply(await load()), [apply, load]);

  useEffect(() => {
    let alive = true;
    void load().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [load, apply]);

  return { project: state, error, loading: loading && !!projectId, reload };
}
