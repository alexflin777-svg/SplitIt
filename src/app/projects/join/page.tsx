'use client';

/**
 * Вход по ссылке в проект (экран 9 SCREENS-V1, стиль h4-friend): «Аня зовёт тебя
 * в проект „…“ · 3 участника» — через preview_project_invite, без сумм и условий.
 * Без входа — «Войти и присоединиться» (адрес возврата запоминается до входа),
 * со входом — «Присоединиться» → проект с плашкой «Прими условия».
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Lock, CheckCircle2 } from 'lucide-react';
import type { InvitePreview } from '@/lib/projects-store';
import { projects } from '@/lib/projects-client';
import { getActiveSession } from '@/lib/supabase';
import { rememberReturnPath } from '@/lib/auth-return';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Art, Card, MainButton, Plaque, SecondButton, Skeleton, V1Screen } from '@/components/v1/ui';
import { RouteShell } from '@/components/v1/project-bits';

function Join() {
  const router = useRouter();
  const code = useSearchParams().get('code');
  const { t } = useI18n();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    void Promise.all([projects.previewInvite(code), getActiveSession()]).then(([p, s]) => {
      if (!alive) return;
      setSignedIn(!!s);
      if (p.data) setPreview(p.data);
      else setFailed(p.error ?? t('join.invalid'));
    });
    return () => {
      alive = false;
    };
  }, [code, t]);

  const here = code ? routes.projectJoin(code) : routes.home();
  const join = async () => {
    if (!code) return;
    setBusy(true);
    const r = await projects.joinByInvite(code);
    if (!r.data) {
      setBusy(false);
      setFailed(r.error);
      return;
    }
    // join возвращает id участника, не проекта: ищем проект, где я — этот участник.
    const list = await projects.fetchProjects();
    for (const p of list.data ?? []) {
      if (p.name !== preview?.projectName) continue;
      const d = await projects.fetchProject(p.id);
      if (d.data?.members.some((m) => m.id === r.data)) {
        router.push(routes.projectDetail(p.id));
        return;
      }
    }
    setBusy(false);
    setFailed(list.error ?? t('join.invalid'));
  };

  const dead = !code || failed || (preview && !preview.isActive);
  return (
    <V1Screen
      testId="project-join"
      dock={
        dead ? (
          <MainButton href={routes.home()}>{t('invite.backToEvents')}</MainButton>
        ) : signedIn === false ? (
          <MainButton testId="join-signin" onClick={() => {
            rememberReturnPath(here);
            router.push(routes.auth('login', here));
          }}>
            <LogIn className="w-5 h-5" aria-hidden="true" />
            {t('join.signIn')}
          </MainButton>
        ) : (
          <MainButton testId="join-confirm" disabled={!preview || busy} onClick={() => void join()}>
            {busy ? t('invite.joiningButton') : t('join.join')}
          </MainButton>
        )
      }
    >
      <p className="pt-4 pb-2.5 text-[15px] font-semibold text-v1-muted">{t('join.kicker')}</p>
      {!code ? (
        <Plaque kind="err">{t('invite.errorNoCode')}</Plaque>
      ) : dead ? (
        <Plaque kind="err" testId="join-dead">
          <b>{t('join.dead')}</b> {failed && failed !== t('join.invalid') ? failed : ''}
        </Plaque>
      ) : !preview ? (
        <Skeleton rows={2} tall />
      ) : (
        <>
          <div className="relative overflow-hidden isolate rounded-tile px-5 pt-5 pb-6 min-h-[230px] bg-v1-lav" data-testid="join-card">
            <p className="text-[17px]">
              <b className="font-extrabold">{preview.inviterName ?? t('join.someone')}</b> {t('join.calls')}
            </p>
            <h1 className="mt-3.5 max-w-[8.5em] text-[32px] leading-[1.05] font-extrabold tracking-[-0.02em] relative z-[1]">«{preview.projectName}»</h1>
            <p className="mt-2.5 max-w-[12em] text-[15px] text-v1-ink2 relative z-[1]">{t('join.meta', { count: preview.memberCount })}</p>
            <Art name="receipts" className="absolute w-[120px] right-1 -bottom-6 rotate-[8deg] pointer-events-none" />
          </div>
          <Card className="mt-2 flex items-start gap-3 text-[15px] leading-snug">
            <CheckCircle2 className="w-5 h-5 flex-none" aria-hidden="true" />
            <span>
              <b>{t('join.after')}</b> {t('join.afterBody')}
            </span>
          </Card>
          <Card className="mt-2 flex items-start gap-3 text-[15px] leading-snug">
            <Lock className="w-5 h-5 flex-none" aria-hidden="true" />
            <span>
              <b>{t('join.hidden')}</b> {t('join.hiddenBody')}
            </span>
          </Card>
          {signedIn === false && <SecondButton href={routes.auth('register', here)}>{t('join.register')}</SecondButton>}
        </>
      )}
    </V1Screen>
  );
}

export default function Page() {
  return (
    <RouteShell>
      <Join />
    </RouteShell>
  );
}
