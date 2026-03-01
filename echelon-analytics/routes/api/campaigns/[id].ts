import { define } from "../../../utils.ts";
import { markStale, refreshUtmCampaigns } from "../../../lib/utm.ts";

const VALID_STATUSES = new Set(["active", "paused", "archived"]);

export const handler = define.handlers({
  async PATCH(ctx) {
    const db = ctx.state.db;
    const campaignId = decodeURIComponent(ctx.params.id).slice(0, 128);

    let body: Record<string, unknown>;
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const { status } = body;
    if (!status || !VALID_STATUSES.has(status as string)) {
      return Response.json(
        {
          error: "invalid_payload",
          message: "Invalid status. Must be one of: " +
            [...VALID_STATUSES].join(", "),
        },
        { status: 400 },
      );
    }

    const result = await db.run(
      `UPDATE utm_campaigns SET status = ? WHERE id = ?`,
      status as string,
      campaignId,
    );

    if (result.changes === 0) {
      return Response.json(
        { error: "not_found", message: "Campaign not found" },
        { status: 404 },
      );
    }

    markStale();
    await refreshUtmCampaigns(db);
    return Response.json({ updated: campaignId });
  },

  async DELETE(ctx) {
    const db = ctx.state.db;
    const campaignId = decodeURIComponent(ctx.params.id).slice(0, 128);

    const result = await db.run(
      `DELETE FROM utm_campaigns WHERE id = ?`,
      campaignId,
    );

    if (result.changes === 0) {
      return Response.json(
        { error: "not_found", message: "Campaign not found" },
        { status: 404 },
      );
    }

    markStale();
    await refreshUtmCampaigns(db);
    return Response.json({ deleted: campaignId });
  },
});
