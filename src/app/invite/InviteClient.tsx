'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Lock, LogIn, Mail } from 'lucide-react';
import { redeemInvite, isMultiUser } from '@/lib/store';
import { getActiveSession, signInWithGoogle, UserProfile } from '@/lib/supabase';
import { rememberReturnPath } from '@/lib/auth-return';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Card, MainButton, Plaque, SecondButton, Skeleton, V1Screen } from '@/components/v1/ui';

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
 * Название события, имя пригласившего и срок до входа показать нечем: группа и
 * код закрыты RLS, функции «посмотреть приглашение» для событий в базе нет
 * (нужна миграция, SCENARIOS-AUDIT §4 п. 2). Показываем то, что известно точно.
 *
 * Адрес возврата запоминается до ухода на вход: Google и Telegram уводят со
 * страницы, и ?next= теряется (SCENARIOS-AUDIT §4 п. 1).
 */
export default function InviteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const { t } = useI18n();

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Ошибки, известные без сети, вычисляются при рендере, а не ставятся из
  // эффекта (P1-6): нет кода в ссылке или приложение собрано без бэкенда.
  const staticError = !code
    ? t('invite.errorNoCode')
    : !isMultiUser()
      ? t('invite.errorLocalOnly')
      : null;

  useEffect(() => {
    if (staticError) return;
    getActiveSession().then((session) => {
      setProfile(session);
      setState(session ? { kind: 'confirm' } : { kind: 'need-auth' });
    });
  }, [staticError]);

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
    router.push(routes.eventDetail(groupId));
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
          <div className="relative overflow-hidden isolate rounded-tile px-5 pt-5 pb-6 min-h-[200px] bg-v1-trip">
            <h1 className="max-w-[9em] text-[32px] leading-[1.05] font-extrabold tracking-[-0.02em] relative z-[1]">
              {view.kind === 'need-auth' ? t('invite.needAuthTitle') : t('invite.confirmTitle')}
            </h1>
            <p className="mt-2.5 max-w-[14em] text-[15px] text-v1-ink2 relative z-[1]">
              {view.kind === 'need-auth'
                ? t('invite.needAuthBody')
                : t('invite.confirmBody', { name: profile?.full_name || profile?.email || '' })}
            </p>
            <img src="/v1/trip.png" alt="" className="absolute w-[110px] right-1 -bottom-6 rotate-[8deg] pointer-events-none" />
          </div>
          <Card className="mt-2 flex items-start gap-3 text-[15px] leading-snug">
            <Clock className="w-5 h-5 flex-none" aria-hidden="true" />
            <span>{t('invite.v1.expiry')}</span>
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
