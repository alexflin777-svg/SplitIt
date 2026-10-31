'use client';

/** Блоки, общие для экрана проекта и итога: журнал долга по вкладам, строка перевода, оболочка маршрута. */

import { Suspense, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, Check } from 'lucide-react';
import type { LedgerRow, ProjectData } from '@/lib/projects-store';
import { formatRub, monthName } from '@/lib/project-ui';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, Card, Plaque, V1Screen, cx } from './ui';

/** useSearchParams требует Suspense-границы при output: 'export'. */
export function RouteShell({ children }: { children: ReactNode }) {
  return <Suspense fallback={<V1Screen>{null}</V1Screen>}>{children}</Suspense>;
}

export function memberIndex(data: ProjectData, memberId: string): number {
  return Math.max(0, data.members.findIndex((m) => m.id === memberId));
}

export function memberName(data: ProjectData, memberId: string): string {
  return data.members.find((m) => m.id === memberId)?.display_name ?? '—';
}

/** Ошибка загрузки + «Повторить»; данные из прошлой загрузки экран оставляет. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Plaque kind="err" testId="project-load-error">
      <p>{t('project.loadFailed', { error: message })}</p>
      <button type="button" onClick={onRetry} className="mt-2 h-10 px-4 rounded-full bg-v1-card font-bold">
        {t('common.retry')}
      </button>
    </Plaque>
  );
}

/**
 * Журнал долга по вкладам (§3а «Долг проекта по вкладам»): заголовок — сколько
 * осталось вернуть; по тапу — строки, новые сверху, с остатком после строки.
 * debt — долг на начало открытого периода (в периоде 1 включает вклады
 * первоначальных условий, которые журнал запишет при первом итоге).
 */
export function DebtJournal({ data, debt }: { data: ProjectData; debt: Record<string, number> }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const credited: Record<string, number> = {};
  const rest: Record<string, number> = {};
  const rows: Array<LedgerRow & { after: number }> = [];
  for (const r of data.ledger) {
    rest[r.member_id] = (rest[r.member_id] ?? 0) + (r.kind === 'credit' ? r.amount : -r.amount);
    if (r.kind === 'credit') credited[r.member_id] = (credited[r.member_id] ?? 0) + r.amount;
    rows.push({ ...r, after: rest[r.member_id] });
  }
  rows.reverse();
  const owed = Object.entries(debt).filter(([, v]) => v > 0);
  const hadAny = owed.length > 0 || rows.length > 0;
  const periodOf = (pid: string) => data.periods.find((p) => p.id === pid);

  return (
    <Card className="mt-3 px-4 py-3.5" testId="debt-journal">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-start justify-between gap-3 text-left">
        <div>
          <h3 className="text-lg font-extrabold leading-tight">{t('project.debt.title')}</h3>
          <div className="mt-0.5 text-[15px] text-v1-ink2">
            {!hadAny
              ? t('project.debt.none')
              : owed.length === 0
                ? t('project.debt.closed')
                : owed.map(([id, v]) => (
                    <p key={id}>
                      {t('project.debt.left', {
                        name: memberName(data, id),
                        amount: formatRub(v),
                        total: formatRub(Math.max(v, credited[id] ?? v)),
                      })}
                    </p>
                  ))}
          </div>
        </div>
        {hadAny && (
          <span className={cx('w-9 h-9 rounded-full bg-v1-bg grid place-items-center flex-none transition-transform', open && 'rotate-180')}>
            <ChevronDown className="w-[18px] h-[18px]" aria-hidden="true" />
          </span>
        )}
      </button>
      {open && (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {rows.length === 0 && <li className="px-3 py-2.5 rounded-[14px] bg-v1-bg text-[14px] text-v1-muted">{t('project.debt.firstClose')}</li>}
          {rows.map((r) => {
            const p = periodOf(r.period_id);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-[14px] bg-v1-bg">
                <div>
                  <div className="text-[15px] font-semibold">
                    {t(`project.debt.kind.${r.kind}`)}{' '}
                    <b className="font-extrabold">
                      {r.kind === 'credit' ? '+' : '−'}
                      {formatRub(r.amount)}
                    </b>
                  </div>
                  <div className="mt-px text-[14px] text-v1-muted">
                    {p ? monthName(p.opened_at, locale) : ''} · {memberName(data, r.member_id)}
                  </div>
                </div>
                <div className="text-right text-xs leading-tight text-v1-muted">
                  {t('project.debt.after')}
                  <br />
                  <b className="text-[15px] text-v1-ink font-bold">{formatRub(r.after)}</b>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Строка перевода «А → В · Ты → Вика · 41 000 ₽»; мой исходящий — персик, входящий — мята. */
export function TransferRow({
  data,
  fromId,
  toId,
  amount,
  myMemberId,
  status,
  action,
  paid,
}: {
  data: ProjectData;
  fromId: string;
  toId: string;
  amount: number;
  myMemberId: string | null;
  status?: ReactNode;
  action?: ReactNode;
  paid?: boolean;
}) {
  const { t } = useI18n();
  const out = fromId === myMemberId;
  const inc = toId === myMemberId;
  const who = (id: string) => (id === myMemberId ? t('project.you') : memberName(data, id));
  return (
    <div
      data-testid="transfer-row"
      className={cx(
        'flex flex-col gap-2.5 min-h-16 py-3 pr-4 pl-3 rounded-row',
        paid ? 'bg-v1-card' : out ? 'bg-v1-minus' : inc ? 'bg-v1-plus' : 'bg-v1-card',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-0.5 flex-none">
          <Avatar name={memberName(data, fromId)} index={memberIndex(data, fromId)} />
          <ArrowRight className="w-[18px] h-[18px] text-v1-muted" aria-hidden="true" />
          <Avatar name={memberName(data, toId)} index={memberIndex(data, toId)} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold">
            {who(fromId)} → {who(toId)}
          </div>
          {status && <div className="mt-0.5 text-sm text-v1-ink2">{status}</div>}
        </div>
        <div className="text-[17px] font-bold whitespace-nowrap">{formatRub(amount)}</div>
      </div>
      {action}
    </div>
  );
}

export function PaidMark({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-v1-ok font-bold">
      <Check className="w-4 h-4" aria-hidden="true" />
      {children}
    </span>
  );
}
