// Echelon Analytics — Performance Metrics Helpers

import type { DbAdapter, SQLParam } from "./db/adapter.ts";
import type { PerfMetric, PerfMetricRow } from "../types.ts";

export interface PerfQuery {
  category?: string;
  metric?: string;
  limit?: number;
  since?: string;
}

/** Insert one or more performance metrics. */
export async function insertMetrics(
  db: DbAdapter,
  metrics: PerfMetric[],
): Promise<number> {
  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const m of metrics) {
      await tx.run(
        `INSERT INTO perf_metrics (commit_hash, branch, category, metric, value, unit, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        m.commit_hash ?? null,
        m.branch ?? null,
        m.category,
        m.metric,
        m.value,
        m.unit,
        m.metadata ? JSON.stringify(m.metadata) : null,
      );
      inserted++;
    }
  });
  return inserted;
}

/** Query performance metrics with optional filters. */
export async function queryMetrics(
  db: DbAdapter,
  query: PerfQuery = {},
): Promise<PerfMetricRow[]> {
  const conditions: string[] = [];
  const params: SQLParam[] = [];

  if (query.category) {
    conditions.push("category = ?");
    params.push(query.category);
  }
  if (query.metric) {
    conditions.push("metric = ?");
    params.push(query.metric);
  }
  if (query.since) {
    conditions.push("recorded_at >= ?");
    params.push(query.since);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const limit = query.limit ?? 1000;

  return await db.query<PerfMetricRow>(
    `SELECT id, recorded_at, commit_hash, branch, category, metric, value, unit, metadata
     FROM perf_metrics ${where}
     ORDER BY recorded_at DESC
     LIMIT ?`,
    ...params,
    limit,
  );
}

/** Get the latest value for each distinct metric in a category. */
export async function getLatestByCategory(
  db: DbAdapter,
  category: string,
): Promise<PerfMetricRow[]> {
  return await db.query<PerfMetricRow>(
    `SELECT p.id, p.recorded_at, p.commit_hash, p.branch, p.category, p.metric, p.value, p.unit, p.metadata
     FROM perf_metrics p
     INNER JOIN (
       SELECT metric, MAX(recorded_at) AS max_ts
       FROM perf_metrics
       WHERE category = ?
       GROUP BY metric
     ) latest ON p.metric = latest.metric AND p.recorded_at = latest.max_ts AND p.category = ?
     ORDER BY p.metric`,
    category,
    category,
  );
}

/** Get trend data: last N values per metric for sparkline rendering. */
export async function getTrends(
  db: DbAdapter,
  opts: { limit?: number; since?: string } = {},
): Promise<Record<string, PerfMetricRow[]>> {
  const limit = opts.limit ?? 30;
  const sinceClause = opts.since ? "WHERE recorded_at >= ?" : "";
  const params: SQLParam[] = opts.since ? [opts.since, limit] : [limit];

  const rows = await db.query<PerfMetricRow & { rn: number }>(
    `WITH ranked AS (
      SELECT id, recorded_at, commit_hash, branch, category, metric, value, unit, metadata,
             category || '/' || metric AS key,
             ROW_NUMBER() OVER (
               PARTITION BY category, metric
               ORDER BY recorded_at DESC
             ) AS rn
      FROM perf_metrics
      ${sinceClause}
    )
    SELECT id, recorded_at, commit_hash, branch, category, metric, value, unit, metadata, key, rn
    FROM ranked
    WHERE rn <= ?
    ORDER BY key, recorded_at ASC`,
    ...params,
  );

  const trends: Record<string, PerfMetricRow[]> = {};
  for (const row of rows) {
    const key = (row as unknown as { key: string }).key;
    if (!trends[key]) trends[key] = [];
    trends[key].push({
      id: row.id,
      recorded_at: row.recorded_at,
      commit_hash: row.commit_hash,
      branch: row.branch,
      category: row.category,
      metric: row.metric,
      value: row.value,
      unit: row.unit,
      metadata: row.metadata,
    });
  }

  return trends;
}
