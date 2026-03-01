import { define } from "../utils.ts";
import { handleEvents } from "../lib/events-endpoint.ts";
import { corsHeaders } from "./_middleware.ts";
import { isRateLimited } from "../lib/rate-limit.ts";

export const handler = define.handlers({
  async POST(ctx) {
    // Rate limit check
    if (isRateLimited(ctx.req)) {
      return new Response(null, { status: 429 });
    }

    // Origin check is intentionally omitted here:
    // - ea.js script endpoint already gates loading by origin
    // - PoW token validates the request came from a real browser
    // - sendBeacon may not always include an Origin header
    const resp = await handleEvents(ctx.req, ctx.state.db);
    const headers = corsHeaders(ctx.req);
    for (const [k, v] of resp.headers) headers.set(k, v);
    return new Response(resp.body, { status: resp.status, headers });
  },
});
