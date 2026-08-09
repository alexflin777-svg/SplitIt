'use client';

import { ReactNode, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';

/**
 * Общая обвязка для экранов события (инвариант И-2).
 *
 * Идентификатор события приходит в query-строке, а не в пути, поэтому каждый
 * такой экран обязан: (1) прочитать параметры внутри Suspense — без этого Next
 * не собирает страницу в режиме output: 'export'; (2) осмысленно повести себя,
 * если параметра нет. Раньше при отсутствии данных подставлялся дефолт
 * 'group-sochi-2026', и пользователь молча оказывался в чужом демо-событии.
 */

function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">{t('eventRoute.loading')}</span>
    </div>
  );
}

function MissingParam({ what }: { what: string }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="stitch-card p-6 text-center space-y-3 bg-white dark:bg-slate-800">
      <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
      <h1 className="text-lg font-bold text-slate-900 dark:text-white">{t('eventRoute.missingParamTitle')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('eventRoute.missingParamBody').replace('{what}', what)}
      </p>
      <Link
        href={routes.home()}
        className="inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all duration-300 hover:bg-blue-700"
      >
        {t('eventDetail.backToEvents')}
      </Link>
    </div>
  );
}

interface EventRouteParams {
  groupId: string;
  expenseId: string;
}

function Resolver({
  needsExpenseId,
  children,
}: {
  needsExpenseId: boolean;
  children: (params: EventRouteParams) => ReactNode;
}) {
  const searchParams = useSearchParams();
  const groupId = searchParams.get('id');
  const expenseId = searchParams.get('expenseId');

  if (!groupId) return <MissingParam what="id" />;
  if (needsExpenseId && !expenseId) return <MissingParam what="expenseId" />;

  return <>{children({ groupId, expenseId: expenseId ?? '' })}</>;
}

export default function EventRoute({
  needsExpenseId = false,
  children,
}: {
  needsExpenseId?: boolean;
  children: (params: EventRouteParams) => ReactNode;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <Resolver needsExpenseId={needsExpenseId}>{children}</Resolver>
    </Suspense>
  );
}
