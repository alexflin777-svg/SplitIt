'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Lock, LogIn, Mail } from 'lucide-react';
import { redeemInvite, invitesAvailable, previewInvite } from '@/lib/store';
import type { EventInvitePreview } from '@/lib/remote-store';
import { getActiveSession, signInWithGoogle, UserProfile } from '@/lib/supabase';
import { rememberReturnPath } from '@/lib/auth-return';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Art, Card, MainButton, Plaque, SecondButton, Skeleton, V1Screen } from '@/components/v1/ui';

type State =
  | { kind: 'loading' }
  | { kind: 'need-auth' }
  | { kind: 'confirm' }
  | { kind: 'joining' }
  | { kind: 'error'; message: string };

/**
 * Экран вступления по приглашению (экран 9 SCREENS-V1, стиль h4-friend).
 *
 * Вступление никогда не происходит само: пользователь видит, во что его
 * зовут, и нажимает кнопку. Код проверяет база — `redeem_group_invite`.
 *
 * Название события, кто зовёт, сколько участников и срок ссылки — из
 * `preview_group_invite` (без сумм и списка участников). Недействующая ссылка —
 * ошибка до входа, а не после.
 *
 * Адрес возврата запоминается до ухода на вход: Google и Telegram уводят со
 * страницы, и ?next= теряется (SCENARIOS-AUDIT §4 п. 1).
 */
export default function InviteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const { t, locale } = useI18n();

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [preview, setPreview] = useState<EventInvitePreview | null>(null);

  // Ошибки, известные без сети, вычисляются при рендере, а не ставятся из
  // эффекта (P1-6): нет кода в ссылке или приложение собрано без бэкенда.
  const staticError = !code
    ? t('invite.errorNoCode')
    : !invitesAvailable()
      ? t('invite.errorLocalOnly')
      : null;

  useEffect(() => {
    if (staticError || !code) return;
    void Promise.all([previewInvite(code), getActiveSession()]).then(([pv, session]) => {
      if (pv.error || !pv.data) return setState({ kind: 'error', message: pv.error ?? t('invite.errorRedeemFailed') });
      if (!pv.data.is_active) return setState({ kind: 'error', message: t('errors.inviteInvalidOrExpired') });
      setPreview(pv.data);
      setProfile(session);
      setState(session ? { kind: 'confirm' } : { kind: 'need-auth' });
    });
  }, [staticError, code, t]);

  const until = preview?.expires_at
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(preview.expires_at))
    : null;

  const here = routes.invite(code ?? '');
  const authHref = routes.auth('login', here);

  const handleJoin = async () => {
    if (!code) return;
    setState({ kind: 'joining' });

    const { data: groupId, error } = await redeemInvite(code);
    if (error || !groupId) {
      setState({ kind: 'error', message: error ?? t('invite.errorRedeemFailed') });
      return;
    }
    // joined=1 — экран события показывает подтверждение вступления (макет h4-joined).
    router.push(routes.eventDetail(groupId, { joined: 1 }));
  };

  const google = async () => {
    rememberReturnPath(here);
    const res = await signInWithGoogle();
    if (res.error) setState({ kind: 'error', message: res.error });
  };

  const view: State = staticError ? { kind: 'error', message: staticError } : state;

  return (
    <V1Screen
      testId="event-invite"
      dock={
        view.kind === 'need-auth' ? (
          <>
            <MainButton testId="invite-signin" href={authHref}>
              <LogIn className="w-5 h-5" aria-hidden="true" />
              {t('invite.signInButton')}
            </MainButton>
            <div className="grid grid-cols-2 gap-2">
              <SecondButton onClick={() => void google()}>Google</SecondButton>
              <SecondButton href={authHref}>
                <Mail className="w-5 h-5" aria-hidden="true" />
                {t('invite.v1.email')}
              </SecondButton>
            </div>
          </>
        ) : view.kind === 'confirm' || view.kind === 'joining' ? (
          <MainButton testId="invite-join" onClick={handleJoin} disabled={view.kind === 'joining'}>
            {view.kind === 'joining' ? t('invite.joiningButton') : t('invite.joinButton')}
          </MainButton>
        ) : view.kind === 'error' ? (
          <MainButton href={routes.home()}>{t('invite.backToEvents')}</MainButton>
        ) : undefined
      }
    >
      <p className="pt-4 pb-2.5 text-[15px] font-semibold text-v1-muted">{t('invite.v1.kicker')}</p>

      {view.kind === 'loading' && (
        <>
          <p className="sr-only">{t('invite.loading')}</p>
          <Skeleton rows={2} tall />
        </>
      )}

      {view.kind === 'error' && (
        <div role="alert" data-testid="invite-error">
          <Plaque kind="err">
            <b className="block">{t('invite.errorTitle')}</b>
            <span>{view.message}</span>
          </Plaque>
        </div>
      )}

      {(view.kind === 'need-auth' || view.kind === 'confirm' || view.kind === 'joining') && (
        <>
          <div className="relative overflow-hidden isolate rounded-tile px-5 pt-5 pb-6 min-h-[200px] bg-v1-trip" data-testid="invite-preview">
            {preview && (
              <div className="flex items-center gap-3 mb-3 relative z-[1] text-[17px]">
                <span className="w-10 h-10 rounded-full bg-white grid place-items-center font-extrabold flex-none" aria-hidden="true">
                  {(preview.inviter_name || '?').slice(0, 1).toUpperCase()}
                </span>
                <span data-testid="invite-from">
                  {preview.inviter_name ? t('invite.v1.from', { name: preview.inviter_name }) : t('invite.v1.fromNobody')}
                </span>
              </div>
            )}
            <h1 className="max-w-[9em] text-[32px] leading-[1.05] font-extrabold tracking-[-0.02em] relative z-[1]" data-testid="invite-event">
              {preview ? `«${preview.event_name}»` : view.kind === 'need-auth' ? t('invite.needAuthTitle') : t('invite.confirmTitle')}
            </h1>
            {preview && (
              <p className="mt-2 text-[17px] text-v1-ink2 relative z-[1]">{t('invite.v1.members', { count: preview.member_count })}</p>
            )}
            <p className="mt-2.5 max-w-[14em] text-[15px] text-v1-ink2 relative z-[1]">
              {view.kind === 'need-auth'
                ? t('invite.needAuthBody')
                : t('invite.confirmBody', { name: profile?.full_name || profile?.email || '' })}
            </p>
            <Art name="trip" className="absolute w-[110px] right-1 -bottom-6 rotate-[8deg] pointer-events-none" />
          </div>
          <Card className="mt-2 flex items-start gap-3 text-[15px] leading-snug">
            <Clock className="w-5 h-5 flex-none" aria-hidden="true" />
            <span data-testid="invite-expiry">{until ? t('invite.v1.until', { date: until }) : t('invite.v1.expiry')}</span>
          </Card>
          <Card className="mt-2 flex items-start gap-3 text-[15px] leading-snug">
            <CheckCircle2 className="w-5 h-5 flex-none" aria-hidden="true" />
            <span>
              <b>{t('invite.v1.after')}</b> {t('invite.v1.afterBody')}
            </span>
          </Card>
          <Card className="mt-2 flex items-start gap-3 text-[15px] leading-snug">
            <Lock className="w-5 h-5 flex-none" aria-hidden="true" />
            <span>{t('invite.v1.hidden')}</span>
          </Card>
        </>
      )}
    </V1Screen>
  );
}
