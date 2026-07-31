'use client';

import EventRoute from '../../_components/EventRoute';
import NewExpenseClient from './NewExpenseClient';

export default function Page() {
  return <EventRoute>{({ groupId }) => <NewExpenseClient groupId={groupId} />}</EventRoute>;
}
