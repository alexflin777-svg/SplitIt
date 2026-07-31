/**
 * Проверка конфигурации окружения (инвариант И-3).
 *
 * Раньше в createClient стояли дефолты 'https://placeholder-splitit.supabase.co'
 * и 'placeholder-anon-key-splitit'. Из-за них отсутствие бэкенда выглядело как
 * рабочее приложение: клиент создавался, запросы уходили в несуществующий домен,
 * ошибки глушились пустым catch. Плейсхолдеры уехали в собранные APK и IPA.
 *
 * Теперь дефолтов нет. Приложение либо знает про настоящий Supabase, либо честно
 * сообщает, что работает в локальном режиме без бэкенда.
 */

const RAW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const RAW_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Признаки незаполненного значения, которые встречались в этом проекте. */
function looksUnset(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || v.includes('placeholder') || v.includes('your-') || v.includes('<') || v === 'todo';
}

export const SUPABASE_URL = looksUnset(RAW_URL) ? '' : RAW_URL.trim();
export const SUPABASE_ANON_KEY = looksUnset(RAW_ANON_KEY) ? '' : RAW_ANON_KEY.trim();

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
}

/**
 * Адрес манифеста обновлений. Пусто — канал обновлений не настроен, и
 * приложение так и говорит вместо выдуманной версии.
 */
const RAW_UPDATE_MANIFEST_URL = process.env.NEXT_PUBLIC_UPDATE_MANIFEST_URL ?? '';
export const UPDATE_MANIFEST_URL = looksUnset(RAW_UPDATE_MANIFEST_URL) ? '' : RAW_UPDATE_MANIFEST_URL.trim();

/**
 * Человекочитаемое описание проблемы конфигурации, либо null.
 * Показывается в интерфейсе — молчаливая деградация запрещена.
 */
export function getConfigProblem(): string | null {
  if (isSupabaseConfigured()) return null;

  const missing: string[] = [];
  if (SUPABASE_URL === '') missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (SUPABASE_ANON_KEY === '') missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return `Не настроен бэкенд: ${missing.join(', ')}. Приложение работает локально на этом устройстве — синхронизация между устройствами и восстановление пароля по email недоступны.`;
}

let warned = false;

/** Однократное предупреждение в консоль при старте. */
export function warnIfMisconfigured(): void {
  if (warned || typeof window === 'undefined') return;
  const problem = getConfigProblem();
  if (problem) {
    warned = true;
    console.warn(`[SplitIT] ${problem}`);
  }
}
