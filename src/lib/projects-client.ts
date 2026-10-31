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
import { getActiveSession, supabase } from './supabase';
import { createFakeProjectsClient, fakeActor } from './projects-e2e-fake';
import { t } from './i18n/t';

const E2E_FAKE = !supabase && process.env.NEXT_PUBLIC_OCR_TEST_HOOK === '1';

const client: SupabaseClient | null =
  supabase ?? (E2E_FAKE && typeof window !== 'undefined' ? (createFakeProjectsClient() as unknown as SupabaseClient) : null);

export const projects = createProjectsStore(client);

/** auth.uid() вызывающего: с ним сравниваются user_id участников и owner_id. */
export async function currentUserId(): Promise<string | null> {
  if (E2E_FAKE) return fakeActor()?.id ?? null;
  return (await getActiveSession())?.id ?? null;
}

/**
 * Действующая ссылка проекта: одна на проект, пока её не отключили, — экран
 * приглашения не плодит коды при каждом открытии. RLS отдаёт строки
 * project_invites только активным участникам.
 */
export async function fetchActiveInvite(projectId: string): Promise<RemoteResult<string | null>> {
  if (!client) return { data: null, error: t('errors.noBackend') };
  const { data, error } = await client.from('project_invites').select('*').eq('project_id', projectId);
  if (error) return { data: null, error: error.message };
  const rows = ((data ?? []) as Array<{ code: string; disabled_at: string | null; created_at: string }>)
    .filter((r) => !r.disabled_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { data: rows[0]?.code ?? null, error: null };
}
