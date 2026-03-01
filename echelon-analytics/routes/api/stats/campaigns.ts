import { define } from "../../../utils.ts";
import { getCampaignDetail, getCampaignStats } from "../../../lib/stats.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const url = new URL(ctx.req.url);
    const days = Math.min(
      90,
      Math.max(1, parseInt(url.searchParams.get("days") ?? "30")),
    );
    const campaignId = url.searchParams.get("id") ?? undefined;

    if (campaignId) {
      // Detailed stats for a specific campaign
      const campaign = await db.queryOne<{
        id: string;
        utm_campaign: string;
        site_id: string;
      }>(
        `SELECT id, utm_campaign, site_id FROM utm_campaigns WHERE id = ?`,
        campaignId,
      );
      if (!campaign) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      const detail = await getCampaignDetail(
        db,
        campaign.utm_campaign,
        campaign.site_id,
        days,
      );
      return Response.json({ campaign_id: campaignId, ...detail });
    }

    // Summary stats for all campaigns
    const stats = await getCampaignStats(db, days);
    return Response.json(stats);
  },
});
