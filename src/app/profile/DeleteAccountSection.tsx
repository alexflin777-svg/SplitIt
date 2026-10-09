'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteAccount } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n/provider';

/**
 * Удаление аккаунта. Подтверждение — ввод своего email: случайное нажатие
 * не должно стирать данные. Кнопка неактивна, пока ввод не совпал.
 */
export default function DeleteAccountSection({ email }: { email: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = email.trim().toLowerCase();
  const matches = expected.length > 0 && confirmation.trim().toLowerCase() === expected;

  const handleDelete = async () => {
    if (!matches || deleting) return;
    setDeleting(true);
    setError(null);
    const { error: deleteError } = await deleteAccount();
    if (deleteError) {
      setDeleting(false);
      setError(deleteError);
      return;
    }
    router.push('/auth?mode=login');
  };

  return (
    <section
      data-testid="delete-account"
      className="stitch-card p-5 space-y-3 border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-800"
    >
      <h3 className="flex items-center gap-2 text-sm font-extrabold text-rose-700 dark:text-rose-400">
        <Trash2 className="w-4 h-4" aria-hidden="true" />
        {t('profile.deleteAccount.title')}
      </h3>
      <p className="text-xs text-slate-600 dark:text-slate-300">{t('profile.deleteAccount.body')}</p>
      <label className="block space-y-1">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
          {t('profile.deleteAccount.confirmLabel', { email })}
        </span>
        <input
          type="email"
          autoComplete="off"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={email}
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
        />
      </label>
      {error && (
        <p role="alert" data-testid="delete-account-error" className="text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={!matches || deleting}
        className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed text-white font-extrabold text-sm transition-all"
      >
        {deleting ? t('profile.deleteAccount.deleting') : t('profile.deleteAccount.button')}
      </button>
      <Link href="/delete-account" className="block text-center text-[11px] font-semibold text-slate-500 underline">
        {t('profile.deleteAccount.moreInfo')}
      </Link>
    </section>
  );
}
