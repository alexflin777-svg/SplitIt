'use client';

/**
 * Итог события: «кто кому сколько», личная карточка и кнопки
 * «Поделиться итогом» / «Напомнить».
 *
 * Показывается в двух местах: предпросмотр перед закрытием (compact) и
 * постоянный блок закрытого события. Напоминание — системная шторка
 * «Поделиться» с готовым текстом: работает в web, Android и iOS без
 * push-инфраструктуры (push — следующий шаг, см.
 * docs/specs/close-event-and-reminders.md).
 */

import { useState } from 'react';
import { ArrowRight, BellRing, CheckCircle2, Share2 } from 'lucide-react';
import { formatMoney } from '@/lib/currency';
import { buildReminderText, buildSummaryText, computeEventSummary, transfersFor } from '@/lib/event-summary';
import { shareText, ShareOutcome } from '@/lib/share';
import { useI18n } from '@/lib/i18n/provider';

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
  const mine = transfersFor(summary, currentUserId);
  const fmt = (a: number, c: string) => formatMoney(a, c);

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
    <div className="space-y-3" data-testid="event-summary">
      {!compact && currentUserId && (mine.owe.length > 0 || mine.owed.length > 0) && (
        <div className="rounded-xl p-3 bg-white/15 space-y-1" data-testid="summary-mine">
          {mine.owe.map((tr) => (
            <p key={`owe-${tr.toId}`} className="text-sm font-extrabold">
              {t('summary.youOwe', { amount: fmt(tr.amount, currency), name: tr.toName })}
            </p>
          ))}
          {mine.owed.map((tr) => (
            <p key={`owed-${tr.fromId}`} className="text-sm font-extrabold">
              {t('summary.owesYou', { amount: fmt(tr.amount, currency), name: tr.fromName })}
            </p>
          ))}
        </div>
      )}

      {summary.transfers.length === 0 ? (
        <p className="flex items-center gap-2 text-sm font-bold" data-testid="summary-all-settled">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          {t('summary.allSettled')}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t('summary.transfersTitle')}>
          {summary.transfers.map((tr, i) => (
            <li
              key={`${tr.fromId}-${tr.toId}`}
              className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${
                compact ? 'bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100' : 'bg-white/10'
              }`}
              data-testid="summary-transfer"
            >
              <span className="flex items-center gap-1.5 min-w-0 text-xs font-bold">
                <span className="truncate max-w-[90px]">{tr.fromName}</span>
                <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                <span className="truncate max-w-[90px]">{tr.toName}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-sm font-extrabold whitespace-nowrap">{fmt(tr.amount, currency)}</span>
                {!compact && (
                  <button
                    type="button"
                    onClick={() => onRemind(i)}
                    className="min-h-[36px] px-2.5 rounded-lg bg-white/20 hover:bg-white/30 text-[11px] font-bold flex items-center gap-1"
                    aria-label={t('summary.remindAria', { name: tr.fromName })}
                  >
                    <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('summary.remind')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!compact && (
        <button
          type="button"
          onClick={onShareSummary}
          className="w-full min-h-[44px] rounded-xl bg-white text-emerald-700 font-extrabold text-xs flex items-center justify-center gap-2 hover:bg-emerald-50"
        >
          <Share2 className="w-4 h-4" aria-hidden="true" />
          {t('summary.share')}
        </button>
      )}

      {notice && (
        <p role="status" className="text-[11px] font-bold text-center">
          {notice}
        </p>
      )}
    </div>
  );
}
