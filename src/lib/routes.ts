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

  // «Проект» (1.1.0): те же правила — id только в query string.
  projectNew: () => '/projects/new',
  projectDetail: (projectId: string) => withQuery('/projects/detail', { id: projectId }),
  /** Конструктор: изменение условий (до первого итога — первоначальных). */
  projectTerms: (projectId: string) => withQuery('/projects/terms', { id: projectId }),
  /** Согласие на условия, ждущие ответа. */
  projectConsent: (projectId: string) => withQuery('/projects/consent', { id: projectId }),
  /** Запись: type — income | expense | refund (of — доход) | qty (member — чьи часы/штуки). */
  projectAdd: (projectId: string, extra: Record<string, QueryValue> = {}) =>
    withQuery('/projects/add', { id: projectId, ...extra }),
  projectSettle: (projectId: string, extra: Record<string, QueryValue> = {}) =>
    withQuery('/projects/settle', { id: projectId, ...extra }),
  projectInvite: (projectId: string, extra: Record<string, QueryValue> = {}) =>
    withQuery('/projects/invite', { id: projectId, ...extra }),
  projectJoin: (code: string) => withQuery('/projects/join', { code }),
};

/** Абсолютная ссылка-приглашение в проект. */
export function absoluteProjectInviteLink(code: string): string | null {
  const origin = publicAppOrigin();
  return origin ? `${origin}${routes.projectJoin(code)}` : null;
}

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
