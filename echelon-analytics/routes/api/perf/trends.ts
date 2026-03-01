import { define } from "../../../utils.ts";
import { getTrends } from "../../../lib/perf.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "30");
    const since = url.searchParams.get("since") ?? undefined;
    const trends = await getTrends(ctx.state.db, { limit, since });
    return Response.json(trends);
  },
});
