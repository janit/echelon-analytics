import { define } from "../../../../utils.ts";

export const handler = define.handlers({
  async DELETE(ctx) {
    const visitorId = decodeURIComponent(ctx.params.id).slice(0, 128);
    await ctx.state.db.run(
      `DELETE FROM excluded_visitors WHERE visitor_id = ?`,
      visitorId,
    );
    return Response.json({ included: visitorId });
  },
});
