'use client';

import EventRoute from '../_components/EventRoute';
import EventBalanceClient from './EventBalanceClient';

export default function Page() {
  return <EventRoute>{({ groupId }) => <EventBalanceClient groupId={groupId} />}</EventRoute>;
}
