'use client';

import { Fragment, useEffect, useSyncExternalStore } from 'react';
import { authScope, authUserChanged, onAuthUserChanged } from '@/lib/snapshot';
import { getLocalSession } from '@/lib/supabase';

/**
 * Смена аккаунта без перезагрузки (выход, вход другого, удаление, другая вкладка):
 * экраны монтируются заново — состояние прежнего аккаунта (главная, событие,
 * проект) пропадает сразу; кэш событий очищает data-hooks.ts (SWR не тянется в стартовый JS).
 */
export function AuthScope({ children }: { children: React.ReactNode }) {
  const gen = useSyncExternalStore(onAuthUserChanged, authScope, () => 0);

  // Вход другого аккаунта в соседней вкладке: в этой saveLocalSession не вызывался.
  useEffect(() => {
    let uid = getLocalSession()?.id ?? null;
    const track = () => {
      uid = getLocalSession()?.id ?? null;
    };
    const fromOtherTab = () => {
      const was = uid;
      track();
      if (uid !== was) authUserChanged(!!was);
    };
    window.addEventListener('storage', fromOtherTab);
    window.addEventListener('splitit_profile_changed', track);
    return () => {
      window.removeEventListener('storage', fromOtherTab);
      window.removeEventListener('splitit_profile_changed', track);
    };
  }, []);

  return <Fragment key={gen}>{children}</Fragment>;
}
