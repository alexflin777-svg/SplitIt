'use client';

/**
 * Итог периода (макеты h2-settle, h2-settle-anya/borya, h2-settle-error, h2-settle-lost,
 * h2-settled, h2-settled-1/1b, h2-paid, h3-settle, h3-done).
 *
 * Открытый период — предпросмотр тем же расчётом, что close_period, «из чего
 * сумма» у каждого, последствия над кнопкой. «Зафиксировать» отправляет
 * revision предпросмотра: изменились данные — база откажет, и экран попросит
 * посмотреть ещё раз. Два разных сбоя: отказ базы (ничего не изменилось) и
 * обрыв связи (неизвестно) — второй проверяется «Проверить статус», без повтора вслепую.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Lock, WifiOff } from 'lucide-react';
import { calculatePeriod } from '@/lib/project-calc';
import type { PersonResult } from '@/lib/project-calc';
import { buildPeriodInput, mapSnapshot } from '@/lib/projects-store';
import type { PeriodRow, ProjectData } from '@/lib/projects-store';
import { capitalize, consentState, formatQty, formatRub, monthName } from '@/lib/project-ui';
import { projects } from '@/lib/projects-client';
import { routes } from '@/lib/routes';
import { t as tPlain } from '@/lib/i18n/t';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, BlockHead, Card, Header, MainButton, Plaque, Segment, Skeleton, TopNav, V1Screen, cx } from '@/components/v1/ui';
import { DebtJournal, LoadError, PaidMark, RouteShell, TransferRow, memberIndex, memberName } from '@/components/v1/project-bits';
import { useProject } from '@/components/v1/useProject';
import type { LoadedProject } from '@/components/v1/useProject';

type Failure = { kind: 'refused'; message: string } | { kind: 'lost' } | { kind: 'changed' } | null;

function fmtDate(iso: string | null, locale: string, month: 'short' | 'long' = 'long'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month }).format(new Date(iso));
}

function Settle() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const periodParam = params.get('period');
  const { t } = useI18n();
  const { project, error, reload } = useProject(id, periodParam);

  if (!id || !project) {
    return (
      <V1Screen>
        <TopNav back={id ? routes.projectDetail(id) : routes.home()} />
        {!id ? <Plaque kind="err">{t('project.noId')}</Plaque> : error ? <LoadError message={error} onRetry={() => void reload()} /> : <Skeleton rows={4} />}
      </V1Screen>
    );
  }
  const period = periodParam ? project.data.periods.find((p) => p.id === periodParam) : project.data.periods.find((p) => p.status === 'open');
  if (!period) {
    return (
      <V1Screen>
        <TopNav back={routes.projectDetail(id)} />
        <Plaque kind="err">{t('settle.noPeriod')}</Plaque>
      </V1Screen>
    );
  }
  if (period.status === 'closed') {
    let snapOk = true;
    try {
      mapSnapshot(period.snapshot);
    } catch {
      // Снимок не читается — показываем ошибку, а не выдуманный итог.
      snapOk = false;
    }
    if (!snapOk) {
      return (
        <V1Screen>
          <TopNav back={routes.projectDetail(id)} />
          <Plaque kind="err">{t('settle.snapshotBroken')}</Plaque>
        </V1Screen>
      );
    }
    return <Settled projectId={id} project={project} period={period} reload={reload} />;
  }
  return (
    <Preview
      projectId={id}
      project={project}
      period={period}
      reload={reload}
      onClosed={(pid) => router.replace(routes.projectSettle(id, { period: pid }))}
    />
  );
}

function Why({ p, data }: { p: PersonResult; data: ProjectData }) {
  const { t } = useI18n();
  return (
    <Card className="px-4 py-3" testId="settle-why">
      <div className="flex items-start gap-3">
        <Avatar name={p.name} index={memberIndex(data, p.memberId)} />
        <div className="flex-1">
          <p className="text-base font-semibold">{p.name}</p>
          <p className="text-[15px] text-v1-muted">{t('settle.owedOnHand', { owed: formatRub(p.owed), onHand: formatRub(p.onHand) })}</p>
        </div>
        <div className="text-right">
          <p className="text-[17px] font-bold">{formatRub(Math.abs(p.transfer))}</p>
          <p className="text-[15px] text-v1-muted">{p.transfer > 0 ? t('settle.gets') : p.transfer < 0 ? t('settle.gives') : t('settle.even')}</p>
        </div>
      </div>
      <p className="mt-2 ml-[52px] text-[15px] font-bold text-v1-accent-ink">{t('settle.whyTitle', { amount: formatRub(p.owed) })}</p>
      <ul className="mt-2 ml-[52px] flex flex-col gap-1 text-[15px] text-v1-ink2" data-testid="settle-breakdown">
        {p.breakdown.map((b) => (
          <li key={b.kind + b.label} className="flex justify-between gap-2.5">
            <span>
              {b.label}
              {b.kind === 'rate' && b.accrued !== b.amount ? ` · ${t('settle.rateCut', { accrued: formatRub(b.accrued ?? 0) })}` : ''}
            </span>
            <b className="font-bold text-v1-ink whitespace-nowrap">{formatRub(b.amount)}</b>
          </li>
        ))}
        <li className="flex justify-between gap-2.5 pt-1.5 border-t-[1.5px] border-v1-fill font-bold text-v1-ink">
          <span>{t('settle.owedTotal')}</span>
          <span>{formatRub(p.owed)}</span>
        </li>
      </ul>
    </Card>
  );
}

function Preview({
  projectId,
  project,
  period,
  reload,
  onClosed,
}: {
  projectId: string;
  project: LoadedProject;
  period: PeriodRow;
  reload: () => Promise<LoadedProject | null>;
  onClosed: (periodId: string) => void;
}) {
  const { t, locale } = useI18n();
  const { data, ops, me, isOwner, uid } = project;
  const [busy, setBusy] = useState<'close' | 'check' | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const res = calculatePeriod(buildPeriodInput(data, period.id, ops));
  const [whyId, setWhyId] = useState<string>(() => me?.id ?? res.order[0]);
  const c = consentState(data, uid);
  const month = monthName(period.opened_at, locale);
  const transfers = [...res.transfers].sort((a, b) => Number(b.fromId === me?.id) - Number(a.fromId === me?.id));
  const blocked = !c.canClose ? t('project.consent.waiting', { names: c.waiting.join(', ') || '—' }) : ops.length === 0 ? t('settle.nothing') : !isOwner ? t('settle.ownerOnly') : null;

  const close = async () => {
    setBusy('close');
    setFailure(null);
    const r = await projects.closePeriod(projectId, period.revision);
    setBusy(null);
    if (r.data) return onClosed(period.id);
    const msg = r.error ?? '';
    if (msg === tPlain('errors.noServerConnection') || msg.includes('ответ не прочитан')) setFailure({ kind: 'lost' });
    else if (msg.includes('Данные изменились')) {
      await reload();
      setFailure({ kind: 'changed' });
    } else setFailure({ kind: 'refused', message: msg });
  };

  const check = async () => {
    setBusy('check');
    const fresh = await reload();
    setBusy(null);
    const now = fresh?.data.periods.find((p) => p.id === period.id);
    if (now?.status === 'closed') return onClosed(period.id);
    setFailure(fresh ? { kind: 'refused', message: t('settle.notClosedAfterCheck') } : { kind: 'lost' });
  };

  return (
    <V1Screen
      testId="settle-preview"
      dock={
        <>
          {failure?.kind !== 'lost' && (
            <div className="flex gap-2.5 items-start mb-2.5 px-3 py-2.5 rounded-row bg-v1-sand text-[15px] leading-snug font-semibold">
              <Lock className="w-[18px] h-[18px] mt-px flex-none" aria-hidden="true" />
              {blocked ?? t('settle.consequence', { month: capitalize(month) })}
            </div>
          )}
          {failure?.kind === 'lost' ? (
            <MainButton testId="settle-check" disabled={!!busy} onClick={() => void check()}>
              {busy === 'check' ? t('settle.checking') : t('settle.check')}
            </MainButton>
          ) : (
            <MainButton testId="settle-close" disabled={!!busy || !!blocked} onClick={() => void close()}>
              <Lock className="w-6 h-6" aria-hidden="true" />
              {busy === 'close' ? t('settle.closing') : failure?.kind === 'refused' ? t('common.retry') : t('settle.close')}
            </MainButton>
          )}
        </>
      }
    >
      <TopNav back={routes.projectDetail(projectId)} />
      <Header
        title={t('settle.title', { month })}
        sub={t('settle.sub', { from: fmtDate(period.opened_at, locale), profit: formatRub(res.profit) })}
      />

      {failure?.kind === 'refused' && (
        <Plaque kind="err" testId="settle-refused">
          <b>{t('settle.refused')}</b> {failure.message} {t('settle.refusedTail', { month: capitalize(month) })}
        </Plaque>
      )}
      {failure?.kind === 'lost' && (
        <>
          <Plaque kind="err" testId="settle-lost">
            <span className="inline-flex items-center gap-2 font-bold">
              <WifiOff className="w-4 h-4" aria-hidden="true" />
              {t('settle.lost')}
            </span>{' '}
            {t('settle.lostBody')}
          </Plaque>
          <Plaque kind="warn">
            <b>{t('settle.lostWhatTitle')}</b> {t('settle.lostWhat')}
          </Plaque>
        </>
      )}
      {failure?.kind === 'changed' && <Plaque kind="info">{t('settle.changed')}</Plaque>}

      {res.profit < 0 && (
        <div className="rounded-tile bg-v1-minus px-5 py-[18px] mb-2" data-testid="settle-loss">
          <p className="text-[30px] leading-[1.05] font-extrabold">{t('settle.loss', { amount: formatRub(-res.profit) })}</p>
          <p className="mt-1.5 text-[15px] text-v1-ink2">{t('settle.lossBody')}</p>
        </div>
      )}
      {res.notes.map((n) => (
        <Plaque key={n} kind="info">
          {n}
        </Plaque>
      ))}

      <div className="flex flex-col gap-1.5" data-testid="settle-transfers">
        {transfers.length === 0 && <Card className="text-[15px]">{t('settle.allEven')}</Card>}
        {transfers.map((x) => (
          <TransferRow key={x.fromId + x.toId} data={data} fromId={x.fromId} toId={x.toId} amount={x.amount} myMemberId={me?.id ?? null} />
        ))}
      </div>

      <BlockHead title={t('settle.whyBlock')} right={t('settle.whyRight')} />
      <Segment<string>
        value={whyId}
        onChange={setWhyId}
        options={res.order.map((mid) => ({ value: mid, label: mid === me?.id ? t('project.you') : res.perPerson[mid].name }))}
      />
      {res.perPerson[whyId] && <Why p={res.perPerson[whyId]} data={data} />}
    </V1Screen>
  );
}

function Settled({
  projectId,
  project,
  period,
  reload,
}: {
  projectId: string;
  project: LoadedProject;
  period: PeriodRow;
  reload: () => Promise<LoadedProject | null>;
}) {
  const { t, locale } = useI18n();
  const { data, me } = project;
  const [busy, setBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const snap = mapSnapshot(period.snapshot);
  const month = monthName(period.opened_at, locale);
  const marked = (f: string, to: string) => data.transfers.some((x) => x.period_id === period.id && x.from_member === f && x.to_member === to);
  const kind = (mid: string) => data.members.find((m) => m.id === mid)?.kind;
  const canMark = (f: string) => f === me?.id || (kind(f) === 'guest' && me?.status === 'active');
  const transfers = [...snap.transfers].sort((a, b) => Number(b.fromId === me?.id) - Number(a.fromId === me?.id));
  const done = transfers.filter((x) => marked(x.fromId, x.toId)).length;
  const todo = transfers.filter((x) => !marked(x.fromId, x.toId) && canMark(x.fromId));
  const mine = snap.members.find((m) => m.memberId === me?.id);
  const myOut = transfers.filter((x) => x.fromId === me?.id);
  const allDone = done === transfers.length;

  const mark = async (list: typeof transfers) => {
    setBusy(true);
    setMarkError(null);
    for (const x of list) {
      const r = await projects.markTransferPaid(period.id, x.fromId, x.toId);
      if (r.error) {
        setMarkError(r.error);
        break;
      }
    }
    await reload();
    setBusy(false);
  };
  const sum = todo.reduce((s, x) => s + x.amount, 0);
  const who = (mid: string) => (mid === me?.id ? t('project.you') : memberName(data, mid));

  return (
    <V1Screen
      testId="settle-done"
      dock={
        allDone ? (
          <div className="h-14 flex items-center justify-center gap-2 rounded-full bg-v1-plus font-bold text-base" data-testid="settle-all-marked">
            <Check className="w-5 h-5" aria-hidden="true" />
            {t('settled.allMarked', { month })}
          </div>
        ) : todo.length > 0 ? (
          <>
            {markError && <Plaque kind="err">{t('settled.markFailed', { error: markError })}</Plaque>}
            <MainButton testId="mark-all" disabled={busy} onClick={() => void mark(todo)}>
              <Check className="w-6 h-6" aria-hidden="true" />
              {busy
                ? t('add.saving')
                : todo.length > 1
                  ? t('settled.markAll', { amount: formatRub(sum) })
                  : t('settled.markOneMain', { name: who(todo[0].toId), amount: formatRub(sum) })}
            </MainButton>
            <p className="mt-2.5 text-center text-[15px] text-v1-muted">{t('settled.note')}</p>
          </>
        ) : undefined
      }
    >
      <TopNav back={routes.projectDetail(projectId)} />
      <Header title={t('settle.title', { month })} sub={data.project.name} />

      <div
        data-testid="settled-card"
        className={cx('rounded-tile px-5 pt-[18px] pb-5', allDone || (mine?.transfer ?? 0) >= 0 ? 'bg-v1-plus' : 'bg-v1-minus')}
      >
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-3 rounded-full bg-v1-card text-sm font-bold">
          <Lock className="w-4 h-4" aria-hidden="true" />
          {t('settled.badge', { date: fmtDate(period.closed_at, locale) })}
        </span>
        <p className="text-base font-semibold text-v1-ink2">
          {allDone ? t('settled.allSettled') : !mine || mine.transfer === 0 ? t('settled.even') : mine.transfer < 0 ? t('settled.youSend') : t('settled.youGet')}
        </p>
        {mine && mine.transfer !== 0 && <p className="mt-1 text-[46px] leading-none font-extrabold tracking-[-0.03em]">{formatRub(Math.abs(mine.transfer))}</p>}
        <p className="mt-2 text-[15px] text-v1-ink2">
          {myOut.length > 0 && !allDone
            ? `${myOut.map((x) => `${memberName(data, x.toId)} — ${formatRub(x.amount)}`).join(', ')}. `
            : ''}
          {t('settled.nextOpen')}
        </p>
      </div>

      <BlockHead title={t('settled.transfers')} right={t('settled.progress', { n: done, total: transfers.length })} />
      <div className="flex flex-col gap-1.5">
        {transfers.length === 0 && <Card className="text-[15px]">{t('settle.allEven')}</Card>}
        {transfers.map((x) => {
          const ok = marked(x.fromId, x.toId);
          return (
            <TransferRow
              key={x.fromId + x.toId}
              data={data}
              fromId={x.fromId}
              toId={x.toId}
              amount={x.amount}
              myMemberId={me?.id ?? null}
              paid={ok}
              status={ok ? <PaidMark>{t('settled.paid')}</PaidMark> : t('settled.notMarked')}
              action={
                !ok && canMark(x.fromId) ? (
                  <button
                    type="button"
                    disabled={busy}
                    data-testid="mark-one"
                    onClick={() => void mark([x])}
                    className="h-11 flex items-center justify-center gap-2 rounded-full bg-v1-card font-bold text-[15px] disabled:opacity-60"
                  >
                    <Check className="w-[18px] h-[18px]" aria-hidden="true" />
                    {t('settled.markOne', { name: who(x.toId) })}
                  </button>
                ) : undefined
              }
            />
          );
        })}
      </div>

      {(snap.ledger.length > 0 || data.ledger.length > 0) && (
        <DebtJournal data={data} debt={Object.fromEntries(snap.members.map((m) => [m.memberId, m.debtAfter]))} />
      )}
      {snap.members.some((m) => m.hours || m.pieces) && (
        <p className="mt-3 px-1 text-sm text-v1-muted">
          {snap.members
            .filter((m) => m.hours || m.pieces)
            .map((m) => `${m.name}: ${[m.hours ? `${formatQty(m.hours)} ${t('project.qty.h')}` : '', m.pieces ? `${formatQty(m.pieces)} ${t('project.qty.pcs')}` : ''].filter(Boolean).join(', ')}`)
            .join(' · ')}
        </p>
      )}
    </V1Screen>
  );
}

export default function Page() {
  return (
    <RouteShell>
      <Settle />
    </RouteShell>
  );
}
