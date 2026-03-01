import { page } from "fresh";
import { define } from "../../../utils.ts";
import { AdminNav } from "../../../components/AdminNav.tsx";
import { getLiveStats } from "../../../lib/admin-stats.ts";
import { getCampaignDetail, getCampaignStats } from "../../../lib/stats.ts";
import CampaignActions from "../../../islands/CampaignActions.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const campaignId = decodeURIComponent(ctx.params.id);

    const campaign = await db.queryOne<Record<string, unknown>>(
      `SELECT * FROM utm_campaigns WHERE id = ?`,
      campaignId,
    );

    if (!campaign) {
      return new Response("Campaign not found", { status: 404 });
    }

    const detail = await getCampaignDetail(
      db,
      campaign.utm_campaign as string,
      campaign.site_id as string,
      30,
    );

    const liveStats = await getLiveStats(db);
    const summaryArr = await getCampaignStats(db, 30, campaignId);
    const summary = summaryArr[0] ?? { views: 0, visitors: 0 };

    ctx.state.pageData = { campaign, detail, summary, liveStats };
    return page();
  },
});

export default define.page<typeof handler>(function CampaignDetailPage({
  state,
}) {
  const { campaign: c, detail, summary, liveStats } = state.pageData;
  const cId = c.id as string;

  return (
    <AdminNav title={c.name as string} liveStats={liveStats}>
      <div class="flex gap-2 mb-3">
        <span
          class={`text-xs px-2 py-1 border ${
            statusColors[c.status as string] ??
              "border-[#1a3a1a] text-[#1a9a1a]"
          }`}
        >
          {c.status as string}
        </span>
        <span class="bg-[#1a3a1a] text-[#33ff33] text-xs px-2 py-1">
          utm_campaign: {c.utm_campaign as string}
        </span>
        <span class="bg-[#1a3a1a] text-[#33ff33] text-xs px-2 py-1">
          site: {c.site_id as string}
        </span>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div class="bg-[#111] border border-[#1a3a1a] p-3">
          <div class="text-xs text-[#1a5a1a] mb-1">Views (30d)</div>
          <div class="text-xl tabular-nums text-[#33ff33]">
            {summary.views ?? 0}
          </div>
        </div>
        <div class="bg-[#111] border border-[#1a3a1a] p-3">
          <div class="text-xs text-[#1a5a1a] mb-1">Visitors (30d)</div>
          <div class="text-xl tabular-nums text-[#33ff33]">
            {summary.visitors ?? 0}
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 mb-4">
        {c.status === "active" && (
          <StatusButton
            campaignId={cId}
            status="paused"
            label="> pause"
            cls="border-[#ffaa00] text-[#ffaa00] hover:bg-[#ffaa00] hover:text-[#0a0a0a]"
          />
        )}
        {c.status === "active" && (
          <StatusButton
            campaignId={cId}
            status="archived"
            label="> archive"
            cls="border-[#1a5a1a] text-[#1a5a1a] hover:bg-[#1a5a1a] hover:text-[#0a0a0a]"
          />
        )}
        {c.status === "paused" && (
          <>
            <StatusButton
              campaignId={cId}
              status="active"
              label="> resume"
              cls="border-[#33ff33] text-[#33ff33] hover:bg-[#33ff33] hover:text-[#0a0a0a]"
            />
            <StatusButton
              campaignId={cId}
              status="archived"
              label="> archive"
              cls="border-[#1a5a1a] text-[#1a5a1a] hover:bg-[#1a5a1a] hover:text-[#0a0a0a]"
            />
          </>
        )}
        {c.status === "archived" && (
          <StatusButton
            campaignId={cId}
            status="active"
            label="> reactivate"
            cls="border-[#33ff33] text-[#33ff33] hover:bg-[#33ff33] hover:text-[#0a0a0a]"
          />
        )}
        <button
          type="button"
          class="px-3 py-1.5 text-xs border border-[#ff3333] text-[#ff3333] hover:bg-[#ff3333] hover:text-[#0a0a0a]"
          data-campaign-id={cId}
          data-action="delete"
        >
          {">"} delete
        </button>
      </div>

      <h3 class="text-xs text-[#1a5a1a] mb-3">Last 30 days</h3>

      {/* Sources */}
      {detail.bySource.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">By Source</h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Source
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
                {detail.bySource.map(
                  (
                    s: { utm_source: string; views: number; visitors: number },
                  ) => (
                    <tr key={s.utm_source} class="border-b border-[#0d1a0d]">
                      <td class="px-4 py-1.5 text-[#1a9a1a]">
                        {s.utm_source}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {s.views}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {s.visitors}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Mediums */}
      {detail.byMedium.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">By Medium</h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Medium
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
                {detail.byMedium.map(
                  (
                    m: { utm_medium: string; views: number; visitors: number },
                  ) => (
                    <tr key={m.utm_medium} class="border-b border-[#0d1a0d]">
                      <td class="px-4 py-1.5 text-[#1a9a1a]">
                        {m.utm_medium}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {m.views}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {m.visitors}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Content */}
      {detail.byContent.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">By Content</h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Content
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Views
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.byContent.map(
                  (ct: { utm_content: string; views: number }) => (
                    <tr key={ct.utm_content} class="border-b border-[#0d1a0d]">
                      <td class="px-4 py-1.5 text-[#1a9a1a]">
                        {ct.utm_content}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {ct.views}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Term */}
      {detail.byTerm.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">By Term</h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Term
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Views
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.byTerm.map(
                  (t: { utm_term: string; views: number }) => (
                    <tr key={t.utm_term} class="border-b border-[#0d1a0d]">
                      <td class="px-4 py-1.5 text-[#1a9a1a]">
                        {t.utm_term}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {t.views}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Top Landing Pages */}
      {detail.topPaths.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">Top Landing Pages</h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
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
                {detail.topPaths.map(
                  (p: { path: string; views: number; visitors: number }) => (
                    <tr key={p.path} class="border-b border-[#0d1a0d]">
                      <td class="px-4 py-1.5 text-[#1a9a1a]">{p.path}</td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {p.views}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {p.visitors}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Daily Trend */}
      {detail.dailyTrend.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">Daily Trend</h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Date
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
                {detail.dailyTrend.map(
                  (d: { date: string; views: number; visitors: number }) => (
                    <tr key={d.date} class="border-b border-[#0d1a0d]">
                      <td class="px-4 py-1.5 text-[#1a5a1a]">{d.date}</td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {d.views}
                      </td>
                      <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                        {d.visitors}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail.bySource.length === 0 && detail.dailyTrend.length === 0 && (
        <p class="text-[#1a5a1a] text-sm">No data yet for this campaign.</p>
      )}

      <div class="mt-3 text-xs text-[#1a5a1a]">
        created: {(c.created_at as string).slice(0, 16)}
      </div>
      <CampaignActions />
    </AdminNav>
  );
});

const statusColors: Record<string, string> = {
  active: "border-[#33ff33] text-[#33ff33]",
  paused: "border-[#ffaa00] text-[#ffaa00]",
  archived: "border-[#1a5a1a] text-[#1a5a1a]",
};

function StatusButton(
  { campaignId, status, label, cls }: {
    campaignId: string;
    status: string;
    label: string;
    cls: string;
  },
) {
  return (
    <button
      type="button"
      class={`px-3 py-1.5 text-xs border ${cls}`}
      data-campaign-id={campaignId}
      data-status={status}
    >
      {label}
    </button>
  );
}
