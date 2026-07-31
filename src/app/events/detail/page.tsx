'use client';

import EventRoute from '../_components/EventRoute';
import EventDetailClient from './EventDetailClient';

export default function Page() {
  return <EventRoute>{({ groupId }) => <EventDetailClient groupId={groupId} />}</EventRoute>;
}
