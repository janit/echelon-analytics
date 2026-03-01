import { define } from "../../utils.ts";
import { AUTH_USERNAME, constantTimeEquals, SECRET } from "../../lib/config.ts";
import { getSession } from "../../lib/session.ts";
import { validateSiteId } from "../../lib/config.ts";

import { getCookie } from "../../lib/cookie.ts";

/** Auth for admin pages — Bearer token or echelon_session cookie. */
export const handler = define.handlers([
  (ctx) => {
    const url = new URL(ctx.req.url);

    // Login/logout pages are always accessible
    if (
      url.pathname === "/admin/login" ||
      url.pathname === "/admin/logout"
    ) {
      return ctx.next();
    }

    // No auth configured — redirect to login with configuration message
    if (!SECRET && !AUTH_USERNAME) {
      return new Response(null, {
        status: 303,
        headers: {
          location: "/admin/login?error=auth_not_configured",
        },
      });
    }

    const cookie = ctx.req.headers.get("cookie");

    // Check Bearer header (API token)
    if (SECRET) {
      const auth = ctx.req.headers.get("authorization");
      if (
        auth && auth.startsWith("Bearer ") &&
        constantTimeEquals(auth.slice(7), SECRET)
      ) {
        ctx.state.isAuthenticated = true;
        return ctx.next();
      }
    }

    // Check echelon_session cookie (login form auth — random session token)
    if (AUTH_USERNAME) {
      const session = getCookie(cookie, "echelon_session");
      if (session && getSession(session) !== undefined) {
        ctx.state.isAuthenticated = true;

        // CSRF protection for mutating requests (L1)
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

    // Redirect to login page
    return new Response(null, {
      status: 303,
      headers: { location: "/admin/login" },
    });
  },
  // Sticky site selector — persist selected site_id in a cookie
  async (ctx) => {
    const url = new URL(ctx.req.url);
    const paramSite = url.searchParams.get("site_id");
    const cookieSite = getCookie(ctx.req.headers.get("cookie"), "echelon_site");

    // Query param wins, then cookie, then "default"
    const siteId = validateSiteId(paramSite ?? cookieSite ?? "default");
    ctx.state.siteId = siteId;

    const resp = await ctx.next();

    // Set/update cookie when site was explicitly chosen via query param
    if (paramSite && paramSite !== cookieSite) {
      resp.headers.append(
        "Set-Cookie",
        `echelon_site=${
          encodeURIComponent(siteId)
        }; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      );
    }

    return resp;
  },
]);
