import { define } from "../utils.ts";
import { handleTracker } from "../lib/tracker.ts";
import { corsHeaders, isAllowedReferer } from "./_middleware.ts";
import { ALLOWED_ORIGINS } from "../lib/config.ts";

export const handler = define.handlers({
  async GET(ctx) {
    // Optionally restrict which sites can load the tracker script
    if (ALLOWED_ORIGINS.size > 0) {
      const referer = ctx.req.headers.get("referer");
      if (referer && !isAllowedReferer(referer)) {
        return new Response("// blocked", {
          status: 403,
          headers: { "Content-Type": "application/javascript" },
        });
      }
    }

    const resp = await handleTracker(ctx.req);
    const headers = corsHeaders(ctx.req);
    for (const [k, v] of resp.headers) headers.set(k, v);
    return new Response(resp.body, { status: 200, headers });
  },
});
