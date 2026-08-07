import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ReportRange } from '@/lib/report-range';

export type { ReportPeriod, ReportRange } from '@/lib/report-range';
export { resolveReportRange } from '@/lib/report-range';

export interface ReportKpis {
  reproductions: number;
  uniqueDevices: number;
  campaignsShown: number;
  totalMediaSeconds: number;
  geoActivations: number;
}

export interface ReportCampaignRow {
  campaignId: string;
  campaignName: string;
  advertiserName: string | null;
  campaignType: 'regular' | 'geo';
  reproductions: number;
  uniqueDevices: number;
  geoActivations: number;
  lastReproductionAt: string | null;
}

/** Every number here comes straight from public.impressions — the same
 * real, device-reported events campaign_admin_view.impression_count
 * already counts (see campanhas/page.tsx's "Reproduções" column). No
 * separate/duplicated event pipeline, no mocked figures: if this table is
 * empty for the selected period, the KPIs and table are honestly zero. */
export async function getReportData(range: ReportRange, campaignId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from('impressions')
    .select(
      'campaign_id, device_id, source, duration_ms, started_at, campaigns(name, campaign_type, advertiser_id, advertisers(trade_name))',
    )
    .gte('started_at', range.from)
    .lt('started_at', range.to);
  if (campaignId) query = query.eq('campaign_id', campaignId);
  const { data: impressions, error } = await query;
  if (error) throw error;

  const rows = impressions ?? [];

  const kpis: ReportKpis = {
    reproductions: rows.length,
    uniqueDevices: new Set(rows.map((row) => row.device_id)).size,
    campaignsShown: new Set(rows.map((row) => row.campaign_id)).size,
    totalMediaSeconds: Math.round(
      rows.reduce((sum, row) => sum + (row.duration_ms ?? 0), 0) / 1000,
    ),
    geoActivations: rows.filter((row) => row.source === 'geo').length,
  };

  const byCampaign = new Map<
    string,
    {
      name: string;
      advertiserName: string | null;
      type: 'regular' | 'geo';
      reproductions: number;
      devices: Set<string>;
      geoActivations: number;
      lastAt: string | null;
    }
  >();
  for (const row of rows) {
    const campaign = row.campaigns;
    if (!campaign) continue;
    const existing = byCampaign.get(row.campaign_id) ?? {
      name: campaign.name,
      advertiserName: campaign.advertisers?.trade_name ?? null,
      type: campaign.campaign_type,
      reproductions: 0,
      devices: new Set<string>(),
      geoActivations: 0,
      lastAt: null,
    };
    existing.reproductions += 1;
    existing.devices.add(row.device_id);
    if (row.source === 'geo') existing.geoActivations += 1;
    if (!existing.lastAt || row.started_at > existing.lastAt) {
      existing.lastAt = row.started_at;
    }
    byCampaign.set(row.campaign_id, existing);
  }

  const campaignRows: ReportCampaignRow[] = Array.from(
    byCampaign.entries(),
  )
    .map(([campaignId, value]) => ({
      campaignId,
      campaignName: value.name,
      advertiserName: value.advertiserName,
      campaignType: value.type,
      reproductions: value.reproductions,
      uniqueDevices: value.devices.size,
      geoActivations: value.geoActivations,
      lastReproductionAt: value.lastAt,
    }))
    .sort((a, b) => b.reproductions - a.reproductions);

  return { kpis, campaignRows };
}
