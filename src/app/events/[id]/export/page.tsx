import ExportReportClient from './ExportReportClient';

export function generateStaticParams() {
  return [{ id: 'group-1' }, { id: 'group-2' }];
}

export default function ExportReportPage({ params }: { params: { id: string } }) {
  return <ExportReportClient groupId={params.id} />;
}
