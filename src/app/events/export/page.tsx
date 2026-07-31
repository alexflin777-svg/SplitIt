'use client';

import EventRoute from '../_components/EventRoute';
import ExportReportClient from './ExportReportClient';

export default function Page() {
  return <EventRoute>{({ groupId }) => <ExportReportClient groupId={groupId} />}</EventRoute>;
}
