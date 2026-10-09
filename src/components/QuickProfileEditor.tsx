'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, X } from 'lucide-react';
import type { UserProfile } from '@/lib/supabase';
import { saveProfile } from '@/lib/store';
import { PRESET_AVATARS, isPhotoAvatar, processAvatarFile } from '@/lib/avatar';
import { useI18n } from '@/lib/i18n/provider';

interface Props {
  user: UserProfile;
  onClose: () => void;
  /** Вызывается только после успешной записи профиля. */
  onSaved: (updated: UserProfile) => void;
}

/**
 * Быстрый редактор имени и аватара с главной (F3).
 *
 * Аватар сохраняется сразу после выбора (F4): раньше фото применялось только
 * по кнопке «Сохранить» в профиле, и её легко было не нажать — в базе
 * оставался '👤'. Ошибка записи показывается, а не прячется.
 */
export default function QuickProfileEditor({ user, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(user.full_name);
  // 'processing' — фото сжимается, 'saving' — идёт запись. Пока занято, все
  // элементы выключены и шторку нельзя закрыть: иначе вторая запись строилась
  // бы из устаревшего user и затирала первую, а ошибка терялась бы с закрытием.
  const [status, setStatus] = useState<'idle' | 'processing' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const avatar = user.avatar_url || '👤';
  const busy = status === 'processing' || status === 'saving';
  // Защита от двойного нажатия в одном тике: state обновится только после рендера.
  const inFlight = useRef(false);
  // Последний сохранённый профиль: persist не должен опираться на user из рендера.
  const latestUser = useRef(user);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    latestUser.current = user;
  }, [user]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Фокус внутрь шторки при открытии и обратно на кнопку-аватар при закрытии;
  // Tab не уходит на страницу под шторкой.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onClose();
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  const close = () => {
    if (!busy) onClose();
  };

  const persist = async (patch: Partial<UserProfile>) => {
    setStatus('saving');
    setError(null);
    const updated: UserProfile = { ...latestUser.current, ...patch };
    const { error: saveError } = await saveProfile(updated);
    if (saveError) {
      setStatus('idle');
      setError(t('quickProfile.saveFailed', { error: saveError }));
      return;
    }
    latestUser.current = updated;
    setStatus('saved');
    onSaved(updated);
  };

  const run = async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await task();
    } finally {
      inFlight.current = false;
    }
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    return run(async () => {
      setStatus('processing');
      setError(null);
      const { dataUrl, error: processError } = await processAvatarFile(file);
      if (processError || !dataUrl) {
        setStatus('idle');
        setError(processError ?? t('quickProfile.processError'));
        return;
      }
      await persist({ avatar_url: dataUrl });
    });
  };

  const handleName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('quickProfile.nameRequired'));
      return;
    }
    return run(() => persist({ full_name: trimmed }));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-profile-title"
        data-testid="quick-profile-editor"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-800 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 id="quick-profile-title" className="text-base font-extrabold text-slate-900 dark:text-white">
            {t('quickProfile.title')}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label={t('quickProfile.close')}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-3xl overflow-hidden flex-shrink-0">
            {isPhotoAvatar(avatar) ? (
              <img src={avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{avatar}</span>
            )}
          </div>
          <div className="text-xs font-bold min-h-[1.25rem]" aria-live="polite">
            {busy && (
              <span className="flex items-center gap-1.5 text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('quickProfile.saving')}
              </span>
            )}
            {status === 'saved' && (
              <span className="flex items-center gap-1.5 text-emerald-600" data-testid="quick-profile-saved">
                <Check className="w-3.5 h-3.5" />
                {t('quickProfile.saved')}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">{t('quickProfile.avatarLabel')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_AVATARS.map((av) => (
              <button
                key={av}
                type="button"
                disabled={busy}
                aria-pressed={avatar === av}
                onClick={() => run(() => persist({ avatar_url: av }))}
                className={`w-10 h-10 rounded-xl border flex items-center justify-center text-lg transition-all disabled:opacity-50 ${
                  avatar === av
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/50 ring-2 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50'
                }`}
              >
                {av}
              </button>
            ))}
            <label
              className={`w-10 h-10 rounded-xl border border-dashed border-blue-400 bg-blue-50/50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 cursor-pointer focus-within:ring-2 focus-within:ring-blue-500/50 ${
                busy ? 'opacity-50 pointer-events-none' : 'hover:bg-blue-100/50'
              }`}
              title={t('quickProfile.uploadPhoto')}
            >
              <Camera className="w-4 h-4" />
              <span className="sr-only">{t('quickProfile.uploadPhoto')}</span>
              <input type="file" accept="image/*" onChange={handlePhoto} disabled={busy} className="sr-only" />
            </label>
          </div>
        </div>

        <form onSubmit={handleName} className="space-y-1.5">
          <label htmlFor="quick-profile-name" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
            {t('quickProfile.nameLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id="quick-profile-name"
              type="text"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                if (status === 'saved') setStatus('idle');
              }}
              className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              type="submit"
              disabled={busy || name.trim() === user.full_name}
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50"
            >
              {t('quickProfile.saveName')}
            </button>
          </div>
        </form>

        {error && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
