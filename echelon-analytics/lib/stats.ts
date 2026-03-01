// Echelon Analytics — Stats Query Handlers

import type { DbAdapter } from "./db/adapter.ts";
import type { ExperimentStats, VariantStats } from "../types.ts";

/**
 * A/B experiment results with two-proportion z-test significance.
 * Uses indexed experiment_id/variant_id columns on semantic_events.
 */
export async function getExperimentStats(
  db: DbAdapter,
  experimentId?: string,
): Promise<ExperimentStats[]> {
  const experiments = experimentId
    ? await db.query<Record<string, unknown>>(
      `SELECT * FROM experiments WHERE experiment_id = ?`,
      experimentId,
    )
    : await db.query<Record<string, unknown>>(
      `SELECT * FROM experiments WHERE status IN ('active', 'completed')`,
    );

  const results: ExperimentStats[] = [];

  for (const exp of experiments) {
    const expId = exp.experiment_id as string;
    const metricType = exp.metric_event_type as string;

    // Single grouped query using indexed columns — no N+1, no LIKE scans
    const variantRows = await db.query<{
      variant_id: string;
      name: string;
      is_control: number;
      weight: number;
      impressions: number;
      conversions: number;
    }>(
      `SELECT
        ev.variant_id,
        ev.name,
        ev.is_control,
        ev.weight,
        COALESCE(stats.impressions, 0) AS impressions,
        COALESCE(stats.conversions, 0) AS conversions
      FROM experiment_variants ev
      LEFT JOIN (
        SELECT variant_id AS vid,
               COUNT(DISTINCT session_id) AS impressions,
               COUNT(DISTINCT CASE WHEN event_type = ? THEN session_id END) AS conversions
        FROM semantic_events
        WHERE experiment_id = ?
        GROUP BY variant_id
      ) stats ON stats.vid = ev.variant_id
      WHERE ev.experiment_id = ?
      ORDER BY ev.is_control DESC`,
      metricType,
      expId,
      expId,
    );

    const variantStats: VariantStats[] = variantRows.map((v) => ({
      variant_id: v.variant_id,
      name: v.name,
      is_control: v.is_control === 1,
      impressions: v.impressions,
      conversions: v.conversions,
      conversion_rate: v.impressions > 0 ? v.conversions / v.impressions : 0,
      relative_uplift: null,
      significance: "Not enough data",
    }));

    // Compute uplift and significance relative to control
    const control = variantStats.find((v) => v.is_control);
    if (control && control.impressions > 0) {
      for (const v of variantStats) {
        if (v.is_control) continue;
        if (control.conversion_rate > 0) {
          v.relative_uplift = (v.conversion_rate - control.conversion_rate) /
            control.conversion_rate;
        }
        v.significance = zTestSignificance(
          control.conversions,
          control.impressions,
          v.conversions,
          v.impressions,
        );
      }
    }

    results.push({
      experiment_id: expId,
      name: exp.name as string,
      status: exp.status as string,
      metric_event_type: metricType,
      variants: variantStats,
    });
  }

  return results;
}

/** Two-proportion z-test */
function zTestSignificance(
  c1: number,
  n1: number,
  c2: number,
  n2: number,
): string {
  if (n1 < 100 || n2 < 100) {
    return `Not yet — need more data (${Math.min(n1, n2)} < 100 impressions)`;
  }

  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pPooled = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));

  if (se === 0) return "No variance";

  const z = Math.abs(p2 - p1) / se;

  if (z >= 2.576) return "Statistically significant at 99%";
  if (z >= 1.96) return "Statistically significant at 95%";
  if (z >= 1.645) return "Marginally significant at 90%";
  return "Not statistically significant";
}

/** Overview stats for external analytics. */
export async function getOverview(
  db: DbAdapter,
  siteId: string,
  days: number = 30,
) {
  const cutoff = daysAgoUTC(days);

  const totals = await db.queryOne<{
    visits: number;
    unique_visitors: number;
    avg_interaction_ms: number;
  }>(
    `SELECT COALESCE(SUM(visits), 0) AS visits,
            COALESCE(SUM(unique_visitors), 0) AS unique_visitors,
            COALESCE(CAST(AVG(avg_interaction_ms) AS INTEGER), 0) AS avg_interaction_ms
     FROM visitor_views_daily WHERE site_id = ? AND date >= ?`,
    siteId,
    cutoff,
  );

  const today = new Date().toISOString().slice(0, 10);
  const todayTotals = await db.queryOne<{
    visits: number;
    unique_visitors: number;
  }>(
    `SELECT COUNT(*) AS visits,
            COUNT(DISTINCT visitor_id) AS unique_visitors
     FROM visitor_views
     WHERE site_id = ? AND created_at >= ? || 'T00:00:00Z' AND bot_score < 50`,
    siteId,
    today,
  );

  // Limit path scan to max 7 days of raw data for performance
  const pathCutoff = daysAgoUTC(Math.min(days, 7));
  const topPaths = await db.query<{
    path: string;
    views: number;
    visitors: number;
  }>(
    `SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
     FROM visitor_views WHERE site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY path ORDER BY views DESC LIMIT 20`,
    siteId,
    pathCutoff + "T00:00:00Z",
  );

  const devices = await db.query<{ device_type: string; visits: number }>(
    `SELECT device_type, SUM(visits) AS visits
     FROM visitor_views_daily WHERE site_id = ? AND date >= ?
     GROUP BY device_type ORDER BY visits DESC`,
    siteId,
    cutoff,
  );

  const countries = await db.query<{
    country_code: string;
    visits: number;
    visitors: number;
  }>(
    `SELECT country_code, SUM(visits) AS visits, SUM(unique_visitors) AS visitors
     FROM visitor_views_daily WHERE site_id = ? AND date >= ? AND country_code != 'unknown'
     GROUP BY country_code ORDER BY visits DESC LIMIT 10`,
    siteId,
    cutoff,
  );

  // Limit referrer scan to max 7 days of raw data for performance
  const referrers = await db.query<{ referrer_type: string; views: number }>(
    `SELECT referrer_type, COUNT(*) AS views
     FROM visitor_views WHERE site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY referrer_type ORDER BY views DESC`,
    siteId,
    pathCutoff + "T00:00:00Z",
  );

  const dailyTrend = await db.query<{
    date: string;
    visits: number;
    visitors: number;
  }>(
    `SELECT date, SUM(visits) AS visits, SUM(unique_visitors) AS visitors
     FROM visitor_views_daily WHERE site_id = ? AND date >= ?
     GROUP BY date ORDER BY date`,
    siteId,
    cutoff,
  );

  return {
    site_id: siteId,
    period_days: days,
    visits: (totals?.visits ?? 0) + (todayTotals?.visits ?? 0),
    unique_visitors: (totals?.unique_visitors ?? 0) +
      (todayTotals?.unique_visitors ?? 0),
    avg_interaction_ms: totals?.avg_interaction_ms ?? 0,
    top_paths: topPaths,
    devices,
    countries,
    referrers,
    daily_trend: dailyTrend,
  };
}

/** Realtime stats — active visitors in last 5 minutes. */
export async function getRealtime(db: DbAdapter, siteId: string) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const active = await db.queryOne<{
    active_visitors: number;
    pageviews: number;
  }>(
    `SELECT COUNT(DISTINCT visitor_id) AS active_visitors,
            COUNT(*) AS pageviews
     FROM visitor_views
     WHERE site_id = ? AND created_at >= ? AND bot_score < 50`,
    siteId,
    fiveMinAgo,
  );

  const activePaths = await db.query<{ path: string; views: number }>(
    `SELECT path, COUNT(*) AS views
     FROM visitor_views
     WHERE site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY path ORDER BY views DESC LIMIT 10`,
    siteId,
    fiveMinAgo,
  );

  return {
    site_id: siteId,
    active_visitors: active?.active_visitors ?? 0,
    pageviews: active?.pageviews ?? 0,
    active_paths: activePaths,
  };
}

/** Campaign stats — views and visitors grouped by campaign, source, medium. */
export async function getCampaignStats(
  db: DbAdapter,
  days: number = 30,
  campaignId?: string,
) {
  const cutoff = daysAgoUTC(Math.min(days, 90)) + "T00:00:00Z";

  type CampaignStatRow = {
    id: string;
    name: string;
    utm_campaign: string;
    site_id: string;
    status: string;
    views: number;
    visitors: number;
  };

  const baseSql =
    `SELECT uc.id, uc.name, uc.utm_campaign, uc.site_id, uc.status,
            COUNT(vv.id) AS views,
            COUNT(DISTINCT vv.visitor_id) AS visitors
     FROM utm_campaigns uc
     LEFT JOIN visitor_views vv
       ON vv.utm_campaign = uc.utm_campaign
       AND vv.site_id = uc.site_id
       AND vv.created_at >= ?
       AND vv.bot_score < 50`;

  const campaigns = campaignId
    ? await db.query<CampaignStatRow>(
      baseSql + ` WHERE uc.id = ? GROUP BY uc.id ORDER BY views DESC`,
      cutoff,
      campaignId,
    )
    : await db.query<CampaignStatRow>(
      baseSql + ` GROUP BY uc.id ORDER BY views DESC`,
      cutoff,
    );

  return campaigns;
}

/** Detailed campaign breakdown — source, medium, content, term. */
export async function getCampaignDetail(
  db: DbAdapter,
  utmCampaign: string,
  siteId: string,
  days: number = 30,
) {
  const cutoff = daysAgoUTC(Math.min(days, 90)) + "T00:00:00Z";

  const bySource = await db.query<{
    utm_source: string;
    views: number;
    visitors: number;
  }>(
    `SELECT COALESCE(utm_source, 'direct') AS utm_source,
            COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
     FROM visitor_views
     WHERE utm_campaign = ? AND site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY utm_source ORDER BY views DESC LIMIT 20`,
    utmCampaign,
    siteId,
    cutoff,
  );

  const byMedium = await db.query<{
    utm_medium: string;
    views: number;
    visitors: number;
  }>(
    `SELECT COALESCE(utm_medium, 'none') AS utm_medium,
            COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
     FROM visitor_views
     WHERE utm_campaign = ? AND site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY utm_medium ORDER BY views DESC LIMIT 20`,
    utmCampaign,
    siteId,
    cutoff,
  );

  const dailyTrend = await db.query<{
    date: string;
    views: number;
    visitors: number;
  }>(
    `SELECT DATE(created_at) AS date,
            COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
     FROM visitor_views
     WHERE utm_campaign = ? AND site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY date ORDER BY date`,
    utmCampaign,
    siteId,
    cutoff,
  );

  const topPaths = await db.query<{
    path: string;
    views: number;
    visitors: number;
  }>(
    `SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
     FROM visitor_views
     WHERE utm_campaign = ? AND site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY path ORDER BY views DESC LIMIT 20`,
    utmCampaign,
    siteId,
    cutoff,
  );

  const byContent = await db.query<{
    utm_content: string;
    views: number;
  }>(
    `SELECT COALESCE(utm_content, 'none') AS utm_content, COUNT(*) AS views
     FROM visitor_views
     WHERE utm_campaign = ? AND site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY utm_content ORDER BY views DESC LIMIT 20`,
    utmCampaign,
    siteId,
    cutoff,
  );

  const byTerm = await db.query<{
    utm_term: string;
    views: number;
  }>(
    `SELECT COALESCE(utm_term, 'none') AS utm_term, COUNT(*) AS views
     FROM visitor_views
     WHERE utm_campaign = ? AND site_id = ? AND created_at >= ? AND bot_score < 50
     GROUP BY utm_term ORDER BY views DESC LIMIT 20`,
    utmCampaign,
    siteId,
    cutoff,
  );

  return { bySource, byMedium, dailyTrend, topPaths, byContent, byTerm };
}

function daysAgoUTC(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
