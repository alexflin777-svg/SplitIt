'use client';

import EventRoute from '../_components/EventRoute';
import SettleUpClient from './SettleUpClient';

export default function Page() {
  return <EventRoute>{({ groupId }) => <SettleUpClient groupId={groupId} />}</EventRoute>;
}
