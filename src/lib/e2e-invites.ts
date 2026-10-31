/**
 * Только e2e-сборка (`npm run build:test`, NEXT_PUBLIC_OCR_TEST_HOOK=1) и только по
 * флагу localStorage `splitit_e2e_invites`=1, который ставит тест или съёмка:
 * приглашения события работают без бэкенда, ссылка строится от localhost.
 * Без флага — честная ошибка локального режима (e2e local-state, integrity).
 * Это тестовая подмена, не продуктовый режим.
 */

const FLAG = 'splitit_e2e_invites';
const CODES = 'splitit_e2e_invites_codes';

type Codes = Record<string, { groupId: string; expiresAt: string }>;

export function e2eInvites(): boolean {
  return (
    process.env.NEXT_PUBLIC_OCR_TEST_HOOK === '1' && typeof window !== 'undefined' && window.localStorage.getItem(FLAG) === '1'
  );
}

const load = (): Codes => JSON.parse(window.localStorage.getItem(CODES) ?? '{}') as Codes;
const save = (c: Codes) => window.localStorage.setItem(CODES, JSON.stringify(c));

export function fakeActiveInvite(groupId: string): { code: string; expiresAt: string } | null {
  const hit = Object.entries(load()).find(([, v]) => v.groupId === groupId);
  return hit ? { code: hit[0], expiresAt: hit[1].expiresAt } : null;
}

export function fakeCreateInvite(groupId: string): string {
  const code = `E2E${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
  save({ ...load(), [code]: { groupId, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() } });
  return code;
}

export function fakeDisableInvite(code: string): void {
  const c = load();
  delete c[code];
  save(c);
}

export function fakeRedeemInvite(code: string): string | null {
  return load()[code]?.groupId ?? null;
}
