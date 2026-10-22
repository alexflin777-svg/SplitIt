'use client';

import { useState } from 'react';
import { avatarGlyph, isPhotoAvatar } from '@/lib/avatar';

/**
 * Аватар участника внутри готового контейнера: фото — картинкой по размеру
 * контейнера, эмодзи — текстом, остальное — нейтральным значком (см. avatarGlyph).
 * Битое фото тоже заменяется значком, а не иконкой «сломанной картинки».
 * Ошибка запоминается для конкретного источника: если участник сменил битое
 * фото на исправное, новое фото показывается без перемонтирования.
 * alt пустой: имя участника всегда выведено рядом.
 */
export default function MemberAvatar({ avatar }: { avatar: string | null | undefined }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (isPhotoAvatar(avatar) && avatar !== failedSrc) {
    return (
      <img
        src={avatar}
        alt=""
        data-testid="member-avatar-photo"
        onError={() => setFailedSrc(avatar)}
        className="w-full h-full rounded-[inherit] object-cover"
      />
    );
  }
  return <>{avatarGlyph(avatar)}</>;
}
