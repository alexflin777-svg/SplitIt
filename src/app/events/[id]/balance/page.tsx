import EventBalanceClient from './EventBalanceClient';

export function generateStaticParams() {
  return [
    { id: 'group-1' },
    { id: 'group-2' },
    { id: 'group-sochi-2026' },
  ];
}

export default function EventBalancePage({ params }: { params: { id: string } }) {
  return <EventBalanceClient groupId={params?.id || 'group-sochi-2026'} />;
}
