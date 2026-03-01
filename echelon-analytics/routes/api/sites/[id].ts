import { define } from "../../../utils.ts";
import { validateSiteId } from "../../../lib/config.ts";
import { markConsentCssStale } from "../../../lib/consent-css.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const siteId = validateSiteId(decodeURIComponent(ctx.params.id));
    const row = await ctx.state.db.queryOne<{ consent_css: string | null }>(
      `SELECT consent_css FROM site_settings WHERE site_id = ?`,
      siteId,
    );
    return Response.json({
      site_id: siteId,
      consent_css: row?.consent_css ?? null,
    });
  },

  async PATCH(ctx) {
    const db = ctx.state.db;
    const siteId = validateSiteId(decodeURIComponent(ctx.params.id));

    let body: Record<string, unknown>;
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const css = typeof body.consent_css === "string"
      ? body.consent_css.slice(0, 4096)
      : null;

    await db.run(
      `INSERT INTO site_settings (site_id, consent_css, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(site_id) DO UPDATE SET
         consent_css = excluded.consent_css,
         updated_at = excluded.updated_at`,
      siteId,
      css,
    );

    markConsentCssStale();
    return Response.json({ updated: siteId });
  },
});
