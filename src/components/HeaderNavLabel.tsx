'use client';

import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n/provider';

/**
 * Small client component so the (server) RootLayout doesn't need
 * 'use client' just to translate two header strings and sync
 * <html lang>. Keeps SSR/export markup stable for hydration.
 */
export default function HeaderNavLabel() {
  const { t, locale } = useI18n();

  // Keep <html lang> in sync with the active locale for accessibility/SEO.
  // Раньше присваивание стояло прямо в теле компонента — это побочный эффект
  // во время рендера: он выполняется при каждом рендере, в том числе
  // прерванном, и ломает гидратацию статического экспорта.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <>{t('nav.newEvent')}</>;
}
