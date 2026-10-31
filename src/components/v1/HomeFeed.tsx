'use client';

/**
 * Главная 1.1.0 (макеты h1-home, h1-home-project, h4-home-empty): сегмент
 * «Всё · События · Проекты», сводка «Тебе должны / Ты должен» по событиям и
 * проектам, плитки 2×2 с моей цифрой вместо общей суммы.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, RotateCw } from 'lucide-react';
import type { Group } from '@/lib/store';
import { computeEventSummary } from '@/lib/event-summary';
import { convertCurrency, formatMoney } from '@/lib/currency';
import { buildPeriodInput } from '@/lib/projects-store';
import { calculatePeriod } from '@/lib/project-calc';
import { consentState, monthName } from '@/lib/project-ui';
import { currentUserId, projects } from '@/lib/projects-client';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { BlockHead, MainButton, NumCard, Segment, Skeleton, cx } from './ui';

type Filter = 'all' | 'events' | 'projects';

export interface ProjectTile {
  id: string;
  name: string;
  currency: string;
  month: string;
  members: number;
  /** Моя цифра открытого периода, копейки: плюс — мне переведут, минус — я отдаю. */
  mine: number | null;
  accepted: number;
  users: number;
  waiting: boolean;
}

const TILE: Record<string, { bg: string; img: string | null }> = {
  trip: { bg: 'bg-v1-trip', img: '/v1/trip.png' },
  party: { bg: 'bg-[#FAD3E1]', img: '/v1/cake.png' },
  restaurant: { bg: 'bg-[#FAD3E1]', img: null },
  home: { bg: 'bg-v1-sand', img: '/v1/keys.png' },
  other: { bg: 'bg-[#DAE8DF]', img: '/v1/dacha.png' },
};

/** Без бэкенда проектов просто нет — это не ошибка главной. */
const NO_BACKEND = /бэкенд|backend/i;

/** Плитки проектов: моя цифра открытого периода и согласие. Ошибка — честно, без нулей. */
export function useProjectTiles(locale: string) {
  const [tiles, setTiles] = useState<ProjectTile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const uid = await currentUserId();
      const list = await projects.fetchProjects();
      if (!list.data) {
        if (alive) {
          setTiles([]);
          setError(list.error && !NO_BACKEND.test(list.error) ? list.error : null);
        }
        return;
      }
      const out: ProjectTile[] = [];
      let failed: string | null = null;
      for (const p of list.data) {
        const d = await projects.fetchProject(p.id);
        if (!d.data) {
          failed = d.error;
          continue;
        }
        const open = d.data.periods.find((x) => x.status === 'open');
        const ops = open ? await projects.fetchPeriodOperations(p.id, open.id) : null;
        const me = d.data.members.find((m) => m.user_id === uid);
        let mine: number | null = null;
        if (open && ops?.data && me) {
          mine = calculatePeriod(buildPeriodInput(d.data, open.id, ops.data)).perPerson[me.id]?.transfer ?? 0;
        } else if (ops?.error) failed = ops.error;
        const c = consentState(d.data, uid);
        const users = d.data.members.filter((m) => m.kind === 'user' && m.status === 'active').length;
        out.push({
          id: p.id,
          name: p.name,
          currency: p.currency,
          month: open ? monthName(open.opened_at, locale) : '',
          members: d.data.members.filter((m) => m.status === 'active').length,
          mine,
          accepted: users - c.waiting.length,
          users,
          waiting: !!c.pending && c.waiting.length > 0,
        });
      }
      if (alive) {
        setTiles(out);
        setError(failed);
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale, nonce]);

  return { tiles, error, retry: () => setNonce((n) => n + 1) };
}

export default function HomeFeed({
  groups,
  userId,
  currency,
  loadError,
  onRetry,
  avatar,
}: {
  groups: Group[];
  userId: string;
  currency: string;
  loadError: string | null;
  onRetry: () => void;
  avatar: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const { tiles, error: projectError, retry } = useProjectTiles(locale);

  const events = groups.map((g) => {
    const s = computeEventSummary(g);
    const mine = s.balances[userId]?.netAmount ?? 0;
    return { g, mine: Math.abs(mine) < 0.005 ? 0 : mine, total: s.total };
  });
  const toPref = (amount: number, cur: string) => convertCurrency(amount, cur || 'RUB', currency).convertedAmount;

  let owedToMe = 0;
  let iOwe = 0;
  let owedCount = 0;
  let oweCount = 0;
  let projectsInSums = false;
  for (const e of events) {
    if (e.mine > 0) {
      owedToMe += toPref(e.mine, e.g.currency);
      owedCount++;
    } else if (e.mine < 0) {
      iOwe += toPref(-e.mine, e.g.currency);
      oweCount++;
    }
  }
  for (const p of tiles ?? []) {
    if (!p.mine) continue;
    projectsInSums = true;
    if (p.mine > 0) {
      owedToMe += toPref(p.mine / 100, p.currency);
      owedCount++;
    } else {
      iOwe += toPref(-p.mine / 100, p.currency);
      oweCount++;
    }
  }
  const capKey = projectsInSums ? 'home.v1.inMixed' : 'home.v1.inEvents';

  const showEvents = filter !== 'projects';
  const showProjects = filter !== 'events';
  const projectCount = tiles?.length ?? 0;
  const empty = groups.length === 0 && projectCount === 0 && tiles !== null;

  return (
    <div className="font-v1 text-v1-ink bg-v1-bg -mx-4 -mt-4 px-4 pt-3 pb-44 min-h-[calc(100vh-4rem)] tabular-nums" data-testid="home-v1">
      <div className="flex items-center justify-between gap-4 pt-3.5 pb-4">
        <h1 className="text-[30px] leading-[1.08] font-extrabold tracking-[-0.02em]">{t('home.v1.title')}</h1>
        {avatar}
      </div>

      {(loadError || projectError) && (
        <div role="alert" className="flex items-center justify-between gap-3 px-3.5 py-3 mb-3 rounded-row bg-v1-warn text-[15px]">
          <span>{t('home.v1.loadFailed')}</span>
          <button
            type="button"
            onClick={() => {
              onRetry();
              retry();
            }}
            className="h-10 px-3.5 rounded-full bg-v1-card font-bold inline-flex items-center gap-1.5"
          >
            <RotateCw className="w-4 h-4" aria-hidden="true" />
            {t('common.retry')}
          </button>
        </div>
      )}

      {empty ? (
        <EmptyHome />
      ) : (
        <>
          <Segment<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('home.v1.segAll') },
              { value: 'events', label: t('home.v1.segEvents') },
              { value: 'projects', label: t('home.v1.segProjects') },
            ]}
          />

          <div className="grid grid-cols-2 gap-2">
            <NumCard
              tone="plus"
              label={t('home.v1.owedToYou')}
              amount={formatMoney(owedToMe, currency)}
              cap={owedCount ? t(capKey, { count: owedCount }) : t('home.v1.nobody')}
              testId="home-owed-to-me"
            />
            <NumCard
              tone="minus"
              label={t('home.v1.youOwe')}
              amount={formatMoney(iOwe, currency)}
              cap={oweCount ? t(capKey, { count: oweCount }) : t('home.v1.nothing')}
              testId="home-i-owe"
            />
          </div>

          <BlockHead
            title={t('home.v1.listTitle')}
            right={projectCount ? t('home.v1.listCountProjects', { count: groups.length + projectCount, projects: projectCount }) : String(groups.length)}
          />

          <div className="grid grid-cols-2 gap-2">
            {showProjects && tiles === null && <Skeleton rows={1} tall />}
            {showProjects &&
              (tiles ?? []).map((p) => (
                <Link
                  key={p.id}
                  href={routes.projectDetail(p.id)}
                  data-testid="project-tile"
                  className={cx(
                    'relative overflow-hidden isolate flex flex-col h-[204px] px-4 py-3.5 rounded-card bg-v1-lav active:scale-[0.98] transition-transform',
                    p.waiting && 'shadow-[inset_0_0_0_3px_var(--v1-accent)]',
                  )}
                >
                  <h3 className="text-lg leading-[1.12] font-extrabold tracking-[-0.015em] min-h-10 line-clamp-2">{p.name}</h3>
                  {p.waiting ? (
                    <>
                      <span className="mt-2 text-sm font-semibold text-v1-ink2">{t('home.v1.termsAccepted')}</span>
                      <span className="mt-0.5 text-[22px] leading-none font-extrabold">{t('home.v1.ofN', { n: p.accepted, total: p.users })}</span>
                    </>
                  ) : (
                    <>
                      <span className="mt-2 text-sm font-semibold text-v1-ink2">
                        {(p.mine ?? 0) < 0 ? t('home.v1.projectYouGive', { month: p.month }) : t('home.v1.projectYouGet', { month: p.month })}
                      </span>
                      <span className="mt-0.5 text-[22px] leading-none font-extrabold whitespace-nowrap">
                        {p.mine === null ? '—' : formatMoney(Math.abs(p.mine) / 100, p.currency)}
                      </span>
                    </>
                  )}
                  <span className="mt-1 text-sm leading-snug text-v1-ink2 relative z-[1]">
                    {t('home.v1.projectMeta', { month: p.month })}
                    <br />
                    {t('home.v1.people', { count: p.members })}
                  </span>
                  {p.waiting && (
                    <span className="absolute z-[1] left-3.5 bottom-3.5 px-3 py-1.5 rounded-full bg-v1-card text-sm font-bold">{t('home.v1.pillWaiting')}</span>
                  )}
                  <img src="/v1/receipts.png" alt="" className="absolute w-[84px] -right-2.5 -bottom-3 pointer-events-none" />
                </Link>
              ))}
            {showEvents &&
              events.map(({ g, mine, total }) => {
                const tile = TILE[g.category] ?? TILE.other;
                const closed = g.status === 'completed';
                return (
                  <Link
                    key={g.id}
                    href={routes.eventDetail(g.id)}
                    data-testid="event-tile"
                    className={cx('relative overflow-hidden isolate flex flex-col h-[204px] px-4 py-3.5 rounded-card active:scale-[0.98] transition-transform', tile.bg)}
                  >
                    <h3 className="text-lg leading-[1.12] font-extrabold tracking-[-0.015em] min-h-10 line-clamp-2">{g.name}</h3>
                    <span className="mt-2 text-sm font-semibold text-v1-ink2 relative z-[1]">
                      {mine > 0 ? t('home.v1.owedToYou') : mine < 0 ? t('home.v1.youOwe') : t('home.v1.settledUp')}
                    </span>
                    <span className="mt-0.5 text-[22px] leading-none font-extrabold whitespace-nowrap relative z-[1]">
                      {formatMoney(Math.abs(mine), g.currency || 'RUB')}
                    </span>
                    <span className="mt-1 text-sm leading-snug text-v1-ink2 relative z-[1]">
                      {t('home.v1.total', { amount: formatMoney(total, g.currency || 'RUB') })}
                      <br />
                      {t('home.v1.people', { count: g.members?.length || 1 })}
                    </span>
                    <span
                      className={cx(
                        'absolute z-[1] left-3.5 bottom-3.5 px-3 py-1.5 rounded-full text-sm font-bold',
                        closed ? 'bg-v1-ink text-white' : 'bg-v1-card',
                      )}
                    >
                      {closed ? t('home.v1.pillClosed') : mine !== 0 ? t('home.v1.pillDebts') : t('home.v1.pillActive')}
                    </span>
                    {tile.img && <img src={tile.img} alt="" className="absolute w-[84px] -right-2.5 -bottom-3 pointer-events-none" />}
                  </Link>
                );
              })}
          </div>
          {showProjects && !showEvents && projectCount === 0 && tiles !== null && (
            <p className="mt-3 text-[15px] text-v1-muted">{t('home.v1.noProjects')}</p>
          )}
        </>
      )}

      <div data-testid="home-dock" className="fixed left-0 right-0 z-40 bottom-0 px-4 pt-3 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] bg-v1-bg">
        <div className="max-w-md mx-auto">
          <MainButton href={routes.eventNew()} testId="home-create">
            <Plus className="w-6 h-6" aria-hidden="true" />
            {t('home.v1.create')}
          </MainButton>
        </div>
      </div>
    </div>
  );
}

function EmptyHome() {
  const { t } = useI18n();
  const tpls = [
    { label: t('home.v1.tplTrip'), img: '/v1/trip.png', bg: 'bg-v1-trip', href: routes.eventNew() },
    { label: t('home.v1.tplParty'), img: '/v1/cake.png', bg: 'bg-[#FAD3E1]', href: routes.eventNew() },
    { label: t('home.v1.tplDacha'), img: '/v1/dacha.png', bg: 'bg-[#DAE8DF]', href: routes.eventNew() },
    { label: t('home.v1.tplFlat'), img: '/v1/keys.png', bg: 'bg-v1-sand', href: routes.eventNew() },
    { label: t('home.v1.tplProject'), img: '/v1/receipts.png', bg: 'bg-v1-lav', href: routes.projectNew() },
  ];
  return (
    <>
      <div className="relative overflow-hidden isolate rounded-tile px-[22px] pt-6 pb-[100px] min-h-[270px] bg-v1-trip">
        <h2 className="text-[28px] leading-[1.08] font-extrabold tracking-[-0.02em]">{t('home.v1.emptyTitle')}</h2>
        <p className="mt-2.5 max-w-[18.5em] text-base text-v1-ink2 relative z-[1]">{t('home.v1.emptyBody')}</p>
        <img src="/v1/receipts.png" alt="" className="absolute w-[190px] -right-5 -bottom-8 -rotate-[4deg] pointer-events-none" />
      </div>
      <BlockHead title={t('home.v1.startWith')} />
      <div className="grid grid-cols-5 gap-1">
        {tpls.map((x) => (
          <Link key={x.label} href={x.href} className="flex flex-col items-center gap-2 font-semibold text-[13px]">
            <span className={cx('w-16 h-16 rounded-[20px] grid place-items-center', x.bg)}>
              <img src={x.img} alt="" className="w-12 h-12 object-contain" />
            </span>
            {x.label}
          </Link>
        ))}
      </div>
    </>
  );
}
