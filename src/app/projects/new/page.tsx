'use client';

/**
 * Создание проекта (макет h1-new) → конструктор в режиме «Создание» → экран
 * приглашения. Участники с аккаунтом приходят по ссылке после создания;
 * по имени добавляются гости (условия за них задаёт создатель).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { getActiveSession } from '@/lib/supabase';
import type { ProjectMember, Terms } from '@/lib/project-calc';
import { toRpcTerms } from '@/lib/projects-store';
import type { TermsPreset } from '@/lib/projects-store';
import { projects } from '@/lib/projects-client';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import KindPicker from '@/components/v1/KindPicker';
import TermsBuilder from '@/components/v1/TermsBuilder';
import { Avatar, MainButton, Plaque, TopNav, V1Screen } from '@/components/v1/ui';

export default function NewProjectPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [myName, setMyName] = useState('');
  const [guests, setGuests] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState<string | null>(null);
  const [step, setStep] = useState<'basics' | 'terms'>('basics');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void getActiveSession().then((s) => {
      setSignedIn(!!s);
      setMyName(s?.full_name || '');
    });
  }, []);

  const members: ProjectMember[] = [
    { id: 'p1', name: myName || t('project.you'), position: 1, role: 'user' },
    ...guests.map((g, i) => ({ id: `p${i + 2}`, name: g, position: i + 2, role: 'guest' as const })),
  ];

  const addGuest = () => {
    const g = (guestInput ?? '').trim();
    if (g && !guests.includes(g)) setGuests([...guests, g]);
    setGuestInput(null);
  };

  const submit = async (terms: Terms, preset: TermsPreset): Promise<string | null> => {
    // Строки условий при создании ссылаются на участников по position: id ещё нет.
    const body = toRpcTerms(terms, { preset });
    const res = await projects.createProject({
      name: name.trim(),
      currency: 'RUB',
      guests,
      terms: {
        ...body,
        lines: body.lines.map(({ member_id, ...l }) => ({ ...l, position: Number(member_id.slice(1)) })),
      },
    });
    if (!res.data) return res.error ?? t('project.new.failed');
    router.push(routes.projectInvite(res.data, { created: 1 }));
    return null;
  };

  if (step === 'terms') {
    return (
      <TermsBuilder
        projectName={name.trim()}
        members={members}
        mode="create"
        onExit={() => setStep('basics')}
        submitLabel={t('terms.submit.create')}
        submitBusyLabel={t('terms.submit.creating')}
        onSubmit={submit}
      />
    );
  }

  return (
    <V1Screen
      testId="project-new"
      dock={
        <MainButton testId="project-new-next" disabled={!name.trim() || !signedIn} onClick={() => setStep('terms')}>
          {t('project.new.next')}
        </MainButton>
      }
    >
      <TopNav back={routes.home()} close />
      <KindPicker value="project" />
      {signedIn === false && <Plaque kind="err">{t('project.new.signIn')}</Plaque>}

      <label className="mt-2 block px-6 py-3.5 rounded-card bg-v1-card">
        <span className="block text-[15px] text-v1-muted">{t('project.new.name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder={t('project.new.namePlaceholder')}
          data-testid="project-name"
          className="w-full bg-transparent outline-none text-[17px] font-bold placeholder:text-v1-muted placeholder:font-medium"
        />
      </label>
      {/* shortcut: проект только в рублях — formatRub ядра печатает ₽; другие валюты — после 1.1.0. */}
      <div className="mt-2 px-6 py-3.5 rounded-card bg-v1-card">
        <span className="block text-[15px] text-v1-muted">{t('project.new.currency')}</span>
        <span className="text-[17px] font-bold">{t('project.new.rub')}</span>
      </div>

      <div className="flex items-center justify-between mt-[22px] mb-3">
        <h2 className="text-xl leading-tight font-extrabold tracking-[-0.01em]">{t('project.new.people')}</h2>
        <button
          type="button"
          onClick={() => setGuestInput('')}
          data-testid="guest-add"
          className="h-11 px-4 rounded-full bg-v1-card inline-flex items-center gap-1.5 font-bold text-[15px]"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          {t('project.new.byName')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {members.map((m, i) => (
          <span key={m.id} className="h-11 inline-flex items-center gap-2 pl-1.5 pr-4 rounded-full bg-v1-accent-soft text-v1-accent-ink shadow-[inset_0_0_0_2px_var(--v1-accent)] font-semibold text-[15px]">
            <Avatar name={m.name} index={i} size="s" />
            {i === 0 ? t('project.you') : m.name}
            {i > 0 && (
              <button
                type="button"
                aria-label={t('project.new.removeGuest', { name: m.name })}
                onClick={() => setGuests(guests.filter((g) => g !== m.name))}
                className="ml-1 text-v1-muted"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {guestInput !== null && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addGuest();
          }}
        >
          <input
            autoFocus
            value={guestInput}
            onChange={(e) => setGuestInput(e.target.value)}
            maxLength={80}
            placeholder={t('project.new.guestPlaceholder')}
            data-testid="guest-name"
            className="flex-1 h-11 px-4 rounded-full bg-v1-card outline-none text-base font-semibold"
          />
          <button type="submit" className="h-11 px-4 rounded-full bg-v1-ink text-white font-bold" data-testid="guest-save">
            {t('project.new.addGuest')}
          </button>
        </form>
      )}
      <p className="mt-2.5 text-[15px] leading-snug text-v1-muted">{t('project.new.peopleHint')}</p>
    </V1Screen>
  );
}
