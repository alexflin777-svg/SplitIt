'use client';

/**
 * Позвать участников в проект (макет h1-sent): одна ссылка на проект, «работает,
 * пока проект существует», отключить / выпустить новую; кого ждём на согласие.
 * Ссылка не перевыпускается при каждом открытии экрана.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Copy, Send, Share2, Link2Off, RefreshCw } from 'lucide-react';
import { absoluteProjectInviteLink, routes } from '@/lib/routes';
import { fetchActiveInvite, projects } from '@/lib/projects-client';
import { consentState } from '@/lib/project-ui';
import { shareText } from '@/lib/share';
import { useI18n } from '@/lib/i18n/provider';
import { Avatar, BlockHead, Header, MainButton, Plaque, Row, SecondButton, Skeleton, TopNav, V1Screen } from '@/components/v1/ui';
import { LoadError, RouteShell, memberIndex } from '@/components/v1/project-bits';
import { useProject } from '@/components/v1/useProject';

function Invite() {
  const params = useSearchParams();
  const id = params.get('id');
  const created = params.get('created') === '1';
  const { t } = useI18n();
  const { project, error, reload } = useProject(id);
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void fetchActiveInvite(id).then(async (r) => {
      if (!alive) return;
      if (r.error) return setLinkError(r.error);
      if (r.data) return setCode(r.data);
      // Ссылки ещё нет — выпускаем одну; дальше экран показывает её же.
      const made = await projects.createInvite(id);
      if (!alive) return;
      if (made.data) setCode(made.data);
      else setLinkError(made.error);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!id || !project) {
    return (
      <V1Screen>
        <TopNav back={id ? routes.projectDetail(id) : routes.home()} />
        {!id ? <Plaque kind="err">{t('project.noId')}</Plaque> : error ? <LoadError message={error} onRetry={() => void reload()} /> : <Skeleton rows={3} />}
      </V1Screen>
    );
  }

  const { data, uid } = project;
  const c = consentState(data, uid);
  const link = code ? absoluteProjectInviteLink(code) : null;
  const shown = code ? link ?? routes.projectJoin(code) : '';
  const guests = data.members.filter((m) => m.kind === 'guest' && m.status === 'active');
  const shareMsg = t('invite.p.shareText', { name: data.project.name });

  const reissue = async () => {
    setBusy(true);
    setLinkError(null);
    setNotice(null);
    const made = await projects.createInvite(id);
    setBusy(false);
    if (made.data) setCode(made.data);
    else setLinkError(made.error);
  };
  const disable = async () => {
    if (!code) return;
    setBusy(true);
    setNotice(null);
    const r = await projects.disableInvite(code);
    setBusy(false);
    if (r.error) return setLinkError(r.error);
    setCode(null);
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setNotice(t('invite.p.copied'));
    } catch (e) {
      setLinkError(t('invite.p.copyFailed', { error: (e as Error).message }));
    }
  };

  return (
    <V1Screen
      testId="project-invite"
      dock={
        code && link ? (
          <>
            <MainButton
              testId="invite-telegram"
              onClick={() => window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareMsg)}`, '_blank', 'noopener')}
            >
              <Send className="w-5 h-5" aria-hidden="true" />
              {t('invite.p.telegram')}
            </MainButton>
            <SecondButton
              onClick={() =>
                void shareText(shareMsg, link).then((o) => {
                  if (o === 'copied') setNotice(t('invite.p.copied'));
                  if (o === 'failed') setLinkError(t('invite.p.shareFailed'));
                })
              }
            >
              <Share2 className="w-5 h-5" aria-hidden="true" />
              {t('invite.p.other')}
            </SecondButton>
          </>
        ) : code === null ? (
          <MainButton testId="invite-new" disabled={busy} onClick={() => void reissue()}>
            {t('invite.p.newLink')}
          </MainButton>
        ) : undefined
      }
    >
      <TopNav back={routes.projectDetail(id)} close={created} />
      <Header title={t('invite.p.title')} sub={t('invite.p.sub', { name: data.project.name })} />
      {created && <Plaque kind="ok">{t('invite.p.created')}</Plaque>}
      {linkError && (
        <Plaque kind="err" testId="invite-error">
          {t('invite.p.linkFailed', { error: linkError })}
        </Plaque>
      )}
      {notice && <Plaque kind="ok">{notice}</Plaque>}

      {code === undefined && !linkError && <Skeleton rows={1} />}
      {code === null && <Plaque kind="info">{t('invite.p.disabled')}</Plaque>}
      {code && (
        <>
          <div className="flex items-center gap-3 mt-2 pl-[18px] pr-2.5 py-2.5 rounded-card bg-v1-card">
            <span className="flex-1 min-w-0 truncate text-base font-semibold" data-testid="invite-link" data-code={code}>
              {shown}
            </span>
            <button type="button" onClick={() => void copy()} disabled={!link} aria-label={t('invite.p.copy')} className="w-11 h-11 rounded-full bg-v1-fill grid place-items-center disabled:opacity-50">
              <Copy className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          {!link && <Plaque kind="info">{t('eventDetail.noPublicUrlError')}</Plaque>}
          <div className="mt-2 px-4 py-3 rounded-card bg-v1-card text-[15px] leading-snug">{t('invite.p.expiry')}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void disable()} className="h-11 rounded-full bg-v1-card font-bold text-[15px] inline-flex items-center justify-center gap-1.5" data-testid="invite-disable">
              <Link2Off className="w-[18px] h-[18px]" aria-hidden="true" />
              {t('invite.p.disable')}
            </button>
            <button type="button" disabled={busy} onClick={() => void reissue()} className="h-11 rounded-full bg-v1-card font-bold text-[15px] inline-flex items-center justify-center gap-1.5">
              <RefreshCw className="w-[18px] h-[18px]" aria-hidden="true" />
              {t('invite.p.reissue')}
            </button>
          </div>
        </>
      )}

      {c.waiting.length > 0 && (
        <>
          <BlockHead title={t('invite.p.waiting')} right={String(c.waiting.length)} />
          <div className="flex flex-col gap-1.5">
            {data.members
              .filter((m) => c.waiting.includes(m.display_name))
              .map((m) => (
                <Row key={m.id} left={<Avatar name={m.display_name} index={memberIndex(data, m.id)} />} title={m.display_name} meta={t('invite.p.notYet')} />
              ))}
          </div>
        </>
      )}
      {guests.length > 0 && (
        <>
          <BlockHead title={t('invite.p.noAccount')} right={t('home.v1.people', { count: guests.length })} />
          <div className="flex flex-col gap-1.5">
            {guests.map((m) => (
              <Row key={m.id} left={<Avatar name={m.display_name} index={memberIndex(data, m.id)} />} title={m.display_name} meta={t('invite.p.byName')} />
            ))}
          </div>
        </>
      )}
    </V1Screen>
  );
}

export default function Page() {
  return (
    <RouteShell>
      <Invite />
    </RouteShell>
  );
}
