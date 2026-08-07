// Pure — deliberately kept free of `import 'server-only'` (unlike
// lib/data/reports.ts) so it can be unit tested directly with Vitest.
export type ReportPeriod = 'today' | '7d' | '30d' | 'custom';

export interface ReportRange {
  period: ReportPeriod;
  from: string;
  to: string;
}

/** Resolves the admin's period selector into an absolute [from, to) range.
 * Always computed server-side from the request, never trusted from the
 * client beyond which preset/custom dates were picked. */
export function resolveReportRange(
  period: string | undefined,
  customFrom: string | undefined,
  customTo: string | undefined,
): ReportRange {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const to = new Date(startOfToday);
  to.setUTCDate(to.getUTCDate() + 1);

  if (period === '7d') {
    const from = new Date(startOfToday);
    from.setUTCDate(from.getUTCDate() - 6);
    return { period: '7d', from: from.toISOString(), to: to.toISOString() };
  }
  if (period === '30d') {
    const from = new Date(startOfToday);
    from.setUTCDate(from.getUTCDate() - 29);
    return { period: '30d', from: from.toISOString(), to: to.toISOString() };
  }
  if (period === 'custom' && customFrom) {
    const from = new Date(`${customFrom}T00:00:00Z`);
    const toDate = customTo
      ? new Date(`${customTo}T00:00:00Z`)
      : new Date(startOfToday);
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    return {
      period: 'custom',
      from: from.toISOString(),
      to: toDate.toISOString(),
    };
  }
  return {
    period: 'today',
    from: startOfToday.toISOString(),
    to: to.toISOString(),
  };
}
