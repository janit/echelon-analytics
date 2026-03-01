// Echelon Analytics — UTM Campaign Cache
//
// In-memory cache of active UTM campaigns, refreshed every 60s.
// Only configured campaigns are tracked — unknown utm_campaign values are ignored.

import type { DbAdapter } from "./db/adapter.ts";

// Map<site_id, Set<utm_campaign>> — swapped atomically on refresh
let campaignCache = new Map<string, Set<string>>();
let refreshedAt = 0;

export async function refreshUtmCampaigns(db: DbAdapter): Promise<void> {
  if (Date.now() - refreshedAt < 60_000) return;
  // Prevent concurrent re-entry during await
  refreshedAt = Date.now();
  const rows = await db.query<{ utm_campaign: string; site_id: string }>(
    "SELECT utm_campaign, site_id FROM utm_campaigns WHERE status = 'active'",
  );
  const newCache = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = newCache.get(r.site_id);
    if (!set) {
      set = new Set();
      newCache.set(r.site_id, set);
    }
    set.add(r.utm_campaign);
  }
  // Atomic swap — readers never see partial state
  campaignCache = newCache;
}

export function isUtmCampaignActive(
  siteId: string,
  campaign: string,
): boolean {
  return campaignCache.get(siteId)?.has(campaign) ?? false;
}

export function markStale(): void {
  refreshedAt = 0;
}
