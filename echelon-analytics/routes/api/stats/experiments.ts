import { define } from "../../../utils.ts";
import { getExperimentStats } from "../../../lib/stats.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const experimentId = url.searchParams.get("experiment_id") ?? undefined;
    return Response.json(
      await getExperimentStats(ctx.state.db, experimentId),
    );
  },
});
