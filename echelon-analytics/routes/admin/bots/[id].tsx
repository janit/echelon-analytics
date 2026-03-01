import { page } from "fresh";
import { define } from "../../../utils.ts";
import { AdminNav } from "../../../components/AdminNav.tsx";
import { getLiveStats } from "../../../lib/admin-stats.ts";
import BotActions from "../../../islands/BotActions.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const visitorId = decodeURIComponent(ctx.params.id);

    const views = await db.query<Record<string, unknown>>(
      `SELECT path, site_id, interaction_ms, device_type, os_name,
              country_code, referrer_type, bot_score, is_pwa, created_at
       FROM visitor_views WHERE visitor_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      visitorId,
    );

    const events = await db.query<Record<string, unknown>>(
      `SELECT event_type, site_id, data, device_type, bot_score, created_at
       FROM semantic_events WHERE visitor_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      visitorId,
    );

    const excluded = await db.queryOne<Record<string, unknown>>(
      `SELECT * FROM excluded_visitors WHERE visitor_id = ?`,
      visitorId,
    );

    const liveStats = await getLiveStats(db);
    ctx.state.pageData = {
      visitorId,
      views,
      events,
      isExcluded: !!excluded,
      liveStats,
    };
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

export default define.page<typeof handler>(function VisitorDetailPage({
  state,
}) {
  const { visitorId, views, events, isExcluded, liveStats } = state.pageData;

  return (
    <AdminNav
      title={`Visitor ${visitorId.slice(0, 12)}...`}
      liveStats={liveStats}
    >
      <div class="flex gap-2 mb-4 items-center">
        <code class="visitor-id bg-[#111] border border-[#1a3a1a] px-2 py-1 text-[#33ff33]">
          {visitorId}
        </code>
        {isExcluded && (
          <span
            class="text-[#ff3333] text-xs px-2 py-1 border border-[#661111]"
            style="background:#1a0a0a"
          >
            EXCLUDED
          </span>
        )}
        <BotActions visitorId={visitorId} isExcluded={isExcluded} />
      </div>

      <h3 class="text-sm text-[#33ff33] mb-2">
        Page Views ({views.length})
      </h3>
      <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#1a3a1a]">
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Path
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Site
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Score
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Device
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Country
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Interaction
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {views.map((v, i) => (
              <tr key={i} class="border-b border-[#0d1a0d]">
                <td class="px-4 py-1.5 truncate max-w-[200px] text-[#1a9a1a]">
                  {v.path as string}
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {v.site_id as string}
                </td>
                <td class="px-4 py-1.5">
                  {scoreBadge(v.bot_score as number)}
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {v.device_type as string}
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {v.country_code as string}
                </td>
                <td class="px-4 py-1.5 tabular-nums text-[#33ff33]">
                  {v.interaction_ms
                    ? `${((v.interaction_ms as number) / 1000).toFixed(1)}s`
                    : "-"}
                </td>
                <td class="px-4 py-1.5 text-[#1a5a1a]">
                  {(v.created_at as string).slice(0, 16)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {events.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">
            Semantic Events ({events.length})
          </h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Type
                  </th>
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Site
                  </th>
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Score
                  </th>
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Data
                  </th>
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} class="border-b border-[#0d1a0d]">
                    <td class="px-4 py-1.5 text-[#1a9a1a]">
                      {e.event_type as string}
                    </td>
                    <td class="px-4 py-1.5 text-[#1a9a1a]">
                      {e.site_id as string}
                    </td>
                    <td class="px-4 py-1.5">
                      {scoreBadge(e.bot_score as number)}
                    </td>
                    <td class="px-4 py-1.5 truncate max-w-[200px]">
                      <span class="text-xs text-[#1a5a1a]">
                        {e.data as string}
                      </span>
                    </td>
                    <td class="px-4 py-1.5 text-[#1a5a1a]">
                      {(e.created_at as string).slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminNav>
  );
});
