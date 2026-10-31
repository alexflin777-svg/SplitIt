'use client';

/** Плитка «наведите камеру» с QR ссылки приглашения (макеты h1-sent, h4-invite). */

import { qrMatrix, qrPath } from '@/lib/qr';
import { useI18n } from '@/lib/i18n/provider';

export default function QrTile({ link, title }: { link: string | null; title: string }) {
  const { t } = useI18n();
  const m = qrMatrix(link);
  return (
    <div className="flex items-center gap-4 mt-2 p-4 rounded-tile bg-v1-accent-soft">
      {m ? (
        <svg
          data-testid="invite-qr"
          role="img"
          aria-label={t('qr.label')}
          // Поле в 4 модуля — по стандарту QR, иначе камера хуже находит код.
          viewBox={`-4 -4 ${m.length + 8} ${m.length + 8}`}
          shapeRendering="crispEdges"
          className="w-[132px] h-[132px] shrink-0 rounded-[18px] bg-white"
        >
          <path d={qrPath(m)} fill="#111" />
        </svg>
      ) : (
        <p data-testid="invite-qr-missing" className="w-[132px] shrink-0 text-[14px] text-v1-ink2">
          {t('qr.missing')}
        </p>
      )}
      <div className="min-w-0">
        <h2 className="text-[20px] leading-tight font-extrabold tracking-[-0.02em]">{title}</h2>
        <p className="mt-1 text-[15px] text-v1-ink2">{t('qr.hint')}</p>
      </div>
    </div>
  );
}
