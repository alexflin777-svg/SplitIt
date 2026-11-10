'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MemberRow, OperationRow, ProjectData } from '@/lib/projects-store';
import { currentUserId, projects, snapshotUserId } from '@/lib/projects-client';
import { readSnap, writeSnap } from '@/lib/snapshot';

export interface LoadedProject {
  data: ProjectData;
  /** Операции открытого периода (или запрошенного). */
  ops: OperationRow[];
  uid: string | null;
  me: MemberRow | null;
  isOwner: boolean;
}

/** Открытый период, известный по прошлому ответу (главная, прошлое открытие): по нему операции читаются сразу. */
const openPeriodOf = new Map<string, string>();
export function rememberOpenPeriod(projectId: string, periodId: string) {
  openPeriodOf.set(projectId, periodId);
}

/**
 * Проект целиком + операции периода. Ошибка загрузки не превращается в пустой
 * проект: экран показывает её и «Повторить», а прежние данные остаются.
 *
 * snapshot: true — экран сначала рисует прошлый ответ и тут же перечитывает.
 * Только для просмотра проекта: итог, согласие, запись операции — всегда свежее чтение.
 */
export function useProject(projectId: string | null, periodId?: string | null, opts: { snapshot?: boolean } = {}) {
  const snapName = opts.snapshot && projectId && !periodId ? `project:${projectId}` : null;
  const [state, setState] = useState<LoadedProject | null>(() => (snapName ? readSnap<LoadedProject>(snapshotUserId(), snapName) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Чтение без setState: результат применяет вызывающий. */
  const load = useCallback(async (): Promise<{ next: LoadedProject | null; error: string | null }> => {
    if (!projectId) return { next: null, error: null };
    // Операции угаданного периода — одновременно с проектом; не угадали — дочитываем.
    const guess = periodId ?? openPeriodOf.get(projectId);
    const [uid, d, early] = await Promise.all([
      currentUserId(),
      projects.fetchProject(projectId),
      guess ? projects.fetchPeriodOperations(projectId, guess) : null,
    ]);
    if (!d.data) return { next: null, error: d.error };
    const period = periodId ? d.data.periods.find((p) => p.id === periodId) : d.data.periods.find((p) => p.status === 'open');
    if (period && !periodId) rememberOpenPeriod(projectId, period.id);
    const ops = !period
      ? { data: [], error: null }
      : early && guess === period.id
        ? early
        : await projects.fetchPeriodOperations(projectId, period.id);
    if (!ops.data) return { next: null, error: ops.error };
    const me = d.data.members.find((m) => m.user_id === uid) ?? null;
    return { next: { data: d.data, ops: ops.data, uid, me, isOwner: d.data.project.owner_id === uid }, error: null };
  }, [projectId, periodId]);

  const apply = useCallback(
    (r: { next: LoadedProject | null; error: string | null }) => {
      if (r.next) {
        setState(r.next);
        if (snapName) writeSnap(r.next.uid, snapName, r.next);
      }
      setError(r.error);
      setLoading(false);
      return r.next;
    },
    [snapName],
  );

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
