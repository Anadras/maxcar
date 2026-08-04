import { DashboardView } from '@/components/dashboard-view';
import { getDashboardCounts } from '@/lib/data/dashboard';

export default async function DashboardPage() {
  const counts = await getDashboardCounts();
  return <DashboardView counts={counts} devices={counts.devices} />;
}
