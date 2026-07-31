'use client';

import { Suspense } from 'react';
import InviteClient from './InviteClient';

export default function Page() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-xs font-bold text-slate-400">Загрузка…</div>}
    >
      <InviteClient />
    </Suspense>
  );
}
