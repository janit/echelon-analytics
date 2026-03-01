import { page } from "fresh";
import { define } from "../../../utils.ts";
import { AdminNav } from "../../../components/AdminNav.tsx";
import { getLiveStats } from "../../../lib/admin-stats.ts";
import BotActions from "../../../islands/BotActions.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const rows = await db.query<Record<string, unknown>>(
      `SELECT ev.*, COUNT(vv.id) AS pageviews, MAX(vv.bot_score) AS max_bot_score
       FROM excluded_visitors ev
       LEFT JOIN visitor_views vv ON vv.visitor_id = ev.visitor_id
       GROUP BY ev.visitor_id
       ORDER BY ev.created_at DESC`,
    );
    const liveStats = await getLiveStats(db);
    ctx.state.pageData = { rows, liveStats };
    return page();
  },
});

export default define.page<typeof handler>(function ExcludedPage({ state }) {
  const { rows, liveStats } = state.pageData;

  return (
    <AdminNav title="Excluded Visitors" liveStats={liveStats}>
      <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#1a3a1a]">
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Visitor ID
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Label
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Max Score
              </th>
              <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                Views
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Excluded At
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
                class="border-b border-[#0d1a0d]"
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
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {(r.label as string) ?? "-"}
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {(r.max_bot_score as number) ?? "-"}
                </td>
                <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                  {r.pageviews as number}
                </td>
                <td class="px-4 py-1.5 text-[#1a5a1a]">
                  {(r.created_at as string).slice(0, 16)}
                </td>
                <td class="px-4 py-1.5">
                  <BotActions
                    visitorId={r.visitor_id as string}
                    isExcluded
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p class="text-[#1a5a1a] text-sm mt-4">No excluded visitors.</p>
      )}
    </AdminNav>
  );
});
