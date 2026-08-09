'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Loader2, UserPlus } from 'lucide-react';
import { redeemInvite, isMultiUser } from '@/lib/store';
import { getActiveSession, UserProfile } from '@/lib/supabase';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';

type State =
  | { kind: 'loading' }
  | { kind: 'need-auth' }
  | { kind: 'confirm' }
  | { kind: 'joining' }
  | { kind: 'error'; message: string };

/**
 * Экран вступления по приглашению.
 *
 * Вступление никогда не происходит само: пользователь видит, во что его
 * зовут, и нажимает кнопку. Прошлая версия дописывала человека в участники
 * при открытии любой ссылки на событие.
 *
 * Код проверяет база — функция `redeem_group_invite`. Клиент не может ни
 * подсмотреть чужой код, ни вписать себя в группу напрямую.
 */
export default function InviteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const { t } = useI18n();

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!code) {
      setState({ kind: 'error', message: t('invite.errorNoCode') });
      return;
    }
    if (!isMultiUser()) {
      setState({
        kind: 'error',
        message: t('invite.errorLocalOnly'),
      });
      return;
    }

    getActiveSession().then((session) => {
      setProfile(session);
      setState(session ? { kind: 'confirm' } : { kind: 'need-auth' });
    });
  }, [code, t]);

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

  return (
    <div className="max-w-md mx-auto px-1 pb-24 pt-6">
      <div className="stitch-card p-6 text-center space-y-4 bg-white dark:bg-slate-800">
        {state.kind === 'loading' && (
          <>
            <Loader2 className="w-7 h-7 mx-auto text-slate-400 animate-spin" aria-hidden="true" />
            <p className="text-sm text-slate-500">{t('invite.loading')}</p>
          </>
        )}

        {state.kind === 'need-auth' && (
          <>
            <UserPlus className="w-8 h-8 mx-auto text-blue-600" aria-hidden="true" />
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">{t('invite.needAuthTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('invite.needAuthBody')}
            </p>
            <Link
              href={`${routes.auth()}?mode=login&next=${encodeURIComponent(routes.invite(code ?? ''))}`}
              className="inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all duration-300 hover:bg-blue-700"
            >
              {t('invite.signInButton')}
            </Link>
          </>
        )}

        {(state.kind === 'confirm' || state.kind === 'joining') && (
          <>
            <UserPlus className="w-8 h-8 mx-auto text-blue-600" aria-hidden="true" />
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">{t('invite.confirmTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('invite.confirmBody', { name: profile?.full_name || profile?.email || '' })}
            </p>
            <button
              type="button"
              onClick={handleJoin}
              disabled={state.kind === 'joining'}
              className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all duration-300 hover:bg-blue-700 disabled:opacity-60"
            >
              {state.kind === 'joining' ? t('invite.joiningButton') : t('invite.joinButton')}
            </button>
          </>
        )}

        {state.kind === 'error' && (
          <div role="alert" data-testid="invite-error" className="space-y-3">
            <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">{t('invite.errorTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{state.message}</p>
            <Link
              href={routes.home()}
              className="inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all duration-300 hover:bg-blue-700"
            >
              {t('invite.backToEvents')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
