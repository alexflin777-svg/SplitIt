/**
 * Проверка пароля в локальном режиме (инвариант И-1).
 *
 * Когда Supabase не настроен, единственная альтернатива — либо не проверять
 * пароль вообще (что и было: signInUser игнорировал аргумент password и пускал
 * кого угодно под любым email), либо проверять его локально. Второе честнее.
 *
 * Это НЕ замена серверной авторизации. Локальная проверка защищает ровно от
 * одного сценария: другой человек за тем же устройством вводит чужой email и
 * произвольный пароль. От того, кто может редактировать localStorage напрямую,
 * она не защищает и не может — на клиенте секрета нет. Настоящая проверка
 * появляется вместе с настроенным Supabase.
 *
 * Пароль в открытом виде не хранится никогда: в реестр уходит только соль и
 * SHA-256 от соли с паролем.
 */

const ITERATIONS_NOTE = 'SHA-256(salt + password), локальный режим';

export interface StoredCredential {
  salt: string;
  hash: string;
  algo: typeof ITERATIONS_NOTE;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function digest(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export async function createCredential(password: string): Promise<StoredCredential> {
  const salt = randomSalt();
  return { salt, hash: await digest(salt, password), algo: ITERATIONS_NOTE };
}

export async function verifyCredential(
  credential: StoredCredential | undefined,
  password: string,
): Promise<boolean> {
  if (!credential?.salt || !credential?.hash) return false;
  const candidate = await digest(credential.salt, password);
  return timingSafeEqual(candidate, credential.hash);
}

/** Сравнение без раннего выхода — чтобы время ответа не зависело от длины совпадения. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Требования к паролю, общие для локального режима и для Supabase. */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Пароль должен быть не короче 8 символов';
  return null;
}
