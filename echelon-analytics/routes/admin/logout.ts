import { define } from "../../utils.ts";
import { deleteSession } from "../../lib/session.ts";
import { getCookie } from "../../lib/cookie.ts";

export const handler = define.handlers({
  GET(ctx) {
    // Destroy server-side session
    const session = getCookie(ctx.req.headers.get("cookie"), "echelon_session");
    if (session) deleteSession(session);

    const headers = new Headers({ location: "/admin/login" });
    headers.append(
      "set-cookie",
      "echelon_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0",
    );
    return new Response(null, { status: 303, headers });
  },
});
