import EditExpenseClient from './EditExpenseClient';

export function generateStaticParams() {
  return [
    { id: 'group-1', expenseId: 'exp-1' },
    { id: 'group-2', expenseId: 'exp-2' },
    { id: 'group-sochi-2026', expenseId: 'exp-1' },
  ];
}

export default function EditExpensePage({ params }: { params: { id: string; expenseId: string } }) {
  return <EditExpenseClient groupId={params?.id || 'group-sochi-2026'} expenseId={params?.expenseId || 'exp-1'} />;
}
