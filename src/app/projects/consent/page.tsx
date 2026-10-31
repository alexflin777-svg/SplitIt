'use client';

/**
 * Согласие на условия (макеты h1-bory, h1-bory-terms): «Что для тебя», правило
 * вкладов и убытка, все условия по участникам, «Принять» / «Не согласен».
 * Результат — на экране проекта (h1-accepted / h1-bory-declined).
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown, Users } from 'lucide-react';
import { simulatePreview } from '@/lib/project-calc';
import { ledgerBalance, toCalcMember, toCalcTerms } from '@/lib/projects-store';
import { consentState, formatQty, formatRub, lineSummary } from '@/lib/project-ui';
import { projects } from '@/lib/projects-client';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, Card, Header, MainButton, Plaque, SecondButton, Skeleton, TopNav, V1Screen, cx } from '@/components/v1/ui';
import { LoadError, RouteShell, memberIndex, memberName } from '@/components/v1/project-bits';
import { useProject } from '@/components/v1/useProject';

function Consent() {
  const router = useRouter();
  const id = useSearchParams().get('id');
  const { t } = useI18n();
  const { project, error, reload } = useProject(id);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [actError, setActError] = useState<string | null>(null);

  if (!id || !project) {
    return (
      <V1Screen>
        <TopNav back={id ? routes.projectDetail(id) : routes.home()} />
        {!id ? <Plaque kind="err">{t('project.noId')}</Plaque> : error ? <LoadError message={error} onRetry={() => void reload()} /> : <Skeleton rows={4} />}
      </V1Screen>
    );
  }

  const { data, me, uid } = project;
  const c = consentState(data, uid);
  const pending = c.pending;
  if (!pending || !me || c.answered) {
    return (
      <V1Screen testId="consent-screen">
        <TopNav back={routes.projectDetail(id)} />
        <Header title={t('consent.title')} sub={data.project.name} />
        <Plaque kind="info">{c.answered ? t('consent.alreadyAnswered') : t('consent.nothing')}</Plaque>
      </V1Screen>
    );
  }

  const terms = toCalcTerms(pending, data.lines);
  const members = data.members.filter((m) => m.status === 'active').map(toCalcMember);
  const myLine = terms.lines.find((l) => l.memberId === me.id);
  const proposer = data.members.find((m) => m.user_id === pending.proposed_by)?.display_name ?? '—';
  const acceptedNames = data.members
    .filter((m) => m.kind === 'user' && m.user_id !== pending.proposed_by && m.id !== me.id && !c.waiting.includes(m.display_name))
    .map((m) => m.display_name);
  const sample = simulatePreview({ members, terms, ledgerDebt: ledgerBalance(data.ledger) }).after;
  const split =
    terms.remainderMethod === 'percent'
      ? terms.lines.filter((l) => l.inRemainder).map((l) => formatQty(l.shareBp)).join(' / ')
      : t(`terms.method.${terms.remainderMethod}`);

  const forMe: string[] = [];
  if (myLine) {
    if (terms.contribEnabled && myLine.contribNew > 0) forMe.push(t('consent.me.contrib', { amount: formatRub(myLine.contribNew) }));
    forMe.push(myLine.rate.type === 'none' ? t('consent.me.noRate') : t(`project.sum.rate.${myLine.rate.type}`, { amount: formatRub(myLine.rate.amount) }));
    forMe.push(
      !myLine.inRemainder
        ? t('project.sum.noRemainder')
        : terms.remainderMethod === 'percent'
          ? t('consent.me.share', { pct: formatQty(myLine.shareBp) })
          : t('consent.me.shareBy', { how: t(`terms.method.${terms.remainderMethod}`) }),
    );
    forMe.push(myLine.expensesBack ? t('consent.me.expensesBack') : t('consent.me.ownExpenses'));
  } else {
    forMe.push(t('consent.me.notIn'));
  }

  const act = async (accept: boolean) => {
    setBusy(accept ? 'accept' : 'decline');
    setActError(null);
    const res = accept ? await projects.acceptTerms(pending.id) : await projects.declineTerms(pending.id);
    setBusy(null);
    if (res.error) {
      setActError(res.error);
      return;
    }
    router.push(accept ? `${routes.projectDetail(id)}&accepted=1` : routes.projectDetail(id));
  };

  return (
    <V1Screen
      testId="consent-screen"
      dock={
        <>
          {actError && <Plaque kind="err">{t('consent.failed', { error: actError })}</Plaque>}
          <MainButton testId="consent-accept" disabled={!!busy} onClick={() => void act(true)}>
            <Check className="w-6 h-6" aria-hidden="true" />
            {busy === 'accept' ? t('consent.accepting') : t('consent.accept')}
          </MainButton>
          <SecondButton testId="consent-decline" disabled={!!busy} onClick={() => void act(false)}>
            {busy === 'decline' ? t('consent.sending') : t('consent.decline')}
          </SecondButton>
        </>
      }
    >
      <TopNav back={routes.projectDetail(id)} />
      <span className="inline-flex h-8 items-center px-3 rounded-full bg-v1-ink text-white text-sm font-bold">{t('consent.youAre', { name: me.display_name })}</span>
      <Header title={t('consent.title')} sub={t('consent.sub', { project: data.project.name, name: proposer })} />

      <Plaque kind="info">
        {acceptedNames.length ? t('consent.othersAccepted', { names: acceptedNames.join(', ') }) : t('consent.waitingYou')}
      </Plaque>

      <div className="rounded-card bg-v1-plus px-4 py-3.5" data-testid="consent-for-me">
        <p className="text-[15px] font-semibold text-v1-ink2">{t('consent.forMe')}</p>
        <ul className="mt-2 flex flex-col gap-1 text-base font-semibold">
          {forMe.map((x) => (
            <li key={x}>· {x}</li>
          ))}
        </ul>
        <p className="mt-2.5 text-[15px] text-v1-ink2">{t('consent.example', { amount: formatRub(sample.perPerson[me.id]?.owed ?? 0) })}</p>
      </div>

      <div className="my-2 px-3.5 py-3 rounded-row bg-v1-card text-base leading-snug font-semibold">
        {terms.contribEnabled ? t('consent.ruleContrib', { split }) : t('consent.rule', { split })}
      </div>

      <button
        type="button"
        aria-expanded={all}
        onClick={() => setAll((v) => !v)}
        data-testid="consent-all"
        className="w-full flex items-center gap-3 min-h-16 py-3 pr-4 pl-3 bg-v1-card rounded-row text-left"
      >
        <span className="w-10 h-10 rounded-full bg-v1-bg grid place-items-center flex-none">
          <Users className="w-5 h-5" aria-hidden="true" />
        </span>
        <span className="flex-1">
          <span className="block text-base font-semibold">{t('consent.allTerms')}</span>
          <span className="block text-sm text-v1-muted">{t('consent.allTermsSub')}</span>
        </span>
        <ChevronDown className={cx('w-5 h-5 text-v1-muted transition-transform', all && 'rotate-180')} aria-hidden="true" />
      </button>
      {all && (
        <div className="mt-2 flex flex-col gap-1.5">
          <Card className="px-4 py-3">
            <p className="text-sm text-v1-muted">{t('terms.chain.title')}</p>
            <p className="font-bold">{t('terms.chain.body')}</p>
          </Card>
          {terms.lines.map((l) => (
            <Card key={l.memberId} className="flex gap-3 px-4 py-3.5">
              <Avatar name={memberName(data, l.memberId)} index={memberIndex(data, l.memberId)} />
              <div>
                <p className="text-[17px] font-bold">
                  {memberName(data, l.memberId)}
                  {l.memberId === me.id ? ` · ${t('project.you').toLowerCase()}` : ''}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-[15px] text-v1-ink2">
                  {lineSummary(l, terms, t)
                    .split(' · ')
                    .map((x) => (
                      <li key={x}>· {x}</li>
                    ))}
                </ul>
              </div>
            </Card>
          ))}
        </div>
      )}
    </V1Screen>
  );
}

export default function Page() {
  return (
    <RouteShell>
      <Consent />
    </RouteShell>
  );
}
