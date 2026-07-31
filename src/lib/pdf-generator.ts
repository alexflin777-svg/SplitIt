/**
 * PDF & Text Financial Report Generator for SplitIT
 */

import { formatMoney } from './currency';

export function generateReportText(group: any): string {
  const totalExpenses = (group.expenses || []).reduce(
    (acc: number, e: any) => acc + (e.amountInGroupCurrency || e.amount || 0),
    0
  );

  let text = `📄 ФИНАНСОВЫЙ ОТЧЕТ SPLITIT: "${group.name}"\n`;
  text += `📅 Дата формирования: ${new Date().toLocaleDateString('ru-RU')}\n`;
  text += `💰 Итого расходов: ${formatMoney(totalExpenses, group.currency || 'RUB')}\n`;
  text += `👥 Участников: ${(group.members || []).length} чел.\n\n`;

  text += `--- РЕЕСТР ТРАНЗАКЦИЙ ---\n`;
  if (!group.expenses || group.expenses.length === 0) {
    text += `Транзакции отсутствуют.\n`;
  } else {
    group.expenses.forEach((e: any, idx: number) => {
      const payer = (group.members || []).find((m: any) => m.id === e.paidById)?.name || 'Участник';
      text += `${idx + 1}. ${e.title} — ${formatMoney(e.amount, e.currency || group.currency)} (Оплатил: ${payer})\n`;
    });
  }

  text += `\n✨ Рассчитано в приложении SplitIT (https://splitit.app)`;
  return text;
}

export function triggerPrintPdf() {
  if (typeof window !== 'undefined') {
    window.print();
  }
}
