/**
 * Проверка обновлений приложения.
 *
 * Прошлая редакция была симуляцией и врала пользователю: `checkForAppUpdates`
 * возвращала зашитую в код версию `v2.4.0-OTA`, а `applyInAppOTAUpdate` крутила
 * прогресс на таймерах, записывала строку версии в localStorage и рапортовала
 * «Приложение успешно обновлено. Все группы, профиль и история расходов
 * сохранены на 100%». Ни bundle, ни manifest, ни checksum при этом не
 * скачивались — не менялось вообще ничего, кроме одного ключа в localStorage.
 *
 * Что здесь теперь. Проверка обращается к настоящему манифесту, адрес которого
 * задаётся переменной NEXT_PUBLIC_UPDATE_MANIFEST_URL. Если переменная не
 * задана — так и говорим: канал обновлений не настроен. Никаких выдуманных
 * версий.
 *
 * Чего здесь намеренно нет — установки обновления. Веб-приложение не может
 * установить само себя, а для Capacitor нужен нативный плагин, которого в
 * зависимостях нет. Поэтому манифест отдаёт ссылку на скачивание, и дальше
 * человек ставит сборку сам. Обещать больше, чем умеем, — ровно тот дефект,
 * который здесь чинится.
 */

import { UPDATE_MANIFEST_URL } from './env';

export const BASE_APP_VERSION = 'v2.3.0';

export function getCurrentInstalledVersion(): string {
  return BASE_APP_VERSION;
}

export type UpdateStatus = 'unconfigured' | 'up-to-date' | 'available' | 'error';

export interface UpdateCheckResult {
  status: UpdateStatus;
  /** Текст для пользователя. Заполнен всегда, включая ошибки. */
  message: string;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotes?: string;
  /** Куда идти за сборкой. Приложение не устанавливает её само. */
  downloadUrl?: string;
  downloadSize?: string;
}

interface UpdateManifest {
  version: string;
  releaseNotes?: string;
  downloadUrl?: string;
  downloadSize?: string;
}

/** Сравнение версий вида v2.10.1 — посегментно, а не лексикографически. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[.-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));

  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    // Числовой сегмент старше буквенного: 2.4.0 новее, чем 2.4.0-beta.
    if (typeof x === 'number' && typeof y === 'string') return 1;
    if (typeof x === 'string' && typeof y === 'number') return -1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function isManifest(value: unknown): value is UpdateManifest {
  return typeof value === 'object' && value !== null && typeof (value as any).version === 'string';
}

export async function checkForAppUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = getCurrentInstalledVersion();

  if (!UPDATE_MANIFEST_URL) {
    return {
      status: 'unconfigured',
      message:
        'Канал обновлений не настроен. Задайте NEXT_PUBLIC_UPDATE_MANIFEST_URL, чтобы приложение проверяло версии.',
      currentVersion,
      latestVersion: null,
    };
  }

  try {
    const response = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) {
      return {
        status: 'error',
        message: `Сервер обновлений ответил ${response.status}. Попробуйте позже.`,
        currentVersion,
        latestVersion: null,
      };
    }

    const payload: unknown = await response.json();
    if (!isManifest(payload)) {
      return {
        status: 'error',
        message: 'Манифест обновлений имеет неожиданный формат.',
        currentVersion,
        latestVersion: null,
      };
    }

    const isNewer = compareVersions(payload.version, currentVersion) > 0;

    return {
      status: isNewer ? 'available' : 'up-to-date',
      message: isNewer
        ? `Доступна версия ${payload.version}. Скачайте и установите её вручную.`
        : 'У вас актуальная версия.',
      currentVersion,
      latestVersion: payload.version,
      releaseNotes: payload.releaseNotes,
      downloadUrl: payload.downloadUrl,
      downloadSize: payload.downloadSize,
    };
  } catch (e: any) {
    return {
      status: 'error',
      message: `Не удалось проверить обновления: ${e?.message ?? 'нет связи с сервером'}`,
      currentVersion,
      latestVersion: null,
    };
  }
}
