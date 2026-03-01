// Echelon Analytics — Daily Maintenance
//
// Rolls up visitor_views → visitor_views_daily, purges expired data, VACUUMs.
// Runs at 03:00 UTC via hourly check interval.

import type { DbAdapter } from "./db/adapter.ts";
import { RETENTION_DAYS } from "./config.ts";

const DAILY_ROLLUP_RETENTION_DAYS = 730; // 2 years for rollup tables

/** Yesterday's date as YYYY-MM-DD in UTC. */
function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysAgoUTC(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate yesterday's visitor_views into visitor_views_daily.
 * Filters: bot_score < 50, not in excluded_visitors.
 * Idempotent via INSERT OR REPLACE on the composite key.
 */
export async function rollupDay(
  db: DbAdapter,
  targetDate?: string,
): Promise<number> {
  const date = targetDate ?? yesterdayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`rollup: invalid date format: ${date}`);
  }

  console.log(`[echelon] rollup: aggregating visitor_views for ${date}`);
  const start = Date.now();

  const result = await db.run(
    `INSERT OR REPLACE INTO visitor_views_daily
      (site_id, date, device_type, country_code, is_returning,
       visits, unique_visitors, avg_interaction_ms)
    SELECT
      site_id,
      ? AS date,
      COALESCE(device_type, 'unknown'),
      COALESCE(country_code, 'unknown'),
      is_returning,
      COUNT(*),
      COUNT(DISTINCT visitor_id),
      COALESCE(CAST(AVG(CASE WHEN interaction_ms > 0 THEN interaction_ms END) AS INTEGER), 0)
    FROM visitor_views
    WHERE created_at >= ? || 'T00:00:00Z'
      AND created_at < date(?, '+1 day') || 'T00:00:00Z'
      AND bot_score < 50
      AND NOT EXISTS (
        SELECT 1 FROM excluded_visitors ev
        WHERE ev.visitor_id = visitor_views.visitor_id
      )
    GROUP BY site_id, COALESCE(device_type, 'unknown'),
             COALESCE(country_code, 'unknown'), is_returning`,
    date,
    date,
    date,
  );

  console.log(
    `[echelon] rollup: completed for ${date} in ${
      Date.now() - start
    }ms (${result.changes} rows)`,
  );
  return result.changes;
}

/**
 * Purge raw data older than retention period.
 * - visitor_views + semantic_events: configurable (default 90 days)
 * - visitor_views_daily: 2 years
 * - perf_metrics: same as raw data
 * - Experiment metadata: never deleted
 */
export async function purgeExpiredData(
  db: DbAdapter,
  retentionDays: number = RETENTION_DAYS,
): Promise<{
  views_deleted: number;
  events_deleted: number;
  daily_deleted: number;
  perf_deleted: number;
}> {
  const rawCutoff = daysAgoUTC(retentionDays);
  const dailyCutoff = daysAgoUTC(DAILY_ROLLUP_RETENTION_DAYS);

  const views = await db.run(
    `DELETE FROM visitor_views WHERE created_at < ? || 'T00:00:00Z'`,
    rawCutoff,
  );

  const events = await db.run(
    `DELETE FROM semantic_events WHERE created_at < ? || 'T00:00:00Z'`,
    rawCutoff,
  );

  const daily = await db.run(
    `DELETE FROM visitor_views_daily WHERE date < ?`,
    dailyCutoff,
  );

  const perf = await db.run(
    `DELETE FROM perf_metrics WHERE recorded_at < ? || 'T00:00:00Z'`,
    rawCutoff,
  );

  return {
    views_deleted: views.changes,
    events_deleted: events.changes,
    daily_deleted: daily.changes,
    perf_deleted: perf.changes,
  };
}

/**
 * Run the full daily maintenance cycle:
 * 1. Rollup yesterday's visitor_views
 * 2. Purge expired data
 * 3. VACUUM
 */
export async function runDailyMaintenance(db: DbAdapter): Promise<void> {
  const start = Date.now();
  const date = yesterdayUTC();
  console.log("[echelon] daily maintenance: starting");

  // Check for incomplete rollups from previous days (retry up to 7 days back)
  const incomplete = await db.query<{ date: string }>(
    `SELECT date FROM maintenance_log WHERE status != 'complete' ORDER BY date`,
  );
  for (const row of incomplete) {
    console.log(`[echelon] retrying incomplete rollup for ${row.date}`);
    try {
      await rollupDay(db, row.date);
      await db.run(
        `UPDATE maintenance_log SET status = 'complete', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE date = ?`,
        row.date,
      );
    } catch (e) {
      console.error(`[echelon] retry rollup failed for ${row.date}:`, e);
    }
  }

  // Mark today's run as started
  await db.run(
    `INSERT OR IGNORE INTO maintenance_log (date, status) VALUES (?, 'started')`,
    date,
  );

  try {
    const rollupRows = await rollupDay(db, date);
    const purged = await purgeExpiredData(db);
    console.log("[echelon] daily maintenance: purged", purged);

    await db.run(
      `UPDATE maintenance_log SET status = 'complete', rollup_rows = ?, purge_views = ?, purge_events = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE date = ?`,
      rollupRows,
      purged.views_deleted,
      purged.events_deleted,
      date,
    );

    await db.exec("PRAGMA incremental_vacuum(100)");
    console.log(
      `[echelon] daily maintenance: completed in ${Date.now() - start}ms`,
    );
  } catch (e) {
    console.error("[echelon] daily maintenance: failed", e);
    await db.run(
      `UPDATE maintenance_log SET status = 'failed' WHERE date = ?`,
      date,
    ).catch(() => {});
  }
}

/**
 * Schedule daily maintenance at 03:00 UTC.
 * Checks every hour, runs once per calendar day.
 */
export function scheduleDailyMaintenance(db: DbAdapter): void {
  const CHECK_MS = 3_600_000; // 1 hour
  const TARGET_HOUR = 3;
  let lastDate = "";

  setInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== TARGET_HOUR) return;

    const today = now.toISOString().slice(0, 10);
    if (lastDate === today) return;

    lastDate = today;
    runDailyMaintenance(db).catch((e) =>
      console.error("[echelon] daily maintenance: unhandled error", e)
    );
  }, CHECK_MS);

  console.log("[echelon] daily maintenance scheduled (runs at ~3 AM UTC)");
}
