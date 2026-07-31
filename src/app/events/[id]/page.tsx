import EventDetailClient from './EventDetailClient';

export function generateStaticParams() {
  return [
    { id: 'group-1' },
    { id: 'group-2' },
    { id: 'group-sochi-2026' },
  ];
}

export default function EventPage({ params }: { params: { id: string } }) {
  return <EventDetailClient groupId={params?.id || 'group-sochi-2026'} />;
}
