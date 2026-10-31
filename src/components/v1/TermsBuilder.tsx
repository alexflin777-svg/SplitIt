'use client';

/**
 * Конструктор условий (макеты h1-terms-template → h1-terms-people → h1-terms-borya /
 * h1-terms-vika / h1-terms-noshare / h1-terms-error → h1-terms-preview; PROJECT-SPEC §3а).
 *
 * Шаги: шаблон → общие настройки и карточки участников → предпросмотр. Проверки —
 * validateTerms ядра, у полей и над кнопкой; предпросмотр — simulatePreview на
 * видимых входах, ничего не записывает. Без предпросмотра отправить нельзя.
 */

import { useMemo, useState } from 'react';
import { Check, ChevronRight, ChevronUp, Plus, AlertTriangle } from 'lucide-react';
import { simulatePreview, validateTerms } from '@/lib/project-calc';
import type { Operation, ProjectMember, Quantity, RateType, RemainderMethod, TermLine, Terms } from '@/lib/project-calc';
import type { TermsPreset } from '@/lib/projects-store';
import { PRESETS, applyPreset, formatQty, formatRub, lineSummary, parseQty, parseRub, quantityFields, withMethod } from '@/lib/project-ui';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, BlockHead, Card, Chip, Header, MainButton, Plaque, Row, Segment, Toggle, TopNav, V1Screen, cx } from './ui';

type Step = 'template' | 'setup' | 'member' | 'preview';

export interface TermsBuilderProps {
  projectName: string;
  /** Участники по position; в режиме создания id временные. */
  members: ProjectMember[];
  mode: 'create' | 'change';
  initial?: Terms;
  initialPreset?: TermsPreset;
  /** Текущий баланс журнала долга (изменение условий). */
  ledgerDebt?: Record<string, number>;
  contributionsTotal?: Record<string, number>;
  /** Куда «назад» с первого шага. */
  onExit: () => void;
  submitLabel: string;
  submitBusyLabel: string;
  onSubmit: (terms: Terms, preset: TermsPreset) => Promise<string | null>;
}

const TILE_BG: Record<TermsPreset, string> = {
  equal: 'bg-v1-trip',
  a: 'bg-[#DAE8DF]',
  b: 'bg-v1-sand',
  v: 'bg-[#FAD3E1]',
  custom: 'bg-v1-lav',
};

const RATE_TYPES: RateType[] = ['none', 'period', 'hourly', 'piece'];
const METHODS: RemainderMethod[] = ['equal', 'percent', 'contributions', 'hours'];

function Steps({ step }: { step: Step }) {
  const { t } = useI18n();
  const order = ['template', 'setup', 'preview'] as const;
  const cur = step === 'member' ? 1 : order.indexOf(step as (typeof order)[number]);
  return (
    <ol className="flex gap-1.5 -mt-1 mb-3.5">
      {order.map((s, i) => (
        <li
          key={s}
          className={cx(
            'flex-1 flex items-center gap-2 h-10 px-2.5 rounded-full bg-v1-card text-sm font-bold',
            i === cur ? 'text-v1-ink' : 'text-v1-muted',
          )}
        >
          <i
            className={cx(
              'not-italic w-6 h-6 rounded-full grid place-items-center text-[13px] flex-none',
              i === cur ? 'bg-v1-ink text-white' : i < cur ? 'bg-v1-plus text-v1-ink' : 'bg-v1-fill text-v1-ink2',
            )}
          >
            {i < cur ? <Check className="w-[15px] h-[15px]" aria-hidden="true" /> : i + 1}
          </i>
          {t(`terms.step.${s}`)}
        </li>
      ))}
    </ol>
  );
}

function Chain() {
  const { t } = useI18n();
  return (
    <div className="px-3 py-2.5 rounded-row bg-v1-card text-[15px] tracking-[-0.015em]">
      <b className="block font-bold text-v1-muted mb-0.5">{t('terms.chain.title')}</b>
      <span className="font-bold">{t('terms.chain.body')}</span>
    </div>
  );
}

/** Ввод суммы с сырым текстом: «1500,» не переформатируется посреди набора. */
function useRaw() {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const get = (key: string, fallback: string) => raw[key] ?? fallback;
  const set = (key: string, v: string) => setRaw((r) => ({ ...r, [key]: v }));
  /** Набранный текст не разбирается: в условиях осталось прежнее число — дальше идти нельзя. */
  const bad = (key: string, parse: (s: string) => number | null) => {
    const v = raw[key];
    return v !== undefined && v.trim() !== '' && parse(v) === null;
  };
  return { get, set, bad, reset: () => setRaw({}) };
}

export default function TermsBuilder(props: TermsBuilderProps) {
  const { t } = useI18n();
  const { members, mode } = props;
  const [step, setStep] = useState<Step>(mode === 'create' ? 'template' : 'setup');
  const [preset, setPreset] = useState<TermsPreset>(props.initialPreset ?? 'custom');
  const [edited, setEdited] = useState(false);
  const [terms, setTerms] = useState<Terms>(() => props.initial ?? applyPreset('custom', members.map((m) => m.id)));
  const [editing, setEditing] = useState<string | null>(null);
  const [showContrib, setShowContrib] = useState<Record<string, boolean>>({});
  const raw = useRaw();
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? '';
  const idx = (id: string) => Math.max(0, members.findIndex((m) => m.id === id));

  const check = useMemo(
    () =>
      validateTerms(terms, {
        members,
        currentDebt: props.ledgerDebt,
        contributionsTotal: props.contributionsTotal,
      }),
    [terms, members, props.ledgerDebt, props.contributionsTotal],
  );
  const errorsOf = (id: string) => check.errors.filter((e) => e.memberId === id);
  const globalErrors = check.errors.filter((e) => !e.memberId);
  /** Видимые поля участника с неразобранным текстом (скрытые поля в условия не идут). */
  const rawBad = (id: string) => {
    const l = terms.lines.find((x) => x.memberId === id);
    if (!l) return false;
    const i = idx(id);
    return (
      (terms.contribEnabled && (raw.bad(`contrib-${i}`, parseRub) || raw.bad(`writeoff-${i}`, parseRub))) ||
      (l.rate.type !== 'none' && raw.bad(`rate-${i}`, parseRub)) ||
      (terms.remainderMethod === 'percent' && l.inRemainder && raw.bad(`share-${i}`, parseQty))
    );
  };
  const anyRawBad = members.some((m) => rawBad(m.id));

  const patchLine = (id: string, patch: Partial<TermLine>) => {
    setEdited(true);
    setTerms((tr) => ({ ...tr, lines: tr.lines.map((l) => (l.memberId === id ? { ...l, ...patch } : l)) }));
  };

  /** Поле суммы → копейки в условиях; мусор не пишется, поле краснеет. */
  const money = (key: string, cents: number, onCents: (c: number) => void, label: string, suffix = '₽') => {
    const v = raw.get(key, cents ? formatQty(cents) : '');
    const parsed = v.trim() === '' ? 0 : parseRub(v);
    return (
      <NumField
        value={v}
        label={label}
        suffix={suffix}
        invalid={parsed === null}
        testId={key}
        onChange={(s) => {
          raw.set(key, s);
          const c = s.trim() === '' ? 0 : parseRub(s);
          if (c !== null) onCents(c);
        }}
      />
    );
  };

  // ---------------------------------------------------------------- шаг 1: шаблон
  if (step === 'template') {
    return (
      <V1Screen
        testId="terms-template"
        dock={
          <MainButton testId="terms-next" onClick={() => setStep('setup')}>
            {t('terms.next.setup')}
          </MainButton>
        }
      >
        <TopNav onBack={props.onExit} />
        <Header title={t('terms.title')} sub={props.projectName} />
        <Steps step={step} />
        <Chain />
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <li key={p} className={p === 'custom' ? 'col-span-2' : undefined}>
              <button
                type="button"
                aria-pressed={preset === p}
                data-testid={`preset-${p}`}
                onClick={() => {
                  setPreset(p);
                  setEdited(false);
                  raw.reset();
                  setTerms(applyPreset(p, members.map((m) => m.id)));
                }}
                className={cx(
                  'relative w-full text-left flex flex-col gap-1.5 px-4 py-3.5 rounded-card',
                  p === 'custom' ? 'min-h-24' : 'min-h-28',
                  TILE_BG[p],
                  preset === p && 'shadow-[inset_0_0_0_3px_var(--v1-accent)]',
                )}
              >
                <b className="text-lg leading-[1.12] font-extrabold tracking-[-0.015em] pr-7">{t(`terms.preset.${p}`)}</b>
                <span className="text-[15px] leading-snug text-v1-ink2">{t(`terms.preset.${p}.how`)}</span>
                {preset === p && (
                  <span className="absolute top-3 right-3 w-7 h-7 rounded-full bg-v1-accent text-white grid place-items-center">
                    <Check className="w-[18px] h-[18px]" aria-hidden="true" />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </V1Screen>
    );
  }

  // ---------------------------------------------------------------- карточка участника
  if (step === 'member' && editing) {
    const l = terms.lines.find((x) => x.memberId === editing)!;
    const m = members.find((x) => x.id === editing)!;
    const errs = errorsOf(editing);
    const shareSum = terms.lines.filter((x) => x.inRemainder).reduce((s, x) => s + x.shareBp, 0);
    const sumBad = terms.remainderMethod === 'percent' && shareSum !== 10_000;
    const debt = props.ledgerDebt?.[editing] ?? 0;
    const contribOpen = l.contribNew > 0 || showContrib[editing] || l.contribKind === 'item';
    const memberBad = rawBad(editing);
    // С неразобранным полем не уходим: иначе в условиях молча останется прежнее число.
    const leave = () => {
      if (!memberBad) setStep('setup');
    };
    return (
      <V1Screen
        testId="terms-member"
        dock={
          <>
            {memberBad && (
              <p className="mb-2 text-center text-[15px] font-semibold text-v1-danger" role="alert" data-testid="terms-raw-error">
                {t('terms.rawInvalid')}
              </p>
            )}
            <MainButton testId="member-done" disabled={errs.length > 0 || sumBad || memberBad} onClick={leave}>
              {t('terms.done')}
            </MainButton>
            {sumBad && (
              <p className="mt-2 text-center text-[15px] font-semibold text-v1-danger">
                {t('terms.sumBlock', { sum: formatQty(shareSum) })}
              </p>
            )}
          </>
        }
      >
        <TopNav onBack={leave} />
        <Header title={t('terms.member.title')} sub={`${props.projectName} · ${m.name}`} />
        <Card className={cx('px-4 pt-3.5 pb-3', (errs.length > 0 || sumBad || memberBad) && 'shadow-[inset_0_0_0_2px_#D93A2B]')} testId={`member-card-${idx(editing)}`}>
          <div className="flex items-center gap-3">
            <Avatar name={m.name} index={idx(editing)} size="s" />
            <span className="flex-1 font-bold text-base">{m.name}</span>
            <button type="button" onClick={leave} disabled={memberBad} aria-label={t('terms.collapse')} className="w-9 h-9 rounded-full bg-v1-bg grid place-items-center disabled:opacity-40">
              <ChevronUp className="w-[18px] h-[18px]" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 min-h-12 mt-1.5">
            <p className="text-base font-semibold">{t('terms.expensesBack')}</p>
            <Toggle on={l.expensesBack} onChange={(v) => patchLine(editing, { expensesBack: v })} label={t('terms.expensesBack')} testId="toggle-expenses" />
          </div>
          {!l.expensesBack && <p className="text-[15px] text-v1-muted">{t('terms.ownExpensesHint', { name: m.name })}</p>}

          {terms.contribEnabled && (
            <>
              <div className="flex items-start justify-between gap-3 mt-2.5">
                <div>
                  <p className="text-[15px] font-bold text-v1-ink2">{t('terms.contrib')}</p>
                  {!contribOpen && <p className="text-[15px] text-v1-muted">{t('terms.contribNone')}</p>}
                </div>
                {!contribOpen && (
                  <button
                    type="button"
                    data-testid="contrib-add"
                    onClick={() => setShowContrib((s) => ({ ...s, [editing]: true }))}
                    className="h-10 px-3.5 rounded-full bg-v1-bg font-bold text-[15px] inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-[18px] h-[18px]" aria-hidden="true" />
                    {t('terms.add')}
                  </button>
                )}
              </div>
              {contribOpen && (
                <>
                  <div className="mt-2">
                    <Segment
                      inCard
                      value={l.contribKind ?? 'money'}
                      onChange={(v) => patchLine(editing, { contribKind: v })}
                      options={[
                        { value: 'money', label: t('terms.contribMoney') },
                        { value: 'item', label: t('terms.contribItem') },
                      ]}
                    />
                  </div>
                  <div className={cx('grid gap-2', l.contribKind === 'item' ? 'grid-cols-[1.5fr_1fr]' : 'grid-cols-1')}>
                    {l.contribKind === 'item' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-v1-muted">{t('terms.itemWhat')}</span>
                        <input
                          value={l.contribNote ?? ''}
                          onChange={(e) => patchLine(editing, { contribNote: e.target.value })}
                          data-testid="contrib-note"
                          className="h-11 px-3.5 rounded-chip bg-v1-bg shadow-[inset_0_0_0_2px_#DFE2E8] font-extrabold text-[17px] outline-none min-w-0"
                        />
                      </label>
                    )}
                    <label className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-v1-muted">{l.contribKind === 'item' ? t('terms.itemValue') : t('terms.contribSum')}</span>
                      {money(`contrib-${idx(editing)}`, l.contribNew, (c) => patchLine(editing, { contribNew: c }), t('terms.contrib'))}
                    </label>
                  </div>
                  <p className="mt-2.5 px-3 py-2.5 rounded-[14px] bg-v1-bg text-[15px] leading-snug text-v1-ink2">{t('terms.contribHint')}</p>
                </>
              )}
              {debt > 0 && (
                <div className="mt-2.5">
                  <p className="text-[15px] font-bold text-v1-ink2">{t('terms.writeOff', { debt: formatRub(debt) })}</p>
                  <div className="mt-1">{money(`writeoff-${idx(editing)}`, l.debtWriteOff, (c) => patchLine(editing, { debtWriteOff: c }), t('terms.writeOff', { debt: formatRub(debt) }))}</div>
                  <p className="mt-1 text-[15px] text-v1-muted">{t('terms.writeOffHint')}</p>
                </div>
              )}
            </>
          )}

          <p className="mt-2.5 mb-2 text-[15px] font-bold text-v1-ink2">{t('terms.rate')}</p>
          <div className="flex flex-wrap gap-1.5">
            {RATE_TYPES.map((rt) => (
              <Chip
                key={rt}
                on={l.rate.type === rt}
                testId={`rate-${rt}`}
                onClick={() => patchLine(editing, { rate: { type: rt, amount: rt === 'none' ? 0 : l.rate.amount } })}
              >
                {t(`terms.rate.${rt}`)}
              </Chip>
            ))}
          </div>
          {l.rate.type !== 'none' && (
            <div className="flex items-center gap-2.5 mt-2">
              {money(`rate-${idx(editing)}`, l.rate.amount, (c) => patchLine(editing, { rate: { ...l.rate, amount: c } }), t('terms.rate'))}
              <span className="text-[15px] leading-snug text-v1-muted">
                {t(`terms.rateHint.${l.rate.type}`)}
                {(l.rate.type === 'hourly' || l.rate.type === 'piece') && ` · ${m.role === 'guest' ? t('terms.qtyByOwner') : t('terms.qtyBySelf')}`}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 min-h-12 mt-2">
            <p className="text-base font-semibold">{t('terms.inRemainder')}</p>
            <div className="flex items-center gap-2">
              {terms.remainderMethod === 'percent' && l.inRemainder && (
                <span className="w-[84px]">
                  <NumField
                    value={raw.get(`share-${idx(editing)}`, formatQty(l.shareBp))}
                    label={t('terms.share')}
                    suffix="%"
                    testId={`share-${idx(editing)}`}
                    invalid={sumBad || errs.some((e) => /доля/.test(e.message))}
                    onChange={(s) => {
                      raw.set(`share-${idx(editing)}`, s);
                      const bp = s.trim() === '' ? 0 : parseQty(s);
                      if (bp !== null) patchLine(editing, { shareBp: bp });
                    }}
                  />
                </span>
              )}
              <Toggle
                on={l.inRemainder}
                testId="toggle-remainder"
                label={t('terms.inRemainder')}
                onChange={(v) => patchLine(editing, { inRemainder: v, shareBp: v ? l.shareBp : 0 })}
              />
            </div>
          </div>
          {!l.inRemainder && <p className="mt-1 px-3 py-2.5 rounded-[14px] bg-v1-bg text-[15px] text-v1-ink2">{t('terms.noShareHint', { name: m.name })}</p>}

          {[...errs, ...(sumBad ? globalErrors : [])].map((e) => (
            <p key={e.message} className="mt-1 flex items-center gap-2 text-[15px] font-bold text-v1-danger" role="alert">
              <AlertTriangle className="w-[18px] h-[18px] flex-none" aria-hidden="true" />
              {e.message}
            </p>
          ))}
        </Card>
        {terms.remainderMethod === 'percent' && <ShareBar terms={terms} members={members} />}
      </V1Screen>
    );
  }

  // ---------------------------------------------------------------- шаг 2: настройка
  if (step === 'setup' || step === 'member') {
    return (
      <V1Screen
        testId="terms-setup"
        dock={
          <MainButton testId="terms-next" disabled={check.errors.length > 0 || anyRawBad} onClick={() => setStep('preview')}>
            {t('terms.next.preview')}
          </MainButton>
        }
      >
        <TopNav onBack={mode === 'create' ? () => setStep('template') : props.onExit} />
        <Header
          title={t('terms.title')}
          sub={`${props.projectName} · ${mode === 'change' ? t('terms.changeSub') : t(`terms.preset.${preset}`).toLowerCase()}${edited && mode === 'create' && preset !== 'custom' ? ` · ${t('terms.edited')}` : ''}`}
        />
        <Steps step={step} />
        <Card>
          <p className="text-base font-bold">{t('terms.method')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {METHODS.map((mm) => (
              <Chip
                key={mm}
                on={terms.remainderMethod === mm}
                testId={`method-${mm}`}
                onClick={() => {
                  setEdited(true);
                  setTerms((tr) => withMethod(tr, mm));
                }}
              >
                {t(`terms.method.${mm}`)}
              </Chip>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 min-h-12 mt-3">
            <p className="text-base font-bold">
              {t('terms.contribEnabled')}
              <span className="block text-[15px] font-medium text-v1-muted">{t('terms.contribEnabledHint')}</span>
            </p>
            <Toggle
              on={terms.contribEnabled}
              testId="toggle-contrib"
              label={t('terms.contribEnabled')}
              onChange={(v) => {
                setEdited(true);
                setTerms((tr) => ({ ...tr, contribEnabled: v }));
              }}
            />
          </div>
          <p className="mt-2.5 text-[15px] text-v1-muted">{t('terms.lossSame')}</p>
        </Card>

        <BlockHead title={t('terms.people')} right={t('terms.tapToEdit')} />
        <div className="flex flex-col gap-1.5">
          {terms.lines.map((l) => (
            <Row
              key={l.memberId}
              testId={`member-row-${idx(l.memberId)}`}
              className={errorsOf(l.memberId).length || rawBad(l.memberId) ? 'shadow-[inset_0_0_0_2px_#D93A2B]' : undefined}
              onClick={() => {
                setEditing(l.memberId);
                setStep('member');
              }}
              left={<Avatar name={nameOf(l.memberId)} index={idx(l.memberId)} />}
              title={nameOf(l.memberId)}
              meta={lineSummary(l, terms, t)}
              right={<ChevronRight className="w-5 h-5 text-v1-muted" aria-hidden="true" />}
            />
          ))}
        </div>
        <div className="mt-3">
          {anyRawBad && <Plaque kind="err">{t('terms.rawInvalid')}</Plaque>}
          {check.errors.map((e) => (
            <Plaque key={`${e.memberId ?? ''}${e.message}`} kind="err">
              {e.message}
            </Plaque>
          ))}
          {check.warnings.map((w) => (
            <Plaque key={`${w.memberId ?? ''}${w.message}`} kind="info">
              {w.memberId ? `${nameOf(w.memberId)}: ${w.message}` : w.message}
            </Plaque>
          ))}
        </div>
      </V1Screen>
    );
  }

  // ---------------------------------------------------------------- шаг 3: предпросмотр
  return (
    <Preview
      {...props}
      terms={terms}
      preset={preset}
      busy={busy}
      error={submitError}
      onBack={() => setStep('setup')}
      onSend={async () => {
        if (anyRawBad || check.errors.length > 0) return setStep('setup');
        setBusy(true);
        setSubmitError(null);
        const err = await props.onSubmit(terms, preset);
        setBusy(false);
        if (err) setSubmitError(err);
      }}
    />
  );
}

function NumField(p: { value: string; onChange: (v: string) => void; label: string; suffix?: string; invalid?: boolean; testId?: string }) {
  return (
    <label
      className={cx(
        'flex items-center h-11 px-3.5 rounded-chip font-extrabold text-[17px] min-w-0',
        p.invalid ? 'bg-v1-warn shadow-[inset_0_0_0_2px_#D93A2B] text-v1-danger' : 'bg-v1-bg shadow-[inset_0_0_0_2px_#DFE2E8]',
      )}
    >
      <input
        inputMode="decimal"
        value={p.value}
        aria-label={p.label}
        aria-invalid={p.invalid || undefined}
        data-testid={p.testId}
        placeholder="0"
        onChange={(e) => p.onChange(e.target.value)}
        className="bg-transparent outline-none min-w-0 w-full font-extrabold"
      />
      {p.suffix && <span className="ml-1 text-v1-ink2">{p.suffix}</span>}
    </label>
  );
}

const BAR = ['bg-v1-trip', 'bg-[#DAE8DF]', 'bg-[#FAD3E1]', 'bg-v1-sand', 'bg-v1-minus', 'bg-v1-lav'];

function ShareBar({ terms, members }: { terms: Terms; members: ProjectMember[] }) {
  const { t } = useI18n();
  const parts = terms.lines.filter((l) => l.inRemainder && l.shareBp > 0);
  const sum = parts.reduce((s, l) => s + l.shareBp, 0);
  const miss = Math.max(0, 10_000 - sum);
  const idx = (id: string) => Math.max(0, members.findIndex((m) => m.id === id));
  return (
    <div className="mx-1 mt-3" data-testid="share-bar">
      <div className="flex gap-[3px] h-3.5 rounded-[7px] overflow-hidden">
        {parts.map((l) => (
          <span key={l.memberId} className={BAR[idx(l.memberId) % BAR.length]} style={{ width: `${(l.shareBp / Math.max(sum, 10_000)) * 100}%` }} />
        ))}
        {miss > 0 && (
          <span
            className="rounded-r-[7px] shadow-[inset_0_0_0_1.5px_#D93A2B] bg-[repeating-linear-gradient(45deg,#FFD6D3_0_6px,#fff_6px_12px)]"
            style={{ width: `${miss / 100}%` }}
          />
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[15px] font-bold">
        {parts.map((l) => (
          <li key={l.memberId} className="flex items-center gap-1.5">
            <i className={cx('w-3 h-3 rounded', BAR[idx(l.memberId) % BAR.length])} />
            {members[idx(l.memberId)]?.name} {formatQty(l.shareBp)} %
          </li>
        ))}
        {miss > 0 && <li className="text-v1-danger">{t('terms.missing', { pct: formatQty(miss) })}</li>}
      </ul>
    </div>
  );
}

function Preview(
  props: TermsBuilderProps & {
    terms: Terms;
    preset: TermsPreset;
    busy: boolean;
    error: string | null;
    onBack: () => void;
    onSend: () => void;
  },
) {
  const { t } = useI18n();
  const { members, terms } = props;
  const [income, setIncome] = useState('100 000');
  const [exp, setExp] = useState<Record<string, string>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const idx = (id: string) => Math.max(0, members.findIndex((m) => m.id === id));
  const lineOf = new Map(terms.lines.map((l) => [l.memberId, l]));
  const needs = members
    .map((m) => ({ m, f: quantityFields(lineOf.get(m.id), terms.remainderMethod) }))
    .filter((x) => x.f.hours || x.f.pieces);

  const sample = parseRub(income) ?? 0;
  const ops: Operation[] = sample > 0 ? [{ type: 'income', memberId: members[0].id, amount: sample }] : [];
  for (const m of members) {
    const c = parseRub(exp[m.id] ?? '');
    if (c) ops.push({ type: 'expense', memberId: m.id, amount: c });
  }
  const quantities: Record<string, Quantity> = {};
  for (const { m, f } of needs) {
    quantities[m.id] = {
      hours: f.hours ? parseQty(qty[`${m.id}:h`] ?? '') ?? 0 : 0,
      pieces: f.pieces ? parseQty(qty[`${m.id}:p`] ?? '') ?? 0 : 0,
    };
  }
  const { after } = simulatePreview({
    members,
    terms,
    ledgerDebt: props.ledgerDebt,
    operations: ops,
    quantities,
    contributionsTotal: props.contributionsTotal,
  });
  // На примере количества — примерные: своя подпись вместо «не внесены — ставка 0».
  const notes = after.notes.filter((n) => !/не внесены — ставка 0$/.test(n));
  for (const { m } of needs) {
    const l = lineOf.get(m.id);
    if (l?.rate.type === 'hourly' && !quantities[m.id].hours) notes.push(t('terms.preview.zeroHours', { name: m.name }));
    if (l?.rate.type === 'piece' && !quantities[m.id].pieces) notes.push(t('terms.preview.zeroPieces', { name: m.name }));
  }
  const debtLines = members
    .map((m) => {
      const l = lineOf.get(m.id);
      const d = props.ledgerDebt?.[m.id] ?? 0;
      const add = terms.contribEnabled ? l?.contribNew ?? 0 : 0;
      return { m, d, add, total: d + add - Math.min(l?.debtWriteOff ?? 0, d) };
    })
    .filter((x) => x.total > 0 || x.d > 0);

  const split =
    terms.remainderMethod === 'percent'
      ? terms.lines.filter((l) => l.inRemainder).map((l) => formatQty(l.shareBp)).join(' / ')
      : t(`terms.method.${terms.remainderMethod}`);

  return (
    <V1Screen
      testId="terms-preview"
      dock={
        <>
          {props.error && (
            <Plaque kind="err" testId="terms-submit-error">
              {t('terms.submitFailed', { error: props.error })}
            </Plaque>
          )}
          <MainButton testId="terms-submit" disabled={props.busy || sample <= 0} onClick={props.onSend}>
            {props.busy ? props.submitBusyLabel : props.error ? t('common.retry') : props.submitLabel}
          </MainButton>
        </>
      }
    >
      <TopNav onBack={props.onBack} />
      <Header title={t('terms.title')} sub={props.projectName} />
      <Steps step="preview" />
      <Card>
        <h3 className="text-lg font-extrabold mb-2.5">{t('terms.preview.inputs')}</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-v1-muted">{t('terms.preview.income')}</span>
            <NumField value={income} onChange={setIncome} label={t('terms.preview.income')} suffix="₽" invalid={parseRub(income) === null} testId="preview-income" />
          </label>
          {needs.map(({ m, f }) => (
            <div key={m.id} className="contents">
              {f.hours && (
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-v1-muted">{t('terms.preview.approxHours', { name: m.name })}</span>
                  <NumField
                    value={qty[`${m.id}:h`] ?? ''}
                    onChange={(v) => setQty((q) => ({ ...q, [`${m.id}:h`]: v }))}
                    label={t('terms.preview.approxHours', { name: m.name })}
                    suffix={t('project.qty.h')}
                    testId={`preview-hours-${idx(m.id)}`}
                  />
                </label>
              )}
              {f.pieces && (
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-v1-muted">{t('terms.preview.approxPieces', { name: m.name })}</span>
                  <NumField
                    value={qty[`${m.id}:p`] ?? ''}
                    onChange={(v) => setQty((q) => ({ ...q, [`${m.id}:p`]: v }))}
                    label={t('terms.preview.approxPieces', { name: m.name })}
                    suffix={t('project.qty.pcs')}
                    testId={`preview-pieces-${idx(m.id)}`}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 mb-1.5 text-[15px] font-bold text-v1-ink2">{t('terms.preview.whoPaid')}</p>
        <div className="grid grid-cols-3 gap-2">
          {members.map((m) => (
            <label key={m.id} className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-v1-muted truncate">{m.name}</span>
              <NumField value={exp[m.id] ?? ''} onChange={(v) => setExp((e) => ({ ...e, [m.id]: v }))} label={t('terms.preview.paidBy', { name: m.name })} suffix="₽" />
            </label>
          ))}
        </div>
        {debtLines.length > 0 && (
          <p className="mt-2.5 text-[15px] text-v1-ink2">
            {t('terms.preview.debt', {
              list: debtLines.map((x) => `${x.m.name} ${formatRub(x.d)} + ${formatRub(x.add)} = ${formatRub(x.total)}`).join('; '),
            })}
          </p>
        )}
        <p className="mt-2.5 text-[15px] text-v1-muted">{t('terms.preview.onlyExample')}</p>
      </Card>

      <BlockHead title={t('terms.preview.who')} right={t('terms.preview.count', { count: members.length })} />
      <div className="mb-2 px-3.5 py-3 rounded-row bg-v1-lav text-base leading-snug font-semibold" data-testid="preview-chain">
        {t('terms.preview.chain', {
          income: formatRub(after.netIncome),
          contrib: formatRub(after.contributionsRepaid),
          rates: formatRub(after.ratesPaid),
          rest: formatRub(after.remainder),
          split,
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        {after.order.map((id) => {
          const p = after.perPerson[id];
          const bits = [
            p.expensesBack ? t('terms.preview.bitExpenses', { amount: formatRub(p.expensesBack) }) : null,
            p.contributionBack ? t('terms.preview.bitContrib', { amount: formatRub(p.contributionBack) }) : null,
            p.rate ? t('terms.preview.bitRate', { amount: formatRub(p.rate) }) : null,
            p.remainderShare ? t('terms.preview.bitRest', { amount: formatRub(p.remainderShare) }) : null,
          ].filter(Boolean);
          return (
            <Row
              key={id}
              testId={`preview-row-${idx(id)}`}
              left={<Avatar name={p.name} index={idx(id)} />}
              title={p.name}
              meta={bits.join(' + ') || '—'}
              right={<span data-testid={`preview-owed-${idx(id)}`}>{formatRub(p.owed)}</span>}
            />
          );
        })}
      </div>
      {notes.map((n) => (
        <p key={n} className="mt-2 px-1 text-[15px] text-v1-ink2">
          {n}
        </p>
      ))}
      <p className="mt-2 px-1 text-[15px] text-v1-muted">{t('terms.preview.transfersNote')}</p>
    </V1Screen>
  );
}
