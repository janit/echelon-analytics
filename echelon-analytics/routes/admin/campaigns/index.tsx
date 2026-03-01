import { page } from "fresh";
import { define } from "../../../utils.ts";
import { AdminNav } from "../../../components/AdminNav.tsx";
import { getLiveStats } from "../../../lib/admin-stats.ts";
import { getCampaignStats } from "../../../lib/stats.ts";
import CampaignForm from "../../../islands/CampaignForm.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const campaigns = await db.query<Record<string, unknown>>(
      `SELECT * FROM utm_campaigns ORDER BY created_at DESC`,
    );
    const stats = await getCampaignStats(db, 30);
    const liveStats = await getLiveStats(db);
    ctx.state.pageData = { campaigns, stats, liveStats };
    return page();
  },
});

export default define.page<typeof handler>(function CampaignsPage({ state }) {
  const { campaigns, stats, liveStats } = state.pageData;

  // Build a lookup of stats by campaign id
  const statsById = new Map<string, { views: number; visitors: number }>();
  for (const s of stats) {
    statsById.set(s.id, { views: s.views, visitors: s.visitors });
  }

  return (
    <AdminNav title="Campaigns" liveStats={liveStats}>
      <div class="bg-[#111] border border-[#1a3a1a] p-4 mb-4">
        <h3 class="text-sm text-[#33ff33] mb-2">Create Campaign</h3>
        <CampaignForm />
      </div>

      <h3 class="text-sm text-[#33ff33] mb-2">
        All Campaigns ({campaigns.length})
      </h3>
      <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#1a3a1a]">
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">ID</th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">Name</th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                utm_campaign
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Site
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Status
              </th>
              <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                Views
              </th>
              <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                Visitors
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const cId = c.id as string;
              const s = statsById.get(cId);
              return (
                <tr key={cId} class="border-b border-[#0d1a0d]">
                  <td class="px-4 py-1.5">
                    <a
                      href={`/admin/campaigns/${encodeURIComponent(cId)}`}
                      class="text-[#33ff33] hover:text-[#66ff66]"
                    >
                      {cId}
                    </a>
                  </td>
                  <td class="px-4 py-1.5 text-[#1a9a1a]">
                    {c.name as string}
                  </td>
                  <td class="px-4 py-1.5 text-[#1a9a1a]">
                    {c.utm_campaign as string}
                  </td>
                  <td class="px-4 py-1.5 text-[#1a5a1a]">
                    {c.site_id as string}
                  </td>
                  <td class="px-4 py-1.5">
                    <StatusBadge status={c.status as string} />
                  </td>
                  <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                    {s?.views ?? 0}
                  </td>
                  <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                    {s?.visitors ?? 0}
                  </td>
                  <td class="px-4 py-1.5 text-[#1a5a1a]">
                    {(c.created_at as string).slice(0, 10)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {campaigns.length === 0 && (
        <p class="text-[#1a5a1a] text-sm">No campaigns yet.</p>
      )}
    </AdminNav>
  );
});

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "text-[#33ff33] border-[#33ff33]",
    paused: "text-[#ffaa00] border-[#ffaa00]",
    archived: "text-[#1a5a1a] border-[#1a5a1a]",
  };
  return (
    <span
      class={`text-xs px-1.5 py-0.5 border ${
        colors[status] ?? "text-[#1a9a1a] border-[#1a3a1a]"
      }`}
    >
      {status}
    </span>
  );
}
