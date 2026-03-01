import { define } from "../../../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const rows = await ctx.state.db.query(
      `SELECT ev.*, COUNT(vv.id) AS pageviews, MAX(vv.bot_score) AS max_bot_score
       FROM excluded_visitors ev
       LEFT JOIN visitor_views vv ON vv.visitor_id = ev.visitor_id
       GROUP BY ev.visitor_id
       ORDER BY ev.created_at DESC`,
    );
    return Response.json(rows);
  },
});
