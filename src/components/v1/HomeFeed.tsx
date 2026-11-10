'use client';

/**
 * Главная 1.1.0 (макеты h1-home, h1-home-project, h4-home-empty): сегмент
 * «Всё · События · Проекты», сводка «Тебе должны / Ты должен» по событиям и
 * проектам, плитки 2×2 с моей цифрой вместо общей суммы.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Plus, RotateCw } from 'lucide-react';
import type { Group } from '@/lib/store';
import { computeEventSummary } from '@/lib/event-summary';
import { convertCurrency, formatMoney } from '@/lib/currency';
import { buildPeriodInput } from '@/lib/projects-store';
import { calculatePeriod } from '@/lib/project-calc';
import { consentState, monthName } from '@/lib/project-ui';
import { currentUserId, projects, snapshotUserId } from '@/lib/projects-client';
import { authGeneration, readSnap, settleSnap, writeSnap } from '@/lib/snapshot';
import { rememberOpenPeriod } from './useProject';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Art, BlockHead, MainButton, NumCard, Segment, Skeleton, cx } from './ui';
import type { ArtName } from './ui';

type Filter = 'all' | 'events' | 'projects';

export interface ProjectTile {
  id: string;
  name: string;
  currency: string;
  /** Начало открытого периода; месяц пишется при отрисовке — смена языка не перечитывает базу. */
  openedAt: string | null;
  members: number;
  /** Моя цифра открытого периода, копейки: плюс — мне переведут, минус — я отдаю. */
  mine: number | null;
  accepted: number;
  users: number;
  waiting: boolean;
}

const TILE: Record<string, { bg: string; img: ArtName | null }> = {
  trip: { bg: 'bg-v1-trip', img: 'trip' },
  party: { bg: 'bg-[#FAD3E1]', img: 'cake' },
  restaurant: { bg: 'bg-[#FAD3E1]', img: null },
  home: { bg: 'bg-v1-sand', img: 'keys' },
  other: { bg: 'bg-[#DAE8DF]', img: 'dacha' },
};
/** Первые четыре плитки — первый экран: их картинки не откладываются. */
const FIRST_SCREEN = 4;

/** Без бэкенда проектов просто нет — это не ошибка главной. */
const NO_BACKEND = /бэкенд|backend/i;

const TILES_SNAP = 'home-project-tiles';
const isTileList = (v: unknown) =>
  Array.isArray(v) && v.every((x) => !!x && typeof (x as ProjectTile).id === 'string' && typeof (x as ProjectTile).name === 'string');

/**
 * Плитки проектов: моя цифра открытого периода и согласие. Ошибка — честно, без нулей.
 * Сначала — снимок прошлого ответа (если есть), затем свежая сводка за два обращения к базе.
 */
export function useProjectTiles() {
  const [tiles, setTiles] = useState<ProjectTile[] | null>(() => readSnap<ProjectTile[]>(snapshotUserId(), TILES_SNAP, isTileList));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const gen = authGeneration();
      const [uid, home] = await Promise.all([currentUserId(), projects.fetchHome()]);
      // Ответ прежнего аккаунта: не показывать и не сохранять.
      if (gen !== authGeneration()) return;
      if (!home.data) {
        // Нет прав (403/42501, сессия отозвана) — снимок стёрт, плитки обнуляются;
        // сбой сети — снимок остаётся, сверху — ошибка и «Повторить».
        const denied = settleSnap(snapshotUserId(), TILES_SNAP, gen, home) === 'denied';
        if (alive) {
          setTiles((prev) => (denied ? [] : prev ?? []));
          setError(home.error && !NO_BACKEND.test(home.error) ? home.error : null);
        }
        return;
      }
      const out: ProjectTile[] = home.data.map(({ data: d, openOps }) => {
        const open = d.periods.find((x) => x.status === 'open');
        if (open) rememberOpenPeriod(d.project.id, open.id);
        const me = d.members.find((m) => m.user_id === uid);
        const mine = open && openOps && me ? calculatePeriod(buildPeriodInput(d, open.id, openOps)).perPerson[me.id]?.transfer ?? 0 : null;
        const c = consentState(d, uid);
        const users = d.members.filter((m) => m.kind === 'user' && m.status === 'active').length;
        return {
          id: d.project.id,
          name: d.project.name,
          currency: d.project.currency,
          openedAt: open?.opened_at ?? null,
          members: d.members.filter((m) => m.status === 'active').length,
          mine,
          accepted: users - c.waiting.length,
          users,
          waiting: !!c.pending && c.waiting.length > 0,
        };
      });
      writeSnap(uid, TILES_SNAP, out, gen);
      if (alive) {
        setTiles(out);
        setError(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

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
  const { tiles, error: projectError, retry } = useProjectTiles();

  // Пересчёт балансов — только при новых данных, не на каждое переключение сегмента.
  const events = useMemo(
    () =>
      groups.map((g) => {
        const s = computeEventSummary(g);
        const mine = s.balances[userId]?.netAmount ?? 0;
        return { g, mine: Math.abs(mine) < 0.005 ? 0 : mine, total: s.total };
      }),
    [groups, userId],
  );
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
              (tiles ?? []).map((p, i) => {
                const month = p.openedAt ? monthName(p.openedAt, locale) : '';
                return (
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
                        {(p.mine ?? 0) < 0 ? t('home.v1.projectYouGive', { month }) : t('home.v1.projectYouGet', { month })}
                      </span>
                      <span className="mt-0.5 text-[22px] leading-none font-extrabold whitespace-nowrap">
                        {p.mine === null ? '—' : formatMoney(Math.abs(p.mine) / 100, p.currency)}
                      </span>
                    </>
                  )}
                  <span className="mt-1 text-sm leading-snug text-v1-ink2 relative z-[1]">
                    {t('home.v1.projectMeta', { month })}
                    <br />
                    {t('home.v1.people', { count: p.members })}
                  </span>
                  {p.waiting && (
                    <span className="absolute z-[1] left-3.5 bottom-3.5 px-3 py-1.5 rounded-full bg-v1-card text-sm font-bold">{t('home.v1.pillWaiting')}</span>
                  )}
                  <Art name="receipts" eager={i < FIRST_SCREEN} className="absolute w-[84px] -right-2.5 -bottom-3 pointer-events-none" />
                </Link>
                );
              })}
            {showEvents &&
              events.map(({ g, mine, total }, i) => {
                const shown = (showProjects ? projectCount : 0) + i;
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
                    {tile.img && (
                      <Art name={tile.img} eager={shown < FIRST_SCREEN} className="absolute w-[84px] -right-2.5 -bottom-3 pointer-events-none" />
                    )}
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
    { label: t('home.v1.tplTrip'), img: 'trip' as const, bg: 'bg-v1-trip', href: routes.eventNew() },
    { label: t('home.v1.tplParty'), img: 'cake' as const, bg: 'bg-[#FAD3E1]', href: routes.eventNew() },
    { label: t('home.v1.tplDacha'), img: 'dacha' as const, bg: 'bg-[#DAE8DF]', href: routes.eventNew() },
    { label: t('home.v1.tplFlat'), img: 'keys' as const, bg: 'bg-v1-sand', href: routes.eventNew() },
    { label: t('home.v1.tplProject'), img: 'receipts' as const, bg: 'bg-v1-lav', href: routes.projectNew() },
  ];
  return (
    <>
      <div className="relative overflow-hidden isolate rounded-tile px-[22px] pt-6 pb-[100px] min-h-[270px] bg-v1-trip">
        <h2 className="text-[28px] leading-[1.08] font-extrabold tracking-[-0.02em]">{t('home.v1.emptyTitle')}</h2>
        <p className="mt-2.5 max-w-[18.5em] text-base text-v1-ink2 relative z-[1]">{t('home.v1.emptyBody')}</p>
        <Art name="receipts" eager className="absolute w-[190px] -right-5 -bottom-8 -rotate-[4deg] pointer-events-none" />
      </div>
      <BlockHead title={t('home.v1.startWith')} />
      <div className="grid grid-cols-5 gap-1">
        {tpls.map((x) => (
          <Link key={x.label} href={x.href} className="flex flex-col items-center gap-2 font-semibold text-[13px]">
            <span className={cx('w-16 h-16 rounded-[20px] grid place-items-center', x.bg)}>
              <Art name={x.img} eager className="w-12 h-12 object-contain" />
            </span>
            {x.label}
          </Link>
        ))}
      </div>
    </>
  );
}
