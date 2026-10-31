'use client';

/**
 * Итог события: «кто кому сколько» и кнопки «Поделиться итогом» / «Напомнить».
 *
 * Показывается в двух местах: экран «Подвести итог» (compact) и постоянный
 * блок закрытого события. Напоминание — системная шторка «Поделиться» с
 * готовым текстом: работает в web, Android и iOS без push-инфраструктуры
 * (push — следующий шаг, см. docs/specs/close-event-and-reminders.md).
 *
 * Вид — язык V1 (макеты h5-settle, h5-closed): белые строки переводов,
 * мой входящий — мята, исходящий — персик, как в TransferRow «Проекта».
 */

import { useState } from 'react';
import { ArrowRight, BellRing, CheckCircle2, Share2 } from 'lucide-react';
import { formatMoney } from '@/lib/currency';
import { buildReminderText, buildSummaryText, computeEventSummary } from '@/lib/event-summary';
import { shareText, ShareOutcome } from '@/lib/share';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, MainButton, cx } from '@/components/v1/ui';

type Props = {
  group: any;
  currentUserId?: string | null;
  compact?: boolean;
};

export default function EventSummary({ group, currentUserId, compact = false }: Props) {
  const { t } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const currency = group.currency || 'RUB';
  const summary = computeEventSummary(group);
  const fmt = (a: number, c: string) => formatMoney(a, c);
  // Цвет аватара — по порядку участников события, как на остальных экранах V1.
  const memberIdx = (id: string) => (group.members || []).findIndex((m: any) => m.id === id);
  const who = (id: string, name: string) => (currentUserId && id === currentUserId ? t('project.you') : name);

  const report = (outcome: ShareOutcome) => {
    if (outcome === 'copied') setNotice(t('summary.copied'));
    else if (outcome === 'failed') setNotice(t('summary.shareFailed'));
    else setNotice(null);
  };

  const onShareSummary = async () => {
    report(await shareText(buildSummaryText(group.name, summary, currency, t, fmt)));
  };

  const onRemind = async (index: number) => {
    const tr = summary.transfers[index];
    report(await shareText(buildReminderText(group.name, tr, currency, t, fmt)));
  };

  return (
    <div className="font-v1 text-v1-ink space-y-2" data-testid="event-summary">
      {summary.transfers.length === 0 ? (
        <p className="flex items-center gap-2.5 min-h-16 px-4 rounded-row bg-v1-card text-base font-semibold" data-testid="summary-all-settled">
          <CheckCircle2 className="w-5 h-5 flex-none text-v1-ok" aria-hidden="true" />
          {t('summary.allSettled')}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t('summary.transfersTitle')}>
          {summary.transfers.map((tr, i) => {
            const out = !!currentUserId && tr.fromId === currentUserId;
            const inc = !!currentUserId && tr.toId === currentUserId;
            return (
              <li
                key={`${tr.fromId}-${tr.toId}`}
                className={cx(
                  'flex flex-col gap-2.5 min-h-16 py-3 pr-4 pl-3 rounded-row',
                  out ? 'bg-v1-minus' : inc ? 'bg-v1-plus' : 'bg-v1-card',
                )}
                data-testid="summary-transfer"
              >
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-0.5 flex-none">
                    <Avatar name={tr.fromName} index={memberIdx(tr.fromId)} />
                    <ArrowRight className="w-[18px] h-[18px] text-v1-muted" aria-hidden="true" />
                    <Avatar name={tr.toName} index={memberIdx(tr.toId)} />
                  </span>
                  <span className="flex-1 min-w-0 text-base font-semibold break-words">
                    {who(tr.fromId, tr.fromName)} → {who(tr.toId, tr.toName)}
                  </span>
                  <span className="text-[17px] font-bold whitespace-nowrap">{fmt(tr.amount, currency)}</span>
                </div>
                {!compact && (
                  <button
                    type="button"
                    onClick={() => onRemind(i)}
                    className="self-start h-11 px-4 rounded-full bg-v1-bg inline-flex items-center gap-2 font-semibold text-[15px]"
                    aria-label={t('summary.remindAria', { name: tr.fromName })}
                  >
                    <BellRing className="w-4 h-4" aria-hidden="true" />
                    {t('summary.remind')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!compact && (
        <div className="pt-2">
          <MainButton onClick={onShareSummary}>
            <Share2 className="w-5 h-5" aria-hidden="true" />
            {t('summary.share')}
          </MainButton>
        </div>
      )}

      {notice && (
        <p role="status" className="text-[15px] font-semibold text-center text-v1-ink2">
          {notice}
        </p>
      )}
    </div>
  );
}
