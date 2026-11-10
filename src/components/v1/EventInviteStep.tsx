'use client';

/**
 * «Позови друзей» сразу после создания события (макет h4-invite; SCENARIOS-AUDIT
 * §4 п. 5). Одна ссылка на событие: существующая показывается снова, новая
 * выпускается только если действующей нет. Срок ставит база: пока событие
 * открыто и 30 дней после закрытия (20261101000100).
 */

import { useEffect, useState } from 'react';
import { Copy, Send, Link2Off } from 'lucide-react';
import { createInvite, disableInvite, getActiveInvite, isMultiUser } from '@/lib/store';
import type { Group } from '@/lib/store';
import { absoluteInviteLink } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { Art, Avatar, BlockHead, Header, MainButton, PillLink, Plaque, Row, Skeleton, TopNav, V1Screen } from './ui';
import QrTile from './QrTile';

export default function EventInviteStep({ group, isOwner, onDone }: { group: Group; isOwner: boolean; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [invite, setInvite] = useState<{ code: string; expiresAt: string | null } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getActiveInvite(group.id).then(async (r) => {
      if (!alive) return;
      if (r.error) return setError(r.error);
      if (r.data) return setInvite(r.data);
      const made = await createInvite(group.id);
      if (!alive) return;
      if (!made.data) return setError(made.error);
      // Срок новой ссылки знает только база — перечитываем строку.
      const fresh = await getActiveInvite(group.id);
      if (!alive) return;
      if (fresh.data) setInvite(fresh.data);
      else setError(fresh.error ?? t('eventDetail.errorCreateInviteFailed'));
    });
    return () => {
      alive = false;
    };
  }, [group.id, t]);

  const link = invite ? absoluteInviteLink(invite.code) : null;
  const guests = (group.members ?? []).filter((m) => m.isGuest || (!isMultiUser() && m.id !== group.createdBy && m.role !== 'owner'));
  const shareText = t('eventDetail.inviteShareText', { name: group.name });
  const until = invite?.expiresAt ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(new Date(invite.expiresAt)) : null;

  return (
    <V1Screen
      testId="event-invite-step"
      dock={
        <MainButton
          testId="event-invite-telegram"
          disabled={!link}
          onClick={() => link && window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')}
        >
          <Send className="w-5 h-5" aria-hidden="true" />
          {t('invite.p.telegram')}
        </MainButton>
      }
    >
      <TopNav onBack={onDone} close right={<PillLink onClick={onDone}>{t('eventInvite.later')}</PillLink>} />
      <Header title={t('eventInvite.title')} sub={t('eventInvite.sub')} />
      <div className="relative overflow-hidden isolate rounded-tile bg-v1-trip px-5 py-4 mb-2">
        <h2 className="text-[24px] leading-tight font-extrabold tracking-[-0.02em] relative z-[1]">«{group.name}»</h2>
        <p className="mt-1 text-[15px] text-v1-ink2 relative z-[1]">{t('eventInvite.tileBody')}</p>
        <Art name="trip" className="absolute w-[70px] right-3 -bottom-3 rotate-[8deg] pointer-events-none" />
      </div>
      {error && (
        <Plaque kind="err" testId="event-invite-error">
          {error}
        </Plaque>
      )}
      {notice && <Plaque kind="ok">{notice}</Plaque>}
      {invite === undefined && !error && <Skeleton rows={1} />}
      {invite === null && !error && <Plaque kind="info">{t('invite.p.disabled')}</Plaque>}
      {invite && (
        <>
          <QrTile link={link} title={t('qr.friendsNear')} />
          <div className="flex items-center gap-3 mt-2 pl-[18px] pr-2.5 py-2.5 rounded-card bg-v1-card">
            <span className="flex-1 min-w-0 truncate text-base font-semibold" data-testid="event-invite-link">
              {link ?? t('eventDetail.noPublicUrlError')}
            </span>
            <button
              type="button"
              disabled={!link}
              aria-label={t('invite.p.copy')}
              onClick={() =>
                link &&
                navigator.clipboard.writeText(link).then(
                  () => setNotice(t('invite.p.copied')),
                  (e: Error) => setError(t('invite.p.copyFailed', { error: e.message })),
                )
              }
              className="w-11 h-11 rounded-full bg-v1-fill grid place-items-center disabled:opacity-50"
            >
              <Copy className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 px-4 py-3 rounded-card bg-v1-card text-[15px] leading-snug">
            {until ? t('eventInvite.until', { date: until }) : t('eventInvite.noExpiry')}
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() =>
                void disableInvite(group.id, invite.code).then((r) => (r.error ? setError(r.error) : setInvite(null)))
              }
              className="mt-2 h-11 px-4 rounded-full bg-v1-card font-bold text-[15px] inline-flex items-center gap-1.5"
            >
              <Link2Off className="w-[18px] h-[18px]" aria-hidden="true" />
              {t('invite.p.disable')}
            </button>
          )}
        </>
      )}
      {guests.length > 0 && (
        <>
          <BlockHead title={t('invite.p.noAccount')} right={t('home.v1.people', { count: guests.length })} />
          <div className="flex flex-col gap-1.5">
            {guests.map((m, i) => (
              <Row key={m.id} left={<Avatar name={m.name} index={i + 1} />} title={m.name} meta={t('invite.p.byName')} />
            ))}
          </div>
        </>
      )}
    </V1Screen>
  );
}
