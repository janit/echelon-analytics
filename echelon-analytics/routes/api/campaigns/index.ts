import { define } from "../../../utils.ts";
import { refreshUtmCampaigns } from "../../../lib/utm.ts";

const ID_RE = /^[a-zA-Z0-9._-]+$/;

export const handler = define.handlers({
  async GET(ctx) {
    const rows = await ctx.state.db.query(
      `SELECT * FROM utm_campaigns ORDER BY created_at DESC`,
    );
    return Response.json(rows);
  },

  async POST(ctx) {
    const db = ctx.state.db;
    let body: Record<string, unknown>;
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const { id, name, utm_campaign, site_id } = body;
    if (!id || !name || !utm_campaign) {
      return Response.json(
        {
          error: "invalid_payload",
          message: "Missing required fields: id, name, utm_campaign",
        },
        { status: 400 },
      );
    }

    const cId = String(id).slice(0, 128);
    if (!ID_RE.test(cId)) {
      return Response.json(
        {
          error: "invalid_id",
          message: "ID must be alphanumeric with ._- only",
        },
        { status: 400 },
      );
    }

    const cName = String(name).slice(0, 256);
    // deno-lint-ignore no-control-regex
    const cUtm = String(utm_campaign).slice(0, 256).replace(/[\x00-\x1f]/g, "");
    const cSite = site_id ? String(site_id).slice(0, 64) : "default";

    try {
      await db.run(
        `INSERT INTO utm_campaigns (id, name, utm_campaign, site_id)
         VALUES (?, ?, ?, ?)`,
        cId,
        cName,
        cUtm,
        cSite,
      );

      await refreshUtmCampaigns(db);
      return Response.json({ created: cId }, { status: 201 });
    } catch {
      return Response.json(
        {
          error: "conflict",
          message:
            "Campaign creation failed (duplicate id or utm_campaign+site_id)",
        },
        { status: 409 },
      );
    }
  },
});
