import { define } from "../../../utils.ts";
import { getRealtime } from "../../../lib/stats.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const siteId = url.searchParams.get("site_id");
    if (!siteId) {
      return Response.json(
        { error: "missing_param", message: "site_id required" },
        { status: 400 },
      );
    }
    return Response.json(await getRealtime(ctx.state.db, siteId));
  },
});
