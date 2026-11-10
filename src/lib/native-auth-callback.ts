import type { SupabaseClient } from '@supabase/supabase-js';
import { ownAuthCallback, takeReturnPath } from './auth-return';
import { acceptAuthCallback, cancelAuthAttempt } from './auth-attempt';
import { t } from './i18n/t';

/**
 * Обработчик deep link `app.splitit.mobile://auth/callback` (Google OAuth и
 * Telegram-мост). Без Capacitor и роутера — их передаёт useNativeAuthCallback,
 * поэтому тест вызывает ровно этот код.
 */
export interface NativeAuthDeps {
  auth: Pick<SupabaseClient['auth'], 'verifyOtp' | 'exchangeCodeForSession'>;
  replace: (path: string) => void;
  closeBrowser: () => Promise<void>;
  activeSession: () => Promise<unknown>;
}

const toAuthError = (deps: NativeAuthDeps, message: string) => deps.replace(`/auth?oauth_error=${encodeURIComponent(message)}`);

export async function handleNativeAuthUrl(url: string, deps: NativeAuthDeps): Promise<void> {
  const params = ownAuthCallback(url);
  if (!params) return;

  await deps.closeBrowser();

  // Ветка Telegram: браузерная страница /auth/telegram-native вернула
  // одноразовый token_hash — обмениваем его на сессию прямо здесь.
  const tgTokenHash = params.get('tg_token_hash');
  if (tgTokenHash) {
    const attempt = params.get('attempt');
    // Чужая ссылка с токеном атакующего подменила бы аккаунт: только своя свежая попытка.
    // Проверка синхронная и гасит попытку — из двух одновременных callback принят один.
    if (!acceptAuthCallback('telegram', attempt)) {
      console.warn('[SplitIT] Telegram: callback без начатой на устройстве попытки входа отклонён');
      // Без attempt — страница моста старше приложения: честно, без подмены входа.
      toAuthError(deps, t(attempt === null ? 'auth.telegramBridgeOutdated' : 'auth.callbackRejected'));
      return;
    }
    const { error } = await deps.auth.verifyOtp({ type: 'magiclink', token_hash: tgTokenHash });
    if (error) {
      console.warn('[SplitIT] Telegram: token_hash не обменялся на сессию', error.message);
      toAuthError(deps, error.message);
      return;
    }
    if (await deps.activeSession()) deps.replace(takeReturnPath('/friends'));
    return;
  }

  const oauthError = params.get('error_description') || params.get('error');
  if (oauthError) {
    // Отменённый вход: попытка не должна оставаться пригодной до истечения срока.
    cancelAuthAttempt();
    toAuthError(deps, oauthError);
    return;
  }

  const code = params.get('code');
  if (!code) return;
  // Код меняется на сессию по PKCE-verifier этого устройства; плюс — только из начатого входа.
  if (!acceptAuthCallback('google', null)) {
    console.warn('[SplitIT] Google: callback без начатой на устройстве попытки входа отклонён');
    toAuthError(deps, t('auth.callbackRejected'));
    return;
  }

  const { error } = await deps.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn('[SplitIT] Не удалось обменять код авторизации на сессию', error.message);
    toAuthError(deps, error.message);
    return;
  }

  // Приглашение, запомненное до ухода в системный браузер, — туда; иначе как раньше.
  if (await deps.activeSession()) deps.replace(takeReturnPath('/friends'));
}
