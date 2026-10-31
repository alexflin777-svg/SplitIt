'use client';

/**
 * Проект (макеты h2-project, h1-accepted, h1-bory-declined): «Проект · <период>»,
 * моя цифра периода, доходы / общие расходы / прибыль, «за свой счёт», часы и
 * штуки, лента операций, журнал долга, главная кнопка «Подвести итог».
 */

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, Plus, UserPlus, X } from 'lucide-react';
import { calculatePeriod } from '@/lib/project-calc';
import { buildPeriodInput, toCalcTerms } from '@/lib/projects-store';
import type { OperationRow } from '@/lib/projects-store';
import { consentState, formatQty, formatRub, monthName, quantityFields } from '@/lib/project-ui';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, BlockHead, Card, Header, MainButton, Plaque, PillLink, Row, Skeleton, TopNav, V1Screen, cx } from '@/components/v1/ui';
import { DebtJournal, LoadError, RouteShell, memberIndex, memberName } from '@/components/v1/project-bits';
import { useProject } from '@/components/v1/useProject';

function fmtDay(iso: string, locale: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
}

function ProjectDetail() {
  const params = useSearchParams();
  const id = params.get('id');
  const accepted = params.get('accepted') === '1';
  const { t, locale } = useI18n();
  const { project, error, loading, reload } = useProject(id);

  if (!id) {
    return (
      <V1Screen>
        <TopNav back={routes.home()} />
        <Plaque kind="err">{t('project.noId')}</Plaque>
      </V1Screen>
    );
  }
  if (!project) {
    return (
      <V1Screen testId="project-screen">
        <TopNav back={routes.home()} />
        {error ? <LoadError message={error} onRetry={() => void reload()} /> : <Skeleton rows={4} tall />}
      </V1Screen>
    );
  }

  const { data, ops, me, isOwner, uid } = project;
  const open = data.periods.find((p) => p.status === 'open')!;
  const termsRow = data.terms.find((x) => x.id === open.terms_id)!;
  const terms = toCalcTerms(termsRow, data.lines);
  const input = buildPeriodInput(data, open.id, ops);
  const res = calculatePeriod(input);
  const c = consentState(data, uid);
  const month = monthName(open.opened_at, locale);
  const nowMonth = monthName(new Date().toISOString(), locale);
  const mine = me ? res.perPerson[me.id] : undefined;

  const lineOf = new Map(terms.lines.map((l) => [l.memberId, l]));
  const ownExpenses = ops
    .filter((o) => o.op_type === 'expense' && lineOf.get(o.member_id)?.expensesBack === false)
    .reduce((s, o) => s + o.amount_in_project_currency, 0);
  const sharedExpenses = res.netIncome - res.profit;

  const qtyMembers = data.members
    .filter((m) => m.status === 'active')
    .map((m) => ({
      m,
      f: quantityFields(lineOf.get(m.id), terms.remainderMethod),
      q: data.quantities.find((q) => q.period_id === open.id && q.member_id === m.id),
    }))
    .filter((x) => x.f.hours || x.f.pieces);

  const canSettle = isOwner && c.canClose && ops.length > 0;
  const myTurn = !!me && c.waiting.includes(me.display_name) && !c.answered;
  // Ответы на последние предложенные условия (макет h1-bory-declined): кто принял, кто против.
  const lastAsk = data.terms
    .filter((x) => x.status === 'proposed' || x.status === 'rejected')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .at(-1);
  const consentRows = lastAsk
    ? data.members
        .filter((m) => m.kind === 'user' && m.status === 'active' && m.user_id !== lastAsk.proposed_by)
        .map((m) => ({ m, d: data.approvals.find((a) => a.terms_id === lastAsk.id && a.user_id === m.user_id)?.decision }))
    : [];
  const closed = data.periods.filter((p) => p.status === 'closed').reverse();
  const opLine = (o: OperationRow) => {
    const who = memberName(data, o.member_id);
    if (o.op_type === 'income') return t('project.op.incomeTo', { name: who });
    if (o.op_type === 'income_refund') return t('project.op.refundBy', { name: who });
    return lineOf.get(o.member_id)?.expensesBack === false ? t('project.op.paidOwn', { name: who }) : t('project.op.paidBy', { name: who });
  };

  return (
    <V1Screen
      testId="project-screen"
      dock={
        c.declinedBy && isOwner ? (
          <MainButton href={routes.projectTerms(id)} testId="project-declined-change">
            {t('project.consent.change')}
          </MainButton>
        ) : canSettle ? (
          <MainButton href={routes.projectSettle(id)} testId="project-settle">
            {t('project.settle')}
          </MainButton>
        ) : (
          <MainButton href={routes.projectAdd(id, { type: 'income' })} testId="project-add">
            <Plus className="w-6 h-6" aria-hidden="true" />
            {t('project.record')}
          </MainButton>
        )
      }
    >
      <TopNav
        back={routes.home()}
        right={
          canSettle ? (
            <PillLink href={routes.projectAdd(id, { type: 'income' })}>
              <Plus className="w-5 h-5" aria-hidden="true" />
              {t('project.record')}
            </PillLink>
          ) : (
            <PillLink href={routes.projectInvite(id)}>
              <UserPlus className="w-5 h-5" aria-hidden="true" />
              {t('project.invite')}
            </PillLink>
          )
        }
      />
      <Header
        kicker={t('project.kicker', { month })}
        title={data.project.name}
        sub={nowMonth !== month ? t('project.monthOpenNext', { next: nowMonth }) : t('project.monthOpen')}
      />

      {error && <LoadError message={error} onRetry={() => void reload()} />}
      {accepted && c.canClose && (
        <Plaque kind="ok" testId="terms-accepted">
          {t('project.consent.allAccepted')}
        </Plaque>
      )}
      {c.declinedBy && (
        <Plaque kind="err" testId="terms-declined">
          <b>{t('project.consent.declined', { name: c.declinedBy })}</b>
        </Plaque>
      )}
      {c.declinedBy && consentRows.length > 0 && (
        <>
          <BlockHead
            title={t('project.consent.list')}
            right={t('home.v1.ofN', { n: consentRows.filter((r) => r.d === 'accept').length, total: consentRows.length })}
          />
          <div className="flex flex-col gap-1.5" data-testid="consent-list">
            {consentRows.map(({ m, d }) => (
              <Row
                key={m.id}
                left={<Avatar name={m.display_name} index={memberIndex(data, m.id)} />}
                title={m.display_name}
                meta={d === 'accept' ? t('project.consent.yes') : d === 'decline' ? t('project.consent.no') : t('project.consent.none')}
                right={
                  d ? (
                    <span className={cx('w-10 h-10 rounded-full grid place-items-center', d === 'accept' ? 'bg-v1-plus' : 'bg-[#FFD6D3] text-v1-danger')}>
                      {d === 'accept' ? <Check className="w-5 h-5" aria-hidden="true" /> : <X className="w-5 h-5" aria-hidden="true" />}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
          <p className="mt-2 mb-3 px-1 text-[15px] text-v1-muted">
            {t('project.consent.again', { names: consentRows.map((r) => r.m.display_name).join(', ') })}
          </p>
        </>
      )}
      {/* После отказа владельцу нужен один ответ — «предложите другие»; пассивное «ждём» по прежним условиям его путает. */}
      {c.pending && c.waiting.length > 0 && (myTurn || !c.declinedBy) && (
        <Plaque kind="info" testId="terms-waiting">
          {myTurn ? (
            <Link href={routes.projectConsent(id)} className="font-bold text-v1-accent-ink underline" data-testid="consent-link">
              {t('project.consent.acceptCta')}
            </Link>
          ) : (
            t('project.consent.waiting', { names: c.waiting.join(', ') })
          )}
        </Plaque>
      )}

      {mine && (
        <div data-testid="project-mine" className={cx('rounded-tile px-5 pt-4 pb-[18px]', mine.transfer < 0 ? 'bg-v1-minus' : 'bg-v1-plus')}>
          <div className="text-base font-semibold text-v1-ink2">
            {mine.transfer < 0
              ? t('project.mine.give', { month })
              : mine.transfer > 0
                ? t('project.mine.get', { month })
                : t('project.mine.even', { month })}
          </div>
          <div className="mt-1 text-[40px] leading-none font-extrabold tracking-[-0.03em]">{formatRub(Math.abs(mine.transfer))}</div>
          <div className="mt-2 text-[15px] text-v1-ink2">{t('project.mine.why', { owed: formatRub(mine.owed), onHand: formatRub(mine.onHand) })}</div>
        </div>
      )}

      <div className="mt-2 grid grid-cols-3 gap-1.5" data-testid="project-stats">
        {(
          [
            [t('project.stat.income'), res.netIncome],
            [t('project.stat.expenses'), sharedExpenses],
            [t('project.stat.profit'), res.profit],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="px-3 py-2.5 rounded-row bg-v1-card">
            <div className="text-sm leading-tight text-v1-muted">{label}</div>
            <div className="mt-0.5 text-[17px] font-extrabold tracking-[-0.01em] whitespace-nowrap">{formatRub(v)}</div>
          </div>
        ))}
      </div>
      {ownExpenses > 0 && <p className="mt-2 px-1 text-sm text-v1-muted">{t('project.ownExpenses', { amount: formatRub(ownExpenses) })}</p>}

      {qtyMembers.length > 0 && (
        <>
          <BlockHead title={t('project.qty.title', { month })} />
          <div className="flex flex-col gap-1.5" data-testid="qty-block">
            {qtyMembers.map(({ m, f, q }) => {
              const parts = [
                f.hours && q ? `${formatQty(q.hours)} ${t('project.qty.h')}` : null,
                f.pieces && q ? `${formatQty(q.pieces)} ${t('project.qty.pcs')}` : null,
              ].filter(Boolean);
              const canEnter = m.user_id === uid || (m.kind === 'guest' && isOwner);
              const missing =
                lineOf.get(m.id)?.rate.type === 'hourly' || lineOf.get(m.id)?.rate.type === 'piece'
                  ? t('project.qty.missingRate', { month })
                  : t('project.qty.missingShare', { month });
              return (
                <Row
                  key={m.id}
                  left={<Avatar name={m.display_name} index={memberIndex(data, m.id)} />}
                  title={m.kind === 'guest' ? t('project.guestName', { name: m.display_name }) : m.display_name}
                  meta={parts.length ? parts.join(' · ') : missing}
                  right={
                    canEnter ? (
                      <Link
                        href={routes.projectAdd(id, { type: 'qty', member: m.id })}
                        className="h-10 px-3.5 rounded-full bg-v1-bg text-[15px] font-bold inline-flex items-center"
                        data-testid="qty-enter"
                      >
                        {t('project.qty.enter')}
                      </Link>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        </>
      )}

      <BlockHead title={t('project.feed.title')} right={t('project.feed.count', { count: ops.length })} />
      {loading && ops.length === 0 ? (
        <Skeleton rows={2} />
      ) : ops.length === 0 ? (
        <Card className="text-[15px] text-v1-ink2">{t('project.feed.empty')}</Card>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid="project-feed">
          {[...ops].reverse().map((o) => {
            const row = (
            <Row
              className={o.op_type === 'income' ? 'bg-v1-accent-soft' : undefined}
              left={
                <span className="w-10 h-10 rounded-full bg-v1-bg grid place-items-center flex-none">
                  <span
                    className={cx(
                      'w-3 h-3 rounded-full',
                      o.op_type === 'income' ? 'bg-[#2E9D5B]' : o.op_type === 'income_refund' ? 'bg-[#F08A4B]' : 'bg-v1-muted',
                    )}
                  />
                </span>
              }
              title={o.title || t(`project.op.type.${o.op_type}`)}
              meta={`${fmtDay(o.occurred_on, locale)} · ${opLine(o)}`}
              right={`${o.op_type === 'income' ? '+' : o.op_type === 'income_refund' ? '−' : ''}${formatRub(o.amount_in_project_currency)}`}
            />
            );
            // Править и удалять может автор или владелец (как private.project_lock_operation).
            return o.created_by === uid || isOwner ? (
              <Link key={o.id} href={routes.projectAdd(id, { op: o.id })} data-testid="op-edit">
                {row}
              </Link>
            ) : (
              <div key={o.id}>{row}</div>
            );
          })}
          {ops.some((o) => o.op_type === 'income') && (
            <Link
              href={routes.projectAdd(id, { type: 'refund' })}
              className="self-start mt-1 h-10 px-3.5 rounded-full bg-v1-card text-[15px] font-bold inline-flex items-center"
            >
              {t('project.refund.cta')}
            </Link>
          )}
        </div>
      )}

      {(terms.contribEnabled || data.ledger.length > 0) && <DebtJournal data={data} debt={input.debtAtStart ?? {}} />}

      <BlockHead title={t('project.people')} right={String(data.members.filter((m) => m.status === 'active').length)} />
      <ul className="flex flex-wrap gap-x-3 gap-y-2">
        {data.members
          .filter((m) => m.status === 'active')
          .map((m) => (
            <li key={m.id} className="w-14 flex flex-col items-center gap-1.5 text-sm font-semibold">
              <Avatar name={m.display_name} index={memberIndex(data, m.id)} size="l" />
              <span className="truncate max-w-14">{m.id === me?.id ? t('project.you') : m.display_name}</span>
            </li>
          ))}
        <li className="w-14 flex flex-col items-center gap-1.5 text-sm font-semibold">
          <Link href={routes.projectInvite(id)} aria-label={t('project.invite')} className="w-14 h-14 rounded-full bg-v1-card grid place-items-center">
            <Plus className="w-6 h-6" aria-hidden="true" />
          </Link>
          {t('project.invite')}
        </li>
      </ul>
      <div className="mt-3 flex gap-2">
        <Link
          href={routes.projectTerms(id)}
          className="h-11 px-4 rounded-full bg-v1-card font-bold text-[15px] inline-flex items-center"
          data-testid="project-change-terms"
        >
          {t('project.changeTerms')}
        </Link>
      </div>

      {closed.length > 0 && (
        <>
          <BlockHead title={t('project.past')} />
          <div className="flex flex-col gap-1.5">
            {closed.map((p) => (
              <Link key={p.id} href={routes.projectSettle(id, { period: p.id })}>
                <Row title={t('project.pastRow', { month: monthName(p.opened_at, locale) })} meta={t('project.pastMeta')} />
              </Link>
            ))}
          </div>
        </>
      )}
    </V1Screen>
  );
}

export default function Page() {
  return (
    <RouteShell>
      <ProjectDetail />
    </RouteShell>
  );
}
