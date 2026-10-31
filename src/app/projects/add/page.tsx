'use client';

/**
 * Новая запись проекта (макеты h2-add, h2-add-kb, h2-hours): доход / расход
 * (сегмент), возврат дохода (из ленты), часы и штуки — только нужные участнику
 * поля по условиям периода (§3а.1). Ошибка базы показывается, введённое не теряется.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Minus, Plus, Users, Clock } from 'lucide-react';
import { toCalcTerms } from '@/lib/projects-store';
import { MAX_HOURS, MAX_PIECES, formatQty, formatRub, hoursPurpose, monthName, parseQty, parseRub, quantityFields, rateTimes } from '@/lib/project-ui';
import { projects } from '@/lib/projects-client';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, Card, Chip, Header, MainButton, Plaque, Segment, Skeleton, TopNav, V1Screen, cx } from '@/components/v1/ui';
import { LoadError, RouteShell, memberIndex } from '@/components/v1/project-bits';
import { useProject } from '@/components/v1/useProject';

type Kind = 'income' | 'expense' | 'refund' | 'qty';

function AddRecord() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const kindParam = (params.get('type') as Kind) || 'income';
  const { t, locale } = useI18n();
  const { project, error, reload } = useProject(id);
  const [kind, setKind] = useState<Kind>(kindParam);
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [refundOf, setRefundOf] = useState<string | null>(params.get('of'));
  const [hours, setHours] = useState<string | null>(null);
  const [pieces, setPieces] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!id || !project) {
    return (
      <V1Screen>
        <TopNav back={id ? routes.projectDetail(id) : routes.home()} close />
        {!id ? <Plaque kind="err">{t('project.noId')}</Plaque> : error ? <LoadError message={error} onRetry={() => void reload()} /> : <Skeleton rows={3} tall />}
      </V1Screen>
    );
  }

  const { data, ops, me, isOwner, uid } = project;
  const open = data.periods.find((p) => p.status === 'open')!;
  const month = monthName(open.opened_at, locale);
  const terms = toCalcTerms(data.terms.find((x) => x.id === open.terms_id)!, data.lines);
  const active = data.members.filter((m) => m.status === 'active');
  const who = memberId ?? me?.id ?? active[0]?.id ?? null;
  const back = routes.projectDetail(id);

  // ---------------------------------------------------------------- часы и штуки
  if (kind === 'qty') {
    const target = data.members.find((m) => m.id === params.get('member')) ?? me;
    const line = terms.lines.find((l) => l.memberId === target?.id);
    const f = quantityFields(line, terms.remainderMethod);
    const q = data.quantities.find((x) => x.period_id === open.id && x.member_id === target?.id);
    const hText = hours ?? (q ? formatQty(q.hours) : '0');
    const pText = pieces ?? (q ? formatQty(q.pieces) : '0');
    const h = parseQty(hText);
    const p = parseQty(pText);
    const hBad = f.hours && (h === null || h > MAX_HOURS);
    const pBad = f.pieces && (p === null || p > MAX_PIECES);
    const canEnter = !!target && (target.user_id === uid || (target.kind === 'guest' && isOwner));
    const titleKey = f.hours && f.pieces ? 'add.qty.titleBoth' : f.pieces ? 'add.qty.titlePieces' : 'add.qty.titleHours';
    const save = async () => {
      if (!target) return;
      setBusy(true);
      setSaveError(null);
      const res = await projects.setQuantity(id, target.id, { hours: f.hours ? h : null, pieces: f.pieces ? p : null });
      setBusy(false);
      if (res.error) return setSaveError(res.error);
      router.push(back);
    };
    const stepper = (text: string, setText: (v: string) => void, unit: string, testId: string, bad: boolean) => (
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={t('add.qty.less')}
          onClick={() => setText(formatQty(Math.max(0, (parseQty(text) ?? 0) - 50)))}
          className="w-14 h-14 rounded-full bg-v1-card grid place-items-center"
        >
          <Minus className="w-6 h-6" aria-hidden="true" />
        </button>
        <label className={cx('flex items-baseline justify-center gap-1 text-[56px] leading-none font-extrabold tracking-[-0.03em]', bad && 'text-v1-danger')}>
          <input
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={unit}
            data-testid={testId}
            className="bg-transparent outline-none text-right w-[3.2ch]"
          />
          <span className="text-v1-ink2">{unit}</span>
        </label>
        <button
          type="button"
          aria-label={t('add.qty.more')}
          onClick={() => setText(formatQty((parseQty(text) ?? 0) + 50))}
          className="w-14 h-14 rounded-full bg-v1-card grid place-items-center"
        >
          <Plus className="w-6 h-6" aria-hidden="true" />
        </button>
      </div>
    );
    return (
      <V1Screen
        testId="add-qty"
        dock={
          <>
            {saveError && <Plaque kind="err">{t('add.failed', { error: saveError })}</Plaque>}
            <MainButton testId="qty-save" disabled={busy || !canEnter || hBad || pBad || (!f.hours && !f.pieces)} onClick={() => void save()}>
              {busy ? t('add.saving') : f.pieces && !f.hours ? t('add.qty.savePieces') : t('add.qty.saveHours')}
            </MainButton>
          </>
        }
      >
        <TopNav back={back} close />
        <Header
          title={t(titleKey, { month })}
          sub={`${target?.kind === 'guest' ? t('project.guestName', { name: target.display_name }) : target?.display_name ?? ''} · ${data.project.name}`}
        />
        {!f.hours && !f.pieces && <Plaque kind="err">{t('add.qty.notNeeded')}</Plaque>}
        {!canEnter && <Plaque kind="err">{t('add.qty.onlySelf')}</Plaque>}
        {f.hours && (
          <div className="rounded-tile bg-v1-trip px-5 pt-5 pb-4 mb-2">
            {stepper(hText, setHours, t('project.qty.h'), 'qty-hours', !!hBad)}
            <p className="mt-3.5 px-3.5 py-3 rounded-chip bg-white/70 text-base">
              {hBad
                ? t('add.qty.maxHours')
                : hoursPurpose(line) === 'rate'
                  ? h
                    ? t('add.qty.rateCalc', { qty: formatQty(h ?? 0), unit: t('project.qty.h'), rate: formatRub(line!.rate.amount), sum: formatRub(rateTimes(line!.rate.amount, h ?? 0)) })
                    : t('add.qty.zeroRate', { month })
                  : h
                    ? t('add.qty.shareHint')
                    : t('add.qty.zeroShare')}
            </p>
          </div>
        )}
        {f.pieces && (
          <div className="rounded-tile bg-v1-sand px-5 pt-5 pb-4 mb-2">
            {stepper(pText, setPieces, t('project.qty.pcs'), 'qty-pieces', !!pBad)}
            <p className="mt-3.5 px-3.5 py-3 rounded-chip bg-white/70 text-base">
              {pBad
                ? t('add.qty.maxPieces')
                : p
                  ? t('add.qty.rateCalc', { qty: formatQty(p), unit: t('project.qty.pcs'), rate: formatRub(line!.rate.amount), sum: formatRub(rateTimes(line!.rate.amount, p)) })
                  : t('add.qty.zeroRate', { month })}
            </p>
          </div>
        )}
        <Card className="flex items-start gap-3 text-base text-v1-ink2">
          <Users className="w-6 h-6 flex-none" aria-hidden="true" />
          {t('add.qty.visible')}
        </Card>
        {line && line.rate.type !== 'none' && line.rate.type !== 'period' && (
          <Card className="mt-2 flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-v1-bg grid place-items-center flex-none">
              <Clock className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-semibold">{t('add.qty.rateTitle')}</p>
              <p className="text-sm text-v1-muted">{t(`add.qty.rateLine.${line.rate.type}`, { rate: formatRub(line.rate.amount) })}</p>
            </div>
          </Card>
        )}
      </V1Screen>
    );
  }

  // ---------------------------------------------------------------- деньги
  const cents = parseRub(amount);
  const incomes = ops.filter((o) => o.op_type === 'income');
  const income = kind === 'refund' ? incomes.find((o) => o.id === refundOf) ?? null : null;
  const refunded = income ? ops.filter((o) => o.refund_of === income.id).reduce((s, o) => s + o.amount_in_project_currency, 0) : 0;
  const maxRefund = income ? income.amount_in_project_currency - refunded : 0;
  const tooMuch = kind === 'refund' && !!cents && cents > maxRefund;
  const whoLine = terms.lines.find((l) => l.memberId === who);
  const whoName = data.members.find((m) => m.id === who)?.display_name ?? '';
  const disabled = busy || !cents || !who || tooMuch || (kind === 'refund' && !income);

  const save = async () => {
    if (!cents || !who) return;
    setBusy(true);
    setSaveError(null);
    const res = await projects.addOperation(id, {
      type: kind === 'refund' ? 'income_refund' : kind === 'expense' ? 'expense' : 'income',
      amount: cents,
      memberId: who,
      refundOf: income?.id,
      title: title.trim() || undefined,
    });
    setBusy(false);
    if (res.error) return setSaveError(res.error);
    router.push(back);
  };

  return (
    <V1Screen
      testId="add-op"
      dock={
        <>
          {saveError && (
            <Plaque kind="err" testId="add-error">
              {t('add.failed', { error: saveError })}
            </Plaque>
          )}
          <MainButton testId="op-save" disabled={disabled} onClick={() => void save()}>
            {busy ? t('add.saving') : t('add.save')}
          </MainButton>
        </>
      }
    >
      <TopNav back={back} close />
      <Header title={kind === 'refund' ? t('add.refundTitle') : t('add.title')} sub={`${data.project.name} · ${month}`} />
      {kind !== 'refund' ? (
        <Segment<Kind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'income', label: t('add.income') },
            { value: 'expense', label: t('add.expense') },
          ]}
        />
      ) : (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {incomes.length === 0 && <Plaque kind="info">{t('add.refund.noIncome')}</Plaque>}
          {incomes.map((o) => (
            <Chip key={o.id} on={o.id === refundOf} onClick={() => setRefundOf(o.id)} testId="refund-of">
              {(o.title || t('project.op.type.income'))} · {formatRub(o.amount_in_project_currency)}
            </Chip>
          ))}
        </div>
      )}
      {income && <Plaque kind="info">{t('add.refund.of', { title: income.title || t('project.op.type.income'), amount: formatRub(income.amount_in_project_currency), max: formatRub(maxRefund) })}</Plaque>}

      <div className={cx('rounded-tile px-[22px] pt-[22px] pb-[18px]', kind === 'income' ? 'bg-v1-plus' : kind === 'refund' ? 'bg-v1-minus' : 'bg-v1-card')}>
        <label className="flex items-baseline gap-2 text-[52px] leading-none font-extrabold tracking-[-0.03em]">
          <input
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            aria-label={t('add.amount')}
            data-testid="op-amount"
            className="bg-transparent outline-none min-w-0 w-full placeholder:text-v1-ink"
          />
          <span className="text-v1-ink2">₽</span>
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder={kind === 'expense' ? t('add.whatExpense') : t('add.whatIncome')}
          data-testid="op-title"
          className="mt-3.5 w-full px-3.5 py-3 rounded-chip bg-white/70 text-base font-medium outline-none"
        />
      </div>
      {tooMuch && <p className="mt-2 text-[15px] font-bold text-v1-danger">{t('add.refund.max', { max: formatRub(maxRefund) })}</p>}

      <h2 className="mt-[22px] mb-3 text-xl font-extrabold">
        {kind === 'income' ? t('add.whoIncome') : kind === 'refund' ? t('add.whoRefund') : t('add.whoPaid')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {active.map((m) => (
          <Chip key={m.id} on={m.id === who} onClick={() => setMemberId(m.id)} testId={`op-member-${memberIndex(data, m.id)}`}>
            <Avatar name={m.display_name} index={memberIndex(data, m.id)} size="s" />
            {m.display_name}
          </Chip>
        ))}
      </div>
      <p className="mt-2.5 text-[15px] leading-snug text-v1-muted">
        {kind === 'expense' && whoLine?.expensesBack === false
          ? t('add.ownExpense', { name: whoName })
          : kind === 'income'
            ? t('add.incomeHint', { name: whoName, month })
            : kind === 'refund'
              ? t('add.refundHint', { month })
              : t('add.expenseHint', { month })}
      </p>
    </V1Screen>
  );
}

export default function Page() {
  return (
    <RouteShell>
      <AddRecord />
    </RouteShell>
  );
}
