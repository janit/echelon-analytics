import { define } from "../../utils.ts";
import { AUTH_USERNAME, constantTimeEquals, SECRET } from "../../lib/config.ts";
import { getSession } from "../../lib/session.ts";
import { getCookie } from "../../lib/cookie.ts";

/** Auth for /api/* routes — Bearer token or session cookie. */
export const handler = define.handlers([
  (ctx) => {
    const url = new URL(ctx.req.url);

    // Health, beacon, events, and tracker are public
    if (
      url.pathname === "/api/health" ||
      url.pathname === "/b.gif" ||
      url.pathname === "/e" ||
      url.pathname === "/ea.js"
    ) {
      return ctx.next();
    }

    // Check Bearer header (constant-time comparison)
    if (SECRET) {
      const auth = ctx.req.headers.get("authorization");
      if (auth && auth.startsWith("Bearer ")) {
        const token = auth.slice(7);
        if (constantTimeEquals(token, SECRET)) {
          ctx.state.isAuthenticated = true;
          return ctx.next();
        }
      }
    }

    // Check echelon_session cookie (allows islands to call API routes)
    if (AUTH_USERNAME) {
      const session = getCookie(
        ctx.req.headers.get("cookie"),
        "echelon_session",
      );
      if (session && getSession(session) !== undefined) {
        ctx.state.isAuthenticated = true;

        // CSRF protection for cookie-based auth on mutating requests
        const method = ctx.req.method;
        if (method === "POST" || method === "PATCH" || method === "DELETE") {
          const origin = ctx.req.headers.get("origin");
          const referer = ctx.req.headers.get("referer");
          const requestOrigin = url.origin;

          let originMatch = false;
          if (origin) {
            originMatch = origin === requestOrigin;
          } else if (referer) {
            try {
              originMatch = new URL(referer).origin === requestOrigin;
            } catch {
              originMatch = false;
            }
          }

          if (!originMatch) {
            return Response.json(
              { error: "CSRF validation failed — origin mismatch" },
              { status: 403 },
            );
          }
        }

        return ctx.next();
      }
    }

    if (!SECRET && !AUTH_USERNAME) {
      return Response.json(
        { error: "unauthorized", message: "Auth must be configured" },
        { status: 401 },
      );
    }

    return Response.json({ error: "unauthorized" }, { status: 401 });
  },
]);
