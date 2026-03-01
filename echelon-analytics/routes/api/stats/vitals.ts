import { define } from "../../../utils.ts";
import { getRequestStats } from "../../../lib/request-stats.ts";

export const handler = define.handlers({
  GET() {
    return Response.json(getRequestStats());
  },
});
