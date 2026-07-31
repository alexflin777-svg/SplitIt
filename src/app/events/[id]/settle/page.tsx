import SettleUpClient from './SettleUpClient';

export function generateStaticParams() {
  return [{ id: 'group-1' }, { id: 'group-2' }];
}

export default function SettleUpPage({ params }: { params: { id: string } }) {
  return <SettleUpClient groupId={params.id} />;
}
