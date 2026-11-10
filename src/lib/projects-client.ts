/**
 * Точка доступа экранов к «Проекту»: projects-store поверх нужного клиента.
 *
 * Сетевой режим — общий клиент Supabase. Без бэкенда store честно отвечает
 * «нет бэкенда»; исключение — e2e-сборка (NEXT_PUBLIC_OCR_TEST_HOOK=1), где
 * подставляется фейк с тем же контрактом RPC (projects-e2e-fake.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createProjectsStore } from './projects-store';
import type { RemoteResult } from './remote-store';
import { getLocalSession, supabase } from './supabase';
import { t } from './i18n/t';
// Только в build:test это фейк; в обычной сборке — пустой модуль (next.config.mjs).
import * as e2eFake from 'splitit-e2e-projects-fake';

const fake = process.env.NEXT_PUBLIC_OCR_TEST_HOOK === '1' && !supabase && typeof window !== 'undefined' ? e2eFake : null;

const client: SupabaseClient | null = supabase ?? (fake ? (fake.createFakeProjectsClient() as unknown as SupabaseClient) : null);

export const projects = createProjectsStore(client);

/**
 * auth.uid() вызывающего: с ним сравниваются user_id участников и owner_id.
 * Только для подписей «я/не я» — права проверяет база, поэтому хватает
 * локальной сессии (getSession), без похода в Auth и profiles на каждый экран.
 */
export async function currentUserId(): Promise<string | null> {
  if (fake) return fake.fakeActor()?.id ?? null;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Чей снимок экрана читать — синхронно, до первого кадра. */
export function snapshotUserId(): string | null {
  if (fake) return fake.fakeActor()?.id ?? null;
  return supabase ? getLocalSession()?.id ?? null : null;
}

/**
 * Действующая ссылка проекта: одна на проект, пока её не отключили, — экран
 * приглашения не плодит коды при каждом открытии. RLS отдаёт строки
 * project_invites только активным участникам.
 */
export async function fetchActiveInvite(projectId: string): Promise<RemoteResult<string | null>> {
  if (!client) return { data: null, error: t('errors.noBackend') };
  const { data, error } = await client.from('project_invites').select('code,disabled_at,created_at').eq('project_id', projectId);
  if (error) return { data: null, error: error.message };
  const rows = ((data ?? []) as Array<{ code: string; disabled_at: string | null; created_at: string }>)
    .filter((r) => !r.disabled_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { data: rows[0]?.code ?? null, error: null };
}
