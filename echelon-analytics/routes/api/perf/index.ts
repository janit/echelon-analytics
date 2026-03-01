import { define } from "../../../utils.ts";
import {
  insertMetrics,
  type PerfQuery,
  queryMetrics,
} from "../../../lib/perf.ts";
import type { PerfMetric } from "../../../types.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const query: PerfQuery = {
      category: url.searchParams.get("category") ?? undefined,
      metric: url.searchParams.get("metric") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "100"),
      since: url.searchParams.get("since") ?? undefined,
    };

    const rows = await queryMetrics(ctx.state.db, query);
    return Response.json(rows);
  },

  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    if (!Array.isArray(body)) {
      return Response.json(
        {
          error: "invalid_payload",
          message: "Expected array of metrics",
        },
        { status: 400 },
      );
    }

    for (const m of body) {
      if (!m.category || !m.metric || m.value === undefined || !m.unit) {
        return Response.json(
          {
            error: "invalid_payload",
            message: "Each metric requires category, metric, value, unit",
          },
          { status: 400 },
        );
      }
    }

    try {
      const count = await insertMetrics(
        ctx.state.db,
        body as PerfMetric[],
      );
      return Response.json({ inserted: count });
    } catch (err) {
      console.error("[echelon] Perf ingest error:", err);
      return Response.json(
        { error: "internal", message: "Ingest failed" },
        { status: 500 },
      );
    }
  },
});
