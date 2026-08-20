/**
 * PDF & Text Financial Report Generator for SplitIT
 */

import { formatMoney } from './currency';
import { t } from './i18n/t';

export function generateReportText(group: any): string {
  const totalExpenses = (group.expenses || []).reduce(
    (acc: number, e: any) => acc + (e.amountInGroupCurrency || e.amount || 0),
    0
  );

  let text = `📄 ${t('export.officialReport')}: "${group.name}"\n`;
  text += `📅 ${t('export.generatedAt', { date: new Date().toLocaleDateString() })}\n`;
  text += `💰 ${t('export.totalExpensesLabel')} ${formatMoney(totalExpenses, group.currency || 'RUB')}\n`;
  text += `👥 ${t('export.membersCountValue', { count: (group.members || []).length })}\n\n`;

  text += `--- ${t('export.transactionsRegistry')} ---\n`;
  if (!group.expenses || group.expenses.length === 0) {
    text += `${t('export.noTransactions')}.\n`;
  } else {
    group.expenses.forEach((e: any, idx: number) => {
      const payer = (group.members || []).find((m: any) => m.id === e.paidById)?.name || t('export.defaultMember');
      text += `${idx + 1}. ${e.title} — ${formatMoney(e.amount, e.currency || group.currency)} (${t('export.paidBy', { name: payer })})\n`;
    });
  }

  text += `\n✨ ${t('export.footerSeal')}`;
  return text;
}

export function triggerPrintPdf() {
  if (typeof window !== 'undefined') {
    window.print();
  }
}
