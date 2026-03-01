import { page } from "fresh";
import { define } from "../../utils.ts";
import { AdminNav } from "../../components/AdminNav.tsx";
import { getOverview } from "../../lib/stats.ts";
import { getLiveStats } from "../../lib/admin-stats.ts";
import TrendChart from "../../islands/TrendChart.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const siteId = ctx.state.siteId;
    const days = Math.min(
      parseInt(ctx.url.searchParams.get("days") ?? "30"),
      365,
    );
    const data = await getOverview(ctx.state.db, siteId, days);
    const liveStats = await getLiveStats(ctx.state.db);
    const sites = await ctx.state.db.query<{ site_id: string }>(
      `SELECT DISTINCT site_id FROM visitor_views ORDER BY site_id`,
    );
    const knownSites = sites.map((s: { site_id: string }) => s.site_id);
    if (!knownSites.includes(siteId)) knownSites.unshift(siteId);
    ctx.state.pageData = { data, siteId, days, liveStats, knownSites };
    return page();
  },
});

export default define.page<typeof handler>(function Dashboard({ state }) {
  const { data: stats, siteId, days, liveStats, knownSites } = state.pageData;

  const dayOptions = [7, 14, 30, 60, 90, 180, 365];

  return (
    <AdminNav
      title="Dashboard"
      liveStats={liveStats}
      siteSelector={{
        knownSites,
        siteId,
        days,
        dayOptions,
      }}
    >
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="kpi-card">
          <div class="kpi-value">{stats.visits.toLocaleString()}</div>
          <div class="kpi-label">Total Visits</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">
            {stats.unique_visitors.toLocaleString()}
          </div>
          <div class="kpi-label">Unique Visitors</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">
            {stats.avg_interaction_ms
              ? (stats.avg_interaction_ms / 1000).toFixed(1) + "s"
              : "-"}
          </div>
          <div class="kpi-label">Avg Interaction</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{stats.top_paths.length}</div>
          <div class="kpi-label">Active Pages</div>
        </div>
      </div>

      {stats.daily_trend.length > 0 && (
        <div class="bg-[#111] border border-[#1a3a1a] p-4 mb-4">
          <h3 class="text-sm text-[#33ff33] mb-2">Daily Trend</h3>
          <TrendChart data={stats.daily_trend} />
        </div>
      )}

      <div class="grid grid-cols-2 gap-3">
        <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
          <div class="px-4 py-3 border-b border-[#1a3a1a]">
            <h3 class="text-sm text-[#33ff33]">Top Pages</h3>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-[#1a3a1a]">
                <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                  Path
                </th>
                <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                  Views
                </th>
                <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                  Visitors
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.top_paths.slice(0, 10).map((p) => (
                <tr key={p.path} class="border-b border-[#0d1a0d]">
                  <td class="px-4 py-1.5 truncate max-w-[250px] text-[#1a9a1a]">
                    {p.path}
                  </td>
                  <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                    {p.views}
                  </td>
                  <td class="px-4 py-1.5 text-right tabular-nums text-[#1a9a1a]">
                    {p.visitors}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div class="space-y-3">
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
            <div class="px-4 py-3 border-b border-[#1a3a1a]">
              <h3 class="text-sm text-[#33ff33]">Devices</h3>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Type
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Visits
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.devices.map((d) => (
                  <tr key={d.device_type} class="border-b border-[#0d1a0d]">
                    <td class="px-4 py-1.5 text-[#1a9a1a]">
                      {d.device_type}
                    </td>
                    <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                      {d.visits}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
            <div class="px-4 py-3 border-b border-[#1a3a1a]">
              <h3 class="text-sm text-[#33ff33]">Countries</h3>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Code
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Visits
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.countries.map((c) => (
                  <tr key={c.country_code} class="border-b border-[#0d1a0d]">
                    <td class="px-4 py-1.5 text-[#1a9a1a]">
                      {c.country_code}
                    </td>
                    <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                      {c.visits}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="mt-3">
        <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
          <div class="px-4 py-3 border-b border-[#1a3a1a]">
            <h3 class="text-sm text-[#33ff33]">Referrer Sources</h3>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-[#1a3a1a]">
                <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                  Type
                </th>
                <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                  Views
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.referrers.map((r) => (
                <tr key={r.referrer_type} class="border-b border-[#0d1a0d]">
                  <td class="px-4 py-1.5 text-[#1a9a1a]">
                    {r.referrer_type}
                  </td>
                  <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                    {r.views}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminNav>
  );
});
