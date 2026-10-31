'use client';

/**
 * Изменение условий (до первого итога — первоначальных): тот же конструктор,
 * старт — с действующих условий; новые участники — «в остатке не участвует,
 * ставки нет» (§3а.2). Отправка — propose_terms, дальше согласие всех.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import type { TermLine } from '@/lib/project-calc';
import { contributionsTotal, ledgerBalance, toCalcMember, toCalcTerms } from '@/lib/projects-store';
import { projects } from '@/lib/projects-client';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import TermsBuilder from '@/components/v1/TermsBuilder';
import { Plaque, Skeleton, TopNav, V1Screen } from '@/components/v1/ui';
import { LoadError, RouteShell } from '@/components/v1/project-bits';
import { useProject } from '@/components/v1/useProject';

function ChangeTerms() {
  const router = useRouter();
  const id = useSearchParams().get('id');
  const { t } = useI18n();
  const { project, error, reload } = useProject(id);

  if (!id || !project) {
    return (
      <V1Screen>
        <TopNav back={id ? routes.projectDetail(id) : routes.home()} />
        {!id ? <Plaque kind="err">{t('project.noId')}</Plaque> : error ? <LoadError message={error} onRetry={() => void reload()} /> : <Skeleton rows={4} />}
      </V1Screen>
    );
  }

  const { data } = project;
  const open = data.periods.find((p) => p.status === 'open')!;
  const current = toCalcTerms(data.terms.find((x) => x.id === open.terms_id)!, data.lines);
  const members = data.members.filter((m) => m.status === 'active').map(toCalcMember);
  const lines: TermLine[] = members.map(
    (m) =>
      // Новая версия: вклады и списания — только новые, прошлые уже в журнале.
      ({ ...(current.lines.find((l) => l.memberId === m.id) ?? emptyLine(m.id)), contribNew: 0, debtWriteOff: 0 }),
  );
  // В периоде 1 вклады первоначальной версии ещё не в журнале — новая версия их заменяет.
  const initial = open.seq === 1 ? { ...current, lines: members.map((m) => current.lines.find((l) => l.memberId === m.id) ?? emptyLine(m.id)) } : { ...current, lines };

  return (
    <TermsBuilder
      projectName={data.project.name}
      members={members}
      mode="change"
      initial={initial}
      ledgerDebt={ledgerBalance(data.ledger)}
      contributionsTotal={contributionsTotal(data, open.seq)}
      onExit={() => router.push(routes.projectDetail(id))}
      submitLabel={t('terms.submit.propose')}
      submitBusyLabel={t('terms.submit.sending')}
      onSubmit={async (terms, preset) => {
        const res = await projects.proposeTerms(id, terms, { preset });
        if (!res.data) return res.error ?? t('terms.notSent');
        router.push(routes.projectDetail(id));
        return null;
      }}
    />
  );
}

function emptyLine(memberId: string): TermLine {
  return {
    memberId,
    expensesBack: true,
    rate: { type: 'none', amount: 0 },
    inRemainder: false,
    shareBp: 0,
    contribNew: 0,
    contribKind: 'money',
    debtWriteOff: 0,
  };
}

export default function Page() {
  return (
    <RouteShell>
      <ChangeTerms />
    </RouteShell>
  );
}
