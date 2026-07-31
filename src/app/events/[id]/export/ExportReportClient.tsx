'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getSavedGroups } from '@/lib/supabase';
import { formatMoney } from '@/lib/currency';
import { generateReportText, triggerPrintPdf } from '@/lib/pdf-generator';
import {
  ArrowLeft,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  ShieldCheck,
  Share2,
  Send,
  MessageCircle,
  MessageSquare,
  FileText,
} from 'lucide-react';

export default function ExportReportClient({ groupId }: { groupId: string }) {
  const [group, setGroup] = useState<any>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSavedGroups();
    const found = saved.find((g: any) => g.id === groupId);
    if (found) {
      setGroup(found);
    } else {
      setGroup({
        id: groupId,
        name: 'Совместное событие',
        currency: 'RUB',
        createdAt: new Date().toISOString(),
        members: [{ id: 'm-1', name: 'Вы' }, { id: 'm-2', name: 'Максим' }],
        expenses: [],
      });
    }
  }, [groupId]);

  if (!group) {
    return <div className="p-4 text-xs font-bold text-slate-500 text-center">Загрузка отчета...</div>;
  }

  const totalExpenses = (group.expenses || []).reduce(
    (acc: number, e: any) => acc + (e.amountInGroupCurrency || e.amount || 0),
    0
  );

  const reportText = generateReportText(group);

  const handleDownloadCsv = () => {
    let csv = 'Title;Amount;Currency;PaidBy;Date\n';
    (group.expenses || []).forEach((e: any) => {
      const paidBy = (group.members || []).find((m: any) => m.id === e.paidById)?.name || 'N/A';
      csv += `"${e.title}";${e.amount};${e.currency};"${paidBy}";"${e.createdAt}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splitit_report_${group.name.replace(/\s+/g, '_')}.csv`;
    a.click();
    setDownloaded('CSV отчет сохранен!');
  };

  const handlePrintPdf = () => {
    triggerPrintPdf();
    setDownloaded('Печать / Сохранение PDF запущено!');
  };

  const handleShareReport = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Финансовый отчет: ${group.name}`,
          text: reportText,
        });
      } catch (err) {
        console.warn('Share cancelled', err);
      }
    } else {
      navigator.clipboard.writeText(reportText);
      setDownloaded('Текст отчета скопирован в буфер обмена!');
    }
  };

  return (
    <div className="space-y-6 max-w-md mx-auto overflow-x-hidden px-1 pb-24">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Link
          href={`/events/${group.id}`}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-xs print:hidden"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="font-extrabold text-slate-900 text-base">Экспорт отчета события</h2>
        <div className="w-9 print:hidden" />
      </div>

      {downloaded && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 print:hidden">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{downloaded}</span>
        </div>
      )}

      {/* Primary Action Buttons Grid */}
      <div className="grid grid-cols-2 gap-2.5 print:hidden">
        <button
          onClick={handlePrintPdf}
          className="p-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-md transition-all active:scale-98"
        >
          <Printer className="w-4 h-4" />
          <span>Выгрузить / Печать PDF</span>
        </button>

        <button
          onClick={handleShareReport}
          className="p-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-md transition-all active:scale-98"
        >
          <Share2 className="w-4 h-4" />
          <span>Поделиться отчетом</span>
        </button>
      </div>

      {/* Messengers Sharing Quick Bar */}
      <div className="stitch-card p-4 space-y-2 print:hidden">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Отправить выписку в мессенджеры
        </span>
        <div className="grid grid-cols-3 gap-2 pt-1">
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent('https://splitit.app')}&text=${encodeURIComponent(reportText)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 font-bold text-xs hover:bg-sky-100 transition-all"
          >
            <Send className="w-3.5 h-3.5 text-sky-600" />
            <span>Telegram</span>
          </a>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(reportText)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-xs hover:bg-emerald-100 transition-all"
          >
            <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span>WhatsApp</span>
          </a>

          <button
            onClick={handleDownloadCsv}
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 font-bold text-xs hover:bg-slate-200 transition-all"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-600" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Printable Report Document Card */}
      <div className="stitch-card p-6 bg-white space-y-5 border-slate-300 shadow-lg">
        {/* Report Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Официальный финансовый отчет SplitIT
            </span>
            <h3 className="text-xl font-extrabold text-slate-900">{group.name}</h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Сформирован: {new Date().toLocaleDateString('ru-RU')}
            </p>
          </div>

          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-lg">
            S
          </div>
        </div>

        {/* Report Summary */}
        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase">Участников:</span>
            <p className="font-extrabold text-slate-800 text-sm">{(group.members || []).length} человек</p>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase">Итого расходов:</span>
            <p className="font-extrabold text-blue-600 text-sm">
              {formatMoney(totalExpenses, group.currency || 'RUB')}
            </p>
          </div>
        </div>

        {/* Expenses List Table */}
        <div className="space-y-2">
          <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
            Реестр транзакций
          </h4>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs">
            {(group.expenses || []).length === 0 ? (
              <div className="p-4 text-center text-slate-400 font-medium">Транзакции отсутствуют</div>
            ) : (
              (group.expenses || []).map((expense: any) => {
                const paidByMember = (group.members || []).find((m: any) => m.id === expense.paidById);
                return (
                  <div key={expense.id} className="p-3 flex items-center justify-between bg-white">
                    <div>
                      <span className="font-bold text-slate-900 block">{expense.title}</span>
                      <span className="text-[11px] text-slate-500">
                        Оплатил: {paidByMember?.name || 'Участник'}
                      </span>
                    </div>

                    <span className="font-extrabold text-slate-900">
                      {formatMoney(expense.amount, expense.currency || group.currency)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer Seal */}
        <div className="pt-4 border-t border-slate-100 text-center text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
          <span>Подтверждено сервисом SplitIT (splitit.app)</span>
        </div>
      </div>
    </div>
  );
}
