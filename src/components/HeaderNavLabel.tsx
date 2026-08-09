'use client';

import { useI18n } from '@/lib/i18n/provider';

/**
 * Small client component so the (server) RootLayout doesn't need
 * 'use client' just to translate two header strings and sync
 * <html lang>. Keeps SSR/export markup stable for hydration.
 */
export default function HeaderNavLabel() {
  const { t, locale } = useI18n();

  // Keep <html lang> in sync with the active locale for accessibility/SEO;
  // harmless no-op during export/SSR since document isn't available there.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }

  return <>{t('nav.newEvent')}</>;
}
