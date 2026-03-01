// Echelon Analytics — Request Statistics
//
// Tracks response times and request counts in-memory for self-monitoring.
// Rolling window — keeps last 5 minutes of data.

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 50_000;

interface TimingEntry {
  ts: number;
  durationMs: number;
  path: string;
  status: number;
}

const entries: TimingEntry[] = [];
let totalRequests = 0;
let totalErrors = 0; // 5xx responses

/** Record a completed request. */
export function recordRequest(
  path: string,
  durationMs: number,
  status: number,
): void {
  totalRequests++;
  if (status >= 500) totalErrors++;

  entries.push({ ts: Date.now(), durationMs, path, status });

  // Trim old entries
  if (entries.length > MAX_ENTRIES) {
    const cutoff = Date.now() - WINDOW_MS;
    const firstValid = entries.findIndex((e) => e.ts >= cutoff);
    if (firstValid > 0) entries.splice(0, firstValid);
  }
}

export interface RequestStats {
  /** Total requests since boot */
  totalRequests: number;
  /** Total 5xx errors since boot */
  totalErrors: number;
  /** Requests in the last 5 minutes */
  recentRequests: number;
  /** Average response time (ms) over last 5 minutes */
  avgResponseMs: number;
  /** P50 response time (ms) */
  p50Ms: number;
  /** P95 response time (ms) */
  p95Ms: number;
  /** P99 response time (ms) */
  p99Ms: number;
  /** Max response time (ms) in the window */
  maxMs: number;
  /** Requests per second (over last 5 min) */
  rps: number;
  /** Error rate (5xx / total) since boot */
  errorRate: number;
  /** Slowest paths (top 5 by avg duration) */
  slowPaths: { path: string; avgMs: number; count: number }[];
  /** Uptime in seconds */
  uptimeSeconds: number;
}

const bootTime = Date.now();

/** Get current request statistics. */
export function getRequestStats(): RequestStats {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = entries.filter((e) => e.ts >= cutoff);

  const durations = recent.map((e) => e.durationMs).sort((a, b) => a - b);
  const count = durations.length;

  const avg = count > 0 ? durations.reduce((a, b) => a + b, 0) / count : 0;

  const percentile = (p: number) => {
    if (count === 0) return 0;
    const idx = Math.ceil((p / 100) * count) - 1;
    return durations[Math.max(0, idx)];
  };

  // Slowest paths by average duration
  const pathMap = new Map<string, { total: number; count: number }>();
  for (const e of recent) {
    const existing = pathMap.get(e.path);
    if (existing) {
      existing.total += e.durationMs;
      existing.count++;
    } else {
      pathMap.set(e.path, { total: e.durationMs, count: 1 });
    }
  }
  const slowPaths = [...pathMap.entries()]
    .map(([path, { total, count }]) => ({
      path,
      avgMs: Math.round(total / count),
      count,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 5);

  const windowSeconds = Math.min((now - bootTime) / 1000, WINDOW_MS / 1000);

  return {
    totalRequests,
    totalErrors,
    recentRequests: count,
    avgResponseMs: Math.round(avg * 100) / 100,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
    maxMs: count > 0 ? durations[count - 1] : 0,
    rps: windowSeconds > 0
      ? Math.round((count / windowSeconds) * 100) / 100
      : 0,
    errorRate: totalRequests > 0
      ? Math.round((totalErrors / totalRequests) * 10000) / 100
      : 0,
    slowPaths,
    uptimeSeconds: Math.round((now - bootTime) / 1000),
  };
}
