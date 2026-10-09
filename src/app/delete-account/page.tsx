'use client';

/**
 * Публичная страница удаления аккаунта — требование Google Play (Data safety):
 * ссылка, по которой можно запросить удаление, не устанавливая приложение.
 *
 * Два пути: в приложении (Профиль → Удалить аккаунт — удаление сразу) и
 * заявка отсюда через RPC submit_feedback (доступна без входа, ограничена по
 * частоте). Ошибка отправки не маскируется под успех.
 */
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { submitFeedback } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function DeleteAccountPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const contact = email.trim();
    if (!EMAIL_RE.test(contact) || contact.length > 320) {
      setStatus('error');
      setErrorMsg(t('deleteAccountPage.invalidEmail'));
      return;
    }
    setStatus('loading');
    const note = comment.trim().slice(0, 1800);
    const { error } = await submitFeedback({
      category: 'other',
      message: `[delete-account] ${note || '—'}`,
      contact,
      source: 'delete-account',
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error);
      return;
    }
    setStatus('success');
  };

  if (status === 'success') {
    return (
      <main className="mx-auto max-w-md px-4 py-16 pb-28 text-center space-y-4">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden="true" />
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">{t('deleteAccountPage.successTitle')}</h1>
        <p data-testid="delete-request-success" className="text-sm text-slate-600 dark:text-slate-300">
          {t('deleteAccountPage.successBody')}
        </p>
        <Link href="/" className="inline-block text-sm font-bold text-blue-600 underline">
          {t('deleteAccountPage.backHome')}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10 pb-28 space-y-5">
      <div className="space-y-1.5">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
          <Trash2 className="w-5 h-5 text-rose-600" aria-hidden="true" />
          {t('deleteAccountPage.title')}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('deleteAccountPage.intro')}</p>
      </div>

      <section className="stitch-card p-4 space-y-2 bg-white dark:bg-slate-800">
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('deleteAccountPage.inAppTitle')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('deleteAccountPage.inAppSteps')}</p>
      </section>

      <section className="stitch-card p-4 space-y-2 bg-white dark:bg-slate-800">
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('deleteAccountPage.whatTitle')}</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <li>{t('deleteAccountPage.whatDeleted')}</li>
          <li>{t('deleteAccountPage.whatAnonymized')}</li>
          <li>{t('deleteAccountPage.whatTiming')}</li>
        </ul>
      </section>

      <form onSubmit={handleSubmit} className="stitch-card p-4 space-y-3 bg-white dark:bg-slate-800">
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('deleteAccountPage.formTitle')}</h2>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{t('deleteAccountPage.emailLabel')}</span>
          <input
            type="email"
            required
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{t('deleteAccountPage.commentLabel')}</span>
          <textarea
            rows={3}
            maxLength={1800}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
          />
        </label>
        {status === 'error' && (
          <p role="alert" data-testid="delete-request-error" className="text-xs font-semibold text-rose-700">
            {errorMsg}
          </p>
        )}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-extrabold text-sm"
        >
          {status === 'loading' ? t('deleteAccountPage.sending') : t('deleteAccountPage.submit')}
        </button>
      </form>
    </main>
  );
}
