import { define } from "../utils.ts";
import { handleBeacon, PIXEL } from "../lib/beacon.ts";
import {
  corsHeaders,
  isAllowedOrigin,
  isAllowedReferer,
} from "./_middleware.ts";
import { ALLOWED_ORIGINS } from "../lib/config.ts";
import { isRateLimited } from "../lib/rate-limit.ts";

export const handler = define.handlers({
  async GET(ctx) {
    // Rate limit check — drop early
    if (isRateLimited(ctx.req)) {
      return new Response(PIXEL, {
        headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
      });
    }

    // Image requests use Referer, not Origin
    if (ALLOWED_ORIGINS.size > 0) {
      const referer = ctx.req.headers.get("referer");
      const origin = ctx.req.headers.get("origin");
      if (!isAllowedOrigin(origin) && !isAllowedReferer(referer)) {
        return new Response(PIXEL, {
          headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
        });
      }
    }

    const resp = await handleBeacon(ctx.req, ctx.state.db);
    const headers = corsHeaders(ctx.req);
    for (const [k, v] of resp.headers) headers.set(k, v);
    return new Response(resp.body, { status: resp.status, headers });
  },
});
