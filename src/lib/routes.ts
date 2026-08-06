import { APP_URL } from './env';

/**
 * Единая точка формирования ссылок (инвариант И-2).
 *
 * Раньше экраны события жили на маршрутах вида /events/[id]/balance. При
 * output: 'export' Next может собрать только те id, которые вернул
 * generateStaticParams, а он возвращал три зашитых значения: group-1, group-2,
 * group-sochi-2026. Событие, созданное пользователем, получает id вида
 * group-<timestamp>, файла под него в out/ нет, и статический хостинг отдаёт
 * 404. В next dev баг не воспроизводится вообще — он живёт только в APK, IPA и
 * на статик-хостинге, то есть ровно там, где его видит пользователь.
 *
 * Поэтому id уехал из пути в query-строку: маршрутов теперь фиксированное
 * число, а идентификатор читается на клиенте. Все ссылки собираются здесь,
 * чтобы следующий экран нельзя было добавить мимо этого правила.
 */

type QueryValue = string | number | boolean | undefined | null;

function withQuery(pathname: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export const routes = {
  home: () => '/',
  auth: (mode?: 'register' | 'login' | 'reset' | 'update-password', next?: string) =>
    withQuery('/auth', { mode, next }),
  friends: () => '/friends',
  profile: () => '/profile',

  eventNew: () => '/events/new',

  eventDetail: (groupId: string, extra: Record<string, QueryValue> = {}) =>
    withQuery('/events/detail', { id: groupId, ...extra }),

  /**
   * Приглашение несёт одноразовый код, а не id группы. По id вступить нельзя:
   * политика на group_members разрешает прямую запись только владельцу, а
   * коды не видны посторонним. Раньше ссылка передавала id, и получатель
   * попадал на пустой экран либо на выдуманную группу.
   */
  invite: (code: string) => withQuery('/invite', { code }),

  eventBalance: (groupId: string) => withQuery('/events/balance', { id: groupId }),

  eventSettle: (groupId: string, extra: Record<string, QueryValue> = {}) =>
    withQuery('/events/settle', { id: groupId, ...extra }),

  eventExport: (groupId: string) => withQuery('/events/export', { id: groupId }),

  expenseNew: (groupId: string) => withQuery('/events/expense/new', { id: groupId }),

  expenseEdit: (groupId: string, expenseId: string) =>
    withQuery('/events/expense/edit', { id: groupId, expenseId }),
};

/** Абсолютная ссылка-приглашение для отправки во внешние мессенджеры. */
function publicAppOrigin(): string {
  const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicRuntimeOrigin = /^https:\/\/(?!localhost(?::|$)|127\.0\.0\.1(?::|$))[^\s]+$/i.test(runtimeOrigin)
    ? runtimeOrigin
    : '';
  return APP_URL || publicRuntimeOrigin;
}

export function hasPublicInviteOrigin(): boolean {
  return publicAppOrigin() !== '';
}

export function absoluteInviteLink(code: string): string | null {
  const origin = publicAppOrigin();
  return origin ? `${origin}${routes.invite(code)}` : null;
}
