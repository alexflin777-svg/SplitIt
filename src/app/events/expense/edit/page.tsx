'use client';

import EventRoute from '../../_components/EventRoute';
import EditExpenseClient from './EditExpenseClient';

export default function Page() {
  return (
    <EventRoute needsExpenseId>
      {({ groupId, expenseId }) => <EditExpenseClient groupId={groupId} expenseId={expenseId} />}
    </EventRoute>
  );
}
