'use client';

/**
 * Форма обратной связи. Доступна без входа: отзыв уходит через RPC
 * submit_feedback (SECURITY DEFINER), прямой записи в таблицу у клиента нет.
 * Ошибка не маскируется под успех — инвариант проекта.
 */
import { useState } from 'react';
import Link from 'next/link';
import { submitFeedback } from '@/lib/store';
import { Activity, Send, CheckCircle2 } from 'lucide-react';

const CATEGORIES = [
  { value: 'idea', label: 'Идея / предложение' },
  { value: 'bug', label: 'Что-то не работает' },
  { value: 'praise', label: 'Хочу похвалить' },
  { value: 'other', label: 'Другое' },
] as const;

type Category = (typeof CATEGORIES)[number]['value'];

export default function FeedbackPage() {
  const [category, setCategory] = useState<Category>('idea');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < 3) {
      setStatus('error');
      setErrorMsg('Напишите хотя бы пару слов — иначе нам нечего прочитать.');
      return;
    }
    setStatus('loading');
    const { error } = await submitFeedback({
      category,
      message: trimmed,
      contact: contact.trim() || undefined,
      source: 'web',
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
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Спасибо!</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Отзыв получен. Мы читаем всё — именно так SplitIT и становится лучше.
        </p>
        <Link href="/" className="inline-block text-sm font-bold text-emerald-600 underline">
          ← На главную
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10 pb-28 space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
          Отзывы и предложения
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Расскажите, чего не хватает или что понравилось. Можно анонимно.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition-all ${
                category === c.value
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Ваше сообщение…"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />

        <input
          type="text"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={320}
          placeholder="Контакт для ответа (необязательно)"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />

        {status === 'error' && (
          <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={status === 'loading'}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white shadow-md shadow-blue-500/30 transition-all hover:bg-blue-700 disabled:opacity-70"
        >
          {status === 'loading' ? (
            <Activity className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Отправить
        </button>
      </form>
    </main>
  );
}
