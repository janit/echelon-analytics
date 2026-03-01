// Echelon Analytics — Per-Site Consent Banner CSS Cache
//
// Caches custom CSS from site_settings table, refreshed every 60 seconds.

import type { DbAdapter } from "./db/adapter.ts";

const cache = new Map<string, string>();
let refreshedAt = 0;
let stale = true;

export function markConsentCssStale(): void {
  stale = true;
}

export async function refreshConsentCss(db: DbAdapter): Promise<void> {
  if (!stale && Date.now() - refreshedAt < 60_000) return;
  cache.clear();
  const rows = await db.query<{ site_id: string; consent_css: string }>(
    `SELECT site_id, consent_css FROM site_settings WHERE consent_css IS NOT NULL`,
  );
  for (const r of rows) cache.set(r.site_id, r.consent_css);
  refreshedAt = Date.now();
  stale = false;
}

export function getConsentCss(siteId: string): string {
  return cache.get(siteId) ?? "";
}
