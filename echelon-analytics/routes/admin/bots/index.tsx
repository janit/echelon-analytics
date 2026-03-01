import { page } from "fresh";
import { define } from "../../../utils.ts";
import { AdminNav } from "../../../components/AdminNav.tsx";
import { getLiveStats } from "../../../lib/admin-stats.ts";
import type { SQLParam } from "../../../lib/db/adapter.ts";
import BotActions from "../../../islands/BotActions.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const siteId = ctx.state.siteId !== "default" ? ctx.state.siteId : null;
    const minScore = parseInt(ctx.url.searchParams.get("min_score") ?? "25");
    const limit = parseInt(url.searchParams.get("limit") ?? "50");

    const params: SQLParam[] = [minScore];
    let where = "WHERE bot_score >= ?";
    if (siteId) {
      where += " AND site_id = ?";
      params.push(siteId);
    }

    const rows = await db.query<Record<string, unknown>>(
      `SELECT visitor_id,
              MAX(bot_score) AS max_bot_score,
              COUNT(*) AS pageviews,
              MIN(created_at) AS first_seen,
              MAX(created_at) AS last_seen,
              GROUP_CONCAT(DISTINCT site_id) AS sites,
              GROUP_CONCAT(DISTINCT device_type) AS devices,
              GROUP_CONCAT(DISTINCT country_code) AS countries,
              EXISTS(SELECT 1 FROM excluded_visitors ev WHERE ev.visitor_id = visitor_views.visitor_id) AS is_excluded
       FROM visitor_views ${where}
       GROUP BY visitor_id
       ORDER BY max_bot_score DESC, pageviews DESC
       LIMIT ?`,
      ...params,
      limit,
    );

    const liveStats = await getLiveStats(db);
    ctx.state.pageData = { rows, siteId, minScore, liveStats };
    return page();
  },
});

function scoreBadge(score: number) {
  const cls = score >= 50
    ? "bot-score-high"
    : score >= 25
    ? "bot-score-med"
    : "bot-score-low";
  return <span class={`bot-score-badge ${cls}`}>{score}</span>;
}

export default define.page<typeof handler>(function SuspiciousPage({ state }) {
  const { rows, liveStats } = state.pageData;

  return (
    <AdminNav title="Suspicious Visitors" liveStats={liveStats}>
      <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#1a3a1a]">
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Visitor ID
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Score
              </th>
              <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                Views
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Countries
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Devices
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Last Seen
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.visitor_id as string}
                class={`border-b border-[#0d1a0d] ${
                  r.is_excluded ? "excluded-row" : ""
                }`}
              >
                <td class="px-4 py-1.5">
                  <a
                    href={`/admin/bots/${
                      encodeURIComponent(r.visitor_id as string)
                    }`}
                    class="visitor-id text-[#33ff33] hover:text-[#66ff66]"
                  >
                    {(r.visitor_id as string).slice(0, 12)}...
                  </a>
                </td>
                <td class="px-4 py-1.5">
                  {scoreBadge(r.max_bot_score as number)}
                </td>
                <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                  {r.pageviews as number}
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {r.countries as string}
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {r.devices as string}
                </td>
                <td class="px-4 py-1.5 text-[#1a5a1a]">
                  {(r.last_seen as string).slice(0, 16)}
                </td>
                <td class="px-4 py-1.5">
                  <BotActions
                    visitorId={r.visitor_id as string}
                    isExcluded={!!(r.is_excluded as number)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p class="text-[#1a5a1a] text-sm mt-4">
          No suspicious visitors found.
        </p>
      )}
    </AdminNav>
  );
});
