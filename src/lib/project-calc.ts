/**
 * Расчёт периода «Проекта» (спецификация PROJECT-SPEC.md §3а.2).
 *
 * Все суммы — целые копейки (number, целые). Количества (часы/штуки) — в сотых:
 * 150 = 1,5 ч. Пропорциональное деление — методом наибольшего остатка на BigInt
 * (произведения сумм на веса выходят за 2^53), ничья — первому по `position`.
 * Модуль чистый: входы не мутируются, ничего не пишется.
 */

import { simplifyDebts } from './debt-simplification';

export type MemberRole = 'user' | 'guest';

export interface ProjectMember {
  id: string;
  name: string;
  /** Порядок добавления в проект: копейка при ничьей — первому. */
  position: number;
  role: MemberRole;
  status?: 'active' | 'left';
}

export type RateType = 'none' | 'period' | 'hourly' | 'piece';

export interface Rate {
  type: RateType;
  /** Копейки за период / час / штуку. */
  amount: number;
}

export interface TermLine {
  memberId: string;
  expensesBack: boolean;
  rate: Rate;
  inRemainder: boolean;
  /** Доля в базисных пунктах (4000 = 40 %), только для способа «по %». */
  shareBp: number;
  /** Новый вклад этой версии, копейки. */
  contribNew: number;
  contribKind?: 'money' | 'item';
  contribNote?: string;
  /** «Списать долг до X», копейки. */
  debtWriteOff: number;
}

export type RemainderMethod = 'equal' | 'percent' | 'contributions' | 'hours';

export interface Terms {
  /** Блок 2 «Вклад назад». */
  contribEnabled: boolean;
  remainderMethod: RemainderMethod;
  lines: TermLine[];
}

export type OperationType = 'income' | 'income_refund' | 'expense';

export interface Operation {
  type: OperationType;
  /** На чью карту / кто вернул клиенту / кто платил. */
  memberId: string;
  /** > 0, копейки в валюте проекта. */
  amount: number;
}

export interface Quantity {
  /** Сотые часа. */
  hours?: number;
  /** Сотые штуки. */
  pieces?: number;
}

export interface PeriodInput {
  members: ProjectMember[];
  terms: Terms;
  operations: Operation[];
  quantities?: Record<string, Quantity>;
  /** Баланс журнала долга по вкладам на начало периода (credit − repay − write_off). */
  debtAtStart?: Record<string, number>;
  /**
   * Накопленные вклады (вес для «по вкладам»): Σ contrib_new всех вступивших версий.
   * shortcut: по умолчанию берутся contribNew текущей версии — верно, пока версия одна;
   * при нескольких версиях вызывающий обязан передать сумму.
   */
  contributionsTotal?: Record<string, number>;
}

export type BreakdownKind = 'expenses' | 'contribution' | 'rate' | 'remainder';

export interface BreakdownItem {
  kind: BreakdownKind;
  label: string;
  /** Выплачено, копейки (у убытка — отрицательное). */
  amount: number;
  /** Только у ставки: начислено до урезания. */
  accrued?: number;
}

export interface PersonResult {
  memberId: string;
  name: string;
  expensesBack: number;
  contributionBack: number;
  rateAccrued: number;
  rate: number;
  remainderShare: number;
  owed: number;
  onHand: number;
  /** owed − onHand: минус — отдаёт, плюс — ему переводят. */
  transfer: number;
  breakdown: BreakdownItem[];
}

export interface ProjectTransfer {
  fromId: string;
  toId: string;
  amount: number;
}

export interface PeriodResult {
  perPerson: Record<string, PersonResult>;
  /** Участники в порядке position. */
  order: string[];
  netIncome: number;
  profit: number;
  contributionsRepaid: number;
  ratesAccrued: number;
  ratesPaid: number;
  remainder: number;
  debtAfter: Record<string, number>;
  transfers: ProjectTransfer[];
  /** Подписи для предпросмотра и разбора итога. */
  notes: string[];
}

// ---------------------------------------------------------------- деньги

const B = (n: number) => BigInt(n);
const ZERO = B(0);

function assertCents(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${what}: ожидаются целые копейки, получено ${n}`);
}

/**
 * Делит total ≥ 0 пропорционально целым весам ≥ 0 (Σ > 0) методом наибольшего
 * остатка; ничья — меньшему индексу (вход уже в порядке position).
 */
export function allocate(total: number, weights: number[]): number[] {
  const T = B(total);
  const W = weights.reduce((s, w) => s + B(w), ZERO);
  if (W <= ZERO) throw new Error('allocate: сумма весов должна быть > 0');
  const rows = weights.map((w, idx) => {
    const p = T * B(w);
    return { idx, q: p / W, r: p % W };
  });
  let left = T - rows.reduce((s, x) => s + x.q, ZERO);
  const byRemainder = [...rows].sort((a, b) => (a.r === b.r ? a.idx - b.idx : a.r > b.r ? -1 : 1));
  for (const row of byRemainder) {
    if (left <= ZERO) break;
    row.q += B(1);
    left -= B(1);
  }
  return rows.map((x) => Number(x.q));
}

/** То же для любого знака: при минусе делится модуль, ставится минус. */
function allocateSigned(total: number, weights: number[]): number[] {
  if (total === 0) return weights.map(() => 0);
  const parts = allocate(Math.abs(total), weights);
  return total < 0 ? parts.map((x) => -x) : parts;
}

/** ставка × количество(сотые) / 100, половина копейки — вверх. */
function rateTimesQty(rate: number, qtyHundredths: number): number {
  return Number((B(rate) * B(qtyHundredths) + B(50)) / B(100));
}

/** 1500000 → «15 000 ₽», 333333 → «3 333,33 ₽». */
export function formatRub(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  const rub = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const kop = abs % 100;
  return `${sign}${rub}${kop ? ',' + String(kop).padStart(2, '0') : ''} ₽`;
}

/** Сотые → «10», «2,5», «1,25». */
function formatQty(hundredths: number): string {
  return (hundredths / 100).toString().replace('.', ',');
}

/** Базисные пункты → «40», «90,5». */
function formatBp(bp: number): string {
  return (bp / 100).toString().replace('.', ',');
}

// ---------------------------------------------------------------- расчёт

/** Участник, не вошедший в условия периода: расходы назад, остальное выкл (§3а.2). */
function defaultLine(memberId: string): TermLine {
  return {
    memberId,
    expensesBack: true,
    rate: { type: 'none', amount: 0 },
    inRemainder: false,
    shareBp: 0,
    contribNew: 0,
    debtWriteOff: 0,
  };
}

function rateLabel(line: TermLine, q: Quantity | undefined): string {
  const r = formatRub(line.rate.amount);
  switch (line.rate.type) {
    case 'period':
      return `Ставка за период ${r}`;
    case 'hourly':
      return `Работа ${formatQty(q?.hours ?? 0)} ч × ${r}`;
    case 'piece':
      return `${formatQty(q?.pieces ?? 0)} шт. × ${r}`;
    default:
      return 'Ставка';
  }
}

export function calculatePeriod(input: PeriodInput): PeriodResult {
  const { terms, operations } = input;
  const quantities = input.quantities ?? {};
  const debtAtStart = input.debtAtStart ?? {};
  const members = [...input.members].sort((a, b) => a.position - b.position);
  const order = members.map((m) => m.id);
  const known = new Set(order);
  const lineOf = new Map(terms.lines.map((l) => [l.memberId, l]));
  const line = (id: string) => lineOf.get(id) ?? defaultLine(id);

  for (const l of terms.lines) {
    if (!known.has(l.memberId)) throw new Error(`Условия ссылаются на неизвестного участника ${l.memberId}`);
  }

  // 1–3, 9: доходы, возвраты, общие расходы, на руках.
  const onHand = new Map(order.map((id) => [id, 0]));
  const E = new Map(order.map((id) => [id, 0]));
  let netIncome = 0;
  for (const op of operations) {
    assertCents(op.amount, 'Сумма операции');
    if (op.amount <= 0) throw new Error('Сумма операции должна быть > 0');
    if (!known.has(op.memberId)) throw new Error(`Операция на неизвестного участника ${op.memberId}`);
    if (op.type === 'income') {
      netIncome += op.amount;
      onHand.set(op.memberId, onHand.get(op.memberId)! + op.amount);
    } else if (op.type === 'income_refund') {
      netIncome -= op.amount;
      onHand.set(op.memberId, onHand.get(op.memberId)! - op.amount);
    } else if (line(op.memberId).expensesBack) {
      E.set(op.memberId, E.get(op.memberId)! + op.amount);
    }
    // Расход «за свой счёт» не входит ни в E, ни в P.
  }
  const sumE = order.reduce((s, id) => s + E.get(id)!, 0);
  const P = netIncome - sumE;

  // 4: вклады.
  const D = order.map((id) => (terms.contribEnabled ? debtAtStart[id] ?? 0 : 0));
  D.forEach((d) => {
    assertCents(d, 'Долг по вкладу');
    if (d < 0) throw new Error('Долг по вкладу не может быть меньше нуля');
  });
  const sumD = D.reduce((s, d) => s + d, 0);
  const R = sumD > 0 ? Math.min(Math.max(P, 0), sumD) : 0;
  const Ri = R > 0 ? allocate(R, D) : order.map(() => 0);

  // 5: ставки.
  const accrued = order.map((id) => {
    const l = line(id);
    assertCents(l.rate.amount, 'Ставка');
    const q = quantities[id];
    switch (l.rate.type) {
      case 'period':
        return l.rate.amount;
      case 'hourly':
        return rateTimesQty(l.rate.amount, q?.hours ?? 0);
      case 'piece':
        return rateTimesQty(l.rate.amount, q?.pieces ?? 0);
      default:
        return 0;
    }
  });
  const sumAccrued = accrued.reduce((s, a) => s + a, 0);
  const S = sumAccrued > 0 ? Math.max(0, Math.min(sumAccrued, P - R)) : 0;
  const Si = S === 0 ? order.map(() => 0) : S < sumAccrued ? allocate(S, accrued) : accrued;

  // 6–7: остаток и веса.
  const O = P - R - S;
  const notes: string[] = [];
  const participants = order.filter((id) => line(id).inRemainder);
  const contribTotal = input.contributionsTotal ?? Object.fromEntries(terms.lines.map((l) => [l.memberId, l.contribNew]));
  const weightOf = (id: string): number => {
    switch (terms.remainderMethod) {
      case 'percent':
        return line(id).shareBp;
      case 'contributions':
        return contribTotal[id] ?? 0;
      case 'hours':
        return quantities[id]?.hours ?? 0;
      default:
        return 1;
    }
  };
  let weights = participants.map(weightOf);
  let fellBackToEqual = false;
  if (participants.length === 0) {
    if (O !== 0) throw new Error('Кто-то должен получать остаток');
  } else if (weights.reduce((s, w) => s + w, 0) === 0) {
    weights = participants.map(() => 1);
    fellBackToEqual = terms.remainderMethod !== 'equal';
    if (terms.remainderMethod === 'hours') notes.push('Часы не внесены — делим поровну');
    if (terms.remainderMethod === 'contributions') notes.push('Вкладов нет — поровну');
  }
  if (terms.remainderMethod === 'hours' && O < 0) notes.push('Убыток делится по часам, как и прибыль');
  const Oparts = participants.length ? allocateSigned(O, weights) : [];
  const Oi = new Map(participants.map((id, k) => [id, Oparts[k]]));

  for (const [k, id] of order.entries()) {
    const t = line(id).rate.type;
    const q = quantities[id];
    const name = members[k].name;
    if (t === 'hourly' && !q?.hours) notes.push(`${name}: часы не внесены — ставка 0`);
    if (t === 'piece' && !q?.pieces) notes.push(`${name}: штуки не внесены — ставка 0`);
  }

  // 8–10.
  const perPerson: Record<string, PersonResult> = {};
  const debtAfter: Record<string, number> = {};
  const absO = formatRub(Math.abs(O));
  order.forEach((id, k) => {
    const l = line(id);
    const share = Oi.get(id) ?? 0;
    const owed = E.get(id)! + Ri[k] + Si[k] + share;
    const breakdown: BreakdownItem[] = [];
    if (E.get(id)) breakdown.push({ kind: 'expenses', label: 'Расходы назад', amount: E.get(id)! });
    if (Ri[k]) breakdown.push({ kind: 'contribution', label: 'Вклад назад', amount: Ri[k] });
    if (l.rate.type !== 'none') {
      breakdown.push({ kind: 'rate', label: rateLabel(l, quantities[id]), amount: Si[k], accrued: accrued[k] });
    }
    if (share) {
      const loss = O < 0 ? 'Доля убытка: ' : '';
      let label: string;
      if (fellBackToEqual || terms.remainderMethod === 'equal') label = `${loss}поровну от ${absO}`;
      else if (terms.remainderMethod === 'percent') label = `${loss}${formatBp(l.shareBp)} % от ${absO}`;
      else if (terms.remainderMethod === 'hours') label = `${loss}по часам (${formatQty(weightOf(id))} ч) от ${absO}`;
      else label = `${loss}по вкладам от ${absO}`;
      breakdown.push({ kind: 'remainder', label, amount: share });
    }
    perPerson[id] = {
      memberId: id,
      name: members[k].name,
      expensesBack: E.get(id)!,
      contributionBack: Ri[k],
      rateAccrued: accrued[k],
      rate: Si[k],
      remainderShare: share,
      owed,
      onHand: onHand.get(id)!,
      transfer: owed - onHand.get(id)!,
      breakdown,
    };
    if (terms.contribEnabled) debtAfter[id] = D[k] - Ri[k];
  });

  const balances = Object.fromEntries(
    order.map((id) => [id, { name: perPerson[id].name, netAmount: perPerson[id].transfer / 100 }]),
  );
  const transfers = simplifyDebts(balances).map((t) => ({
    fromId: t.fromId,
    toId: t.toId,
    amount: Math.round(t.amount * 100),
  }));

  return {
    perPerson,
    order,
    netIncome,
    profit: P,
    contributionsRepaid: R,
    ratesAccrued: sumAccrued,
    ratesPaid: S,
    remainder: O,
    debtAfter,
    transfers,
    notes,
  };
}

/**
 * «Из чего сумма»: «Расходы назад 9 000 ₽ + Работа 10 ч × 1 500 ₽ = 15 000 ₽ +
 * 20 % от 85 000 ₽ = 17 000 ₽ = 41 000 ₽».
 */
export function formatBreakdown(p: PersonResult): string {
  const parts = p.breakdown.map((b) => {
    if (b.kind === 'expenses' || b.kind === 'contribution') return `${b.label} ${formatRub(b.amount)}`;
    if (b.kind === 'rate' && b.accrued !== b.amount) {
      return `${b.label} = ${formatRub(b.accrued ?? 0)}, хватило прибыли на ${formatRub(b.amount)}`;
    }
    if (b.kind === 'rate' && b.label.startsWith('Ставка за период')) return b.label;
    return `${b.label} = ${formatRub(b.amount)}`;
  });
  return `${parts.length ? parts.join(' + ') : '0 ₽'} = ${formatRub(p.owed)}`;
}

// ---------------------------------------------------------------- журнал долга

export type LedgerKind = 'repay' | 'write_off' | 'credit';

export interface LedgerEntry {
  memberId: string;
  kind: LedgerKind;
  amount: number;
  /** repay — закрываемый период k; write_off и credit — следующий k+1. */
  period: 'current' | 'next';
}

export interface ClosePeriodDebtInput {
  members: ProjectMember[];
  /** D_i — баланс журнала на начало закрываемого периода. */
  debtAtStart: Record<string, number>;
  /** R_i закрываемого периода (из calculatePeriod). */
  repaid: Record<string, number>;
  /** Версия условий, вступающая со следующего периода (если есть). */
  nextTerms?: Terms;
}

/**
 * Последовательность §3а.2 «Долг по вкладам при „Подвести итог“»:
 * (а) repay R_i → (б) остаток → (в) write_off min(X_i, остаток) → (г) credit contrib_new
 * ровно один раз. Строки — в порядке repay, write_off, credit.
 */
export function closePeriodDebt(input: ClosePeriodDebtInput): {
  entries: LedgerEntry[];
  debtAtNextStart: Record<string, number>;
} {
  const order = [...input.members].sort((a, b) => a.position - b.position).map((m) => m.id);
  const lines = new Map((input.nextTerms?.lines ?? []).map((l) => [l.memberId, l]));
  const repay: LedgerEntry[] = [];
  const writeOff: LedgerEntry[] = [];
  const credit: LedgerEntry[] = [];
  const debt: Record<string, number> = {};
  const cents = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`closePeriodDebt: ожидаются целые неотрицательные копейки, получено ${n}`);
  };
  [...Object.values(input.debtAtStart), ...Object.values(input.repaid)].forEach(cents);
  for (const l of lines.values()) [l.debtWriteOff, l.contribNew].forEach(cents);
  for (const id of order) {
    const R = input.repaid[id] ?? 0;
    const rest = (input.debtAtStart[id] ?? 0) - R;
    if (rest < 0) throw new Error('Возврат вклада больше долга');
    if (R > 0) repay.push({ memberId: id, kind: 'repay', amount: R, period: 'current' });
    const l = lines.get(id);
    const written = Math.min(l?.debtWriteOff ?? 0, rest);
    if (written > 0) writeOff.push({ memberId: id, kind: 'write_off', amount: written, period: 'next' });
    const added = input.nextTerms?.contribEnabled ? l?.contribNew ?? 0 : 0;
    if (added > 0) credit.push({ memberId: id, kind: 'credit', amount: added, period: 'next' });
    debt[id] = rest - written + added;
  }
  return { entries: [...repay, ...writeOff, ...credit], debtAtNextStart: debt };
}

// ---------------------------------------------------------------- предпросмотр

export interface PreviewInput {
  members: ProjectMember[];
  /** Предлагаемые условия. */
  terms: Terms;
  /** Текущий баланс журнала долга (= долг на начало открытого периода). */
  ledgerDebt?: Record<string, number>;
  /** «На прошлом периоде»: его операции и количества. Нет — «на примере». */
  operations?: Operation[];
  quantities?: Record<string, Quantity>;
  /** «На прошлом периоде»: действовавшие условия и долг на его начало — для «было». */
  baseline?: { terms: Terms; debtAtStart: Record<string, number> };
  /** «На примере»: доход примера, копейки; по умолчанию 100 000 ₽ первому участнику. */
  sampleIncome?: number;
  /** Накопленные вклады до предлагаемой версии (вес «было»); к «стало» добавляются contribNew из terms. */
  contributionsTotal?: Record<string, number>;
}

/**
 * Предпросмотр экрана 5 (§3а.6): тот же calculatePeriod на входах симуляции.
 * Долг = журнал + предлагаемые вклады − min(списание, журнал). Ничего не мутирует.
 */
export function simulatePreview(input: PreviewInput): { after: PeriodResult; before?: PeriodResult } {
  const members = [...input.members].sort((a, b) => a.position - b.position);
  const isExample = !input.operations;
  const base = input.baseline?.debtAtStart ?? input.ledgerDebt ?? {};
  const debt: Record<string, number> = {};
  for (const m of members) {
    const l = input.terms.lines.find((x) => x.memberId === m.id);
    const d = base[m.id] ?? 0;
    const added = input.terms.contribEnabled ? l?.contribNew ?? 0 : 0;
    debt[m.id] = d + added - Math.min(l?.debtWriteOff ?? 0, d);
  }
  const operations = input.operations ?? [
    { type: 'income' as const, memberId: members[0].id, amount: input.sampleIncome ?? 10_000_000 },
  ];
  const quantities = input.quantities ?? {};
  // Вес «по вкладам» стало = накопленные + предлагаемые новые; было — только накопленные.
  const totalAfter = { ...input.contributionsTotal };
  for (const l of input.terms.lines) totalAfter[l.memberId] = (totalAfter[l.memberId] ?? 0) + l.contribNew;
  const after = calculatePeriod({
    members,
    terms: input.terms,
    operations,
    quantities,
    debtAtStart: debt,
    contributionsTotal: totalAfter,
  });
  if (isExample) {
    // В режиме «на примере» количества — примерные, подпись другая.
    after.notes = after.notes.filter((n) => !/не внесены — ставка 0$/.test(n));
    for (const m of members) {
      const l = input.terms.lines.find((x) => x.memberId === m.id);
      const q = quantities[m.id];
      if (l?.rate.type === 'hourly' && !q?.hours) after.notes.push(`${m.name}: примерно 0 ч — ставка 0`);
      if (l?.rate.type === 'piece' && !q?.pieces) after.notes.push(`${m.name}: примерно 0 шт. — ставка 0`);
    }
  }
  const before = input.baseline
    ? calculatePeriod({
        members,
        terms: input.baseline.terms,
        operations,
        quantities,
        debtAtStart: input.baseline.debtAtStart,
        contributionsTotal: input.contributionsTotal,
      })
    : undefined;
  return { after, before };
}

// ---------------------------------------------------------------- проверки §3а.7

export interface TermsIssue {
  memberId?: string;
  message: string;
}

export interface ValidateContext {
  members: ProjectMember[];
  /** Текущий баланс журнала долга по участникам. */
  currentDebt?: Record<string, number>;
  /** Кто выходит этой версией. */
  leaving?: string[];
  /** 'accept' — проверка последнего согласия (accept_terms). */
  stage?: 'propose' | 'accept';
  contributionsTotal?: Record<string, number>;
}

const MAX_RATE = 10_000_000_000; // 100 000 000 ₽

export function validateTerms(
  terms: Terms,
  ctx: ValidateContext,
): { errors: TermsIssue[]; warnings: TermsIssue[] } {
  const errors: TermsIssue[] = [];
  const warnings: TermsIssue[] = [];
  const nameOf = new Map(ctx.members.map((m) => [m.id, m.name]));
  const active = new Set(ctx.members.filter((m) => (m.status ?? 'active') === 'active').map((m) => m.id));
  const debt = ctx.currentDebt ?? {};
  const leaving = new Set(ctx.leaving ?? []);
  const stage = ctx.stage ?? 'propose';

  const seen = new Set<string>();
  for (const l of terms.lines) {
    if (!active.has(l.memberId) || seen.has(l.memberId)) {
      errors.push({ memberId: l.memberId, message: 'Условия — только для участников проекта, по одной строке на человека' });
    }
    seen.add(l.memberId);
  }

  const inRem = terms.lines.filter((l) => l.inRemainder);
  if (inRem.length === 0) errors.push({ message: 'Кто-то должен получать остаток' });

  if (terms.remainderMethod === 'percent') {
    const sum = inRem.reduce((s, l) => s + l.shareBp, 0);
    if (sum !== 10_000) errors.push({ message: `Сейчас ${formatBp(sum)} %, нужно 100 %` });
    for (const l of terms.lines) {
      const name = nameOf.get(l.memberId) ?? l.memberId;
      if (!Number.isInteger(l.shareBp) || l.shareBp < 0) {
        errors.push({ memberId: l.memberId, message: `${name}: доля не может быть меньше нуля` });
      } else if (l.inRemainder && l.shareBp === 0) {
        errors.push({ memberId: l.memberId, message: `${name}: участвует в остатке, а доля 0 %` });
      } else if (!l.inRemainder && l.shareBp > 0) {
        errors.push({ memberId: l.memberId, message: `${name}: не участвует в остатке, доля должна быть 0 %` });
      }
    }
  }

  for (const l of terms.lines) {
    const a = l.rate.amount;
    if (!Number.isInteger(a) || a < 0) {
      errors.push({ memberId: l.memberId, message: 'Ставка не может быть меньше нуля' });
    } else if (a > MAX_RATE) {
      errors.push({ memberId: l.memberId, message: 'Ставка не больше 100 000 000 ₽' });
    } else if (l.rate.type === 'none' && a !== 0) {
      errors.push({ memberId: l.memberId, message: 'Тип «нет» — ставка 0' });
    } else if ((l.rate.type === 'hourly' || l.rate.type === 'piece') && a === 0) {
      warnings.push({ memberId: l.memberId, message: 'ставка 0 — по сути „нет“' });
    }

    if (!Number.isInteger(l.contribNew) || l.contribNew < 0) {
      errors.push({ memberId: l.memberId, message: 'Вклад не может быть меньше нуля' });
    } else if (l.contribKind === 'item' && (!l.contribNote?.trim() || l.contribNew <= 0)) {
      errors.push({ memberId: l.memberId, message: 'Опиши вещь и укажи оценку' });
    } else if (leaving.has(l.memberId) && l.contribNew > 0) {
      errors.push({ memberId: l.memberId, message: 'Выходящий участник не может вносить новый вклад' });
    }

    const d = debt[l.memberId] ?? 0;
    const X = l.debtWriteOff;
    if (!Number.isInteger(X) || X < 0) {
      errors.push({ memberId: l.memberId, message: 'Сумма списания не может быть меньше нуля' });
    } else if (stage === 'propose' && X > d) {
      errors.push({ memberId: l.memberId, message: `Можно списать не больше ${formatRub(d)}` });
    }
  }

  // Должник может не иметь строки в новой версии — при выходе или выключении блока 2 долг всё равно списывается целиком.
  const lineOf = new Map(terms.lines.map((l) => [l.memberId, l]));
  for (const [id, d] of Object.entries(debt)) {
    const X = lineOf.get(id)?.debtWriteOff ?? 0;
    if (d > 0 && (!terms.contribEnabled || leaving.has(id)) && Number.isInteger(X) && X >= 0 && X < d) {
      const name = nameOf.get(id) ?? id;
      errors.push({
        memberId: id,
        message:
          stage === 'accept'
            ? `${name}: долг вырос до ${formatRub(d)} — предложите условия заново`
            : `Сначала верните или спишите весь долг: ${name} ${formatRub(d)}`,
      });
    }
  }

  if (terms.remainderMethod === 'contributions') {
    const total = ctx.contributionsTotal ?? Object.fromEntries(terms.lines.map((l) => [l.memberId, l.contribNew]));
    if (!inRem.some((l) => (total[l.memberId] ?? 0) > 0)) warnings.push({ message: 'Вкладов нет — поровну' });
  }

  return { errors, warnings };
}
