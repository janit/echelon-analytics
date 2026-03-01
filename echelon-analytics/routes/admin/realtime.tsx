import { page } from "fresh";
import { define } from "../../utils.ts";
import { AdminNav } from "../../components/AdminNav.tsx";
import { getLiveStats } from "../../lib/admin-stats.ts";
import RealtimePanel from "../../islands/RealtimePanel.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const siteId = ctx.state.siteId;
    const liveStats = await getLiveStats(ctx.state.db);
    const sites = await ctx.state.db.query<{ site_id: string }>(
      `SELECT DISTINCT site_id FROM visitor_views ORDER BY site_id`,
    );
    const knownSites = sites.map((s: { site_id: string }) => s.site_id);
    if (!knownSites.includes(siteId)) knownSites.unshift(siteId);
    ctx.state.pageData = { siteId, liveStats, knownSites };
    return page();
  },
});

export default define.page<typeof handler>(function RealtimePage({ state }) {
  const { siteId, liveStats, knownSites } = state.pageData;
  return (
    <AdminNav
      title="Realtime"
      liveStats={liveStats}
      siteSelector={{ knownSites, siteId }}
    >
      <RealtimePanel siteId={siteId as string} />
    </AdminNav>
  );
});
