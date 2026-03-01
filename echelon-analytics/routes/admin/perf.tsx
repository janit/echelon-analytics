import { page } from "fresh";
import { define } from "../../utils.ts";
import { AdminNav } from "../../components/AdminNav.tsx";
import { getLiveStats } from "../../lib/admin-stats.ts";
import { getTrends, queryMetrics } from "../../lib/perf.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "50");

    const metrics = await queryMetrics(ctx.state.db, { category, limit });
    const trends = await getTrends(ctx.state.db, { limit: 20 });
    const liveStats = await getLiveStats(ctx.state.db);

    ctx.state.pageData = { metrics, trends, category, liveStats };
    return page();
  },
});

export default define.page<typeof handler>(function PerfPage({ state }) {
  const { metrics, trends, liveStats } = state.pageData;
  const trendKeys = Object.keys(trends);

  return (
    <AdminNav title="Performance Metrics" liveStats={liveStats}>
      <h3 class="text-sm text-[#33ff33] mb-2">
        Recent Metrics ({metrics.length})
      </h3>
      <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#1a3a1a]">
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Category
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Metric
              </th>
              <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                Value
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Unit
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Branch
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.id} class="border-b border-[#0d1a0d]">
                <td class="px-4 py-1.5 text-[#1a9a1a]">{m.category}</td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">{m.metric}</td>
                <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                  {m.value.toFixed(2)}
                </td>
                <td class="px-4 py-1.5 text-[#1a5a1a]">{m.unit}</td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">{m.branch ?? "-"}</td>
                <td class="px-4 py-1.5 text-[#1a5a1a]">
                  {m.recorded_at.slice(0, 16)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {metrics.length === 0 && (
        <p class="text-[#1a5a1a] text-sm">
          No performance metrics recorded.
        </p>
      )}

      {trendKeys.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">Trends</h3>
          {trendKeys.map((key) => {
            const rows = trends[key];
            if (!rows.length) return null;
            const values = rows.map((r) => r.value);
            const max = Math.max(...values);
            const min = Math.min(...values);
            const last = values[values.length - 1];
            return (
              <div
                key={key}
                class="bg-[#111] border border-[#1a3a1a] p-3 mb-2"
              >
                <div class="flex justify-between items-center">
                  <span class="text-sm text-[#33ff33]">{key}</span>
                  <span class="text-sm tabular-nums text-[#33ff33]">
                    {last.toFixed(2)} {rows[0].unit}
                    <span class="text-xs text-[#1a5a1a] ml-2">
                      (min: {min.toFixed(2)}, max: {max.toFixed(2)})
                    </span>
                  </span>
                </div>
                <div class="flex gap-px items-end h-6 mt-1">
                  {values.map((v, i) => {
                    const h = max > min
                      ? Math.max(2, ((v - min) / (max - min)) * 24)
                      : 12;
                    return (
                      <div
                        key={i}
                        style={`width:${
                          100 / values.length
                        }%;height:${h}px;background:#ff6600`}
                        class="rounded-sm"
                        title={`${v.toFixed(2)} (${
                          rows[i].recorded_at.slice(0, 10)
                        })`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </AdminNav>
  );
});
