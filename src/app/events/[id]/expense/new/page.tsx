import NewExpenseClient from './NewExpenseClient';

export function generateStaticParams() {
  return [
    { id: 'group-1' },
    { id: 'group-2' },
    { id: 'group-sochi-2026' },
  ];
}

export default function NewExpensePage({ params }: { params: { id: string } }) {
  return <NewExpenseClient groupId={params?.id || 'group-sochi-2026'} />;
}
