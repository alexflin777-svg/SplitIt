/**
 * App Auto-Updater & Version Checker for SplitIT
 */

import { sendInAppNotification } from './notifications';

export const CURRENT_APP_VERSION = 'v2.2.0';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
}

export async function checkForAppUpdates(): Promise<UpdateCheckResult> {
  // Simulate checking remote version manifest (or fetching version API)
  await new Promise((res) => setTimeout(res, 800));

  // In production, this compares CURRENT_APP_VERSION with remote package.json / manifest.json
  const latestRemoteVersion = 'v2.2.0'; // up-to-date version

  const hasUpdate = latestRemoteVersion !== CURRENT_APP_VERSION;

  if (hasUpdate) {
    sendInAppNotification(
      'Доступно обновление!',
      `Доступна новая версия SplitIT (${latestRemoteVersion}). Нажмите "Обновить" в настройках.`,
      'update'
    );
  }

  return {
    hasUpdate,
    currentVersion: CURRENT_APP_VERSION,
    latestVersion: latestRemoteVersion,
    releaseNotes: 'Улучшена производительность, обновлен мультивалютный движок и экспорт в PDF.',
  };
}
