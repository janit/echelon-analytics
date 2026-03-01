import { define } from "../utils.ts";
import { ALLOWED_ORIGINS } from "../lib/config.ts";

/**
 * Check whether a request origin is allowed.
 * If ALLOWED_ORIGINS is empty, all origins are accepted (open mode).
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (ALLOWED_ORIGINS.size === 0) return true;
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return ALLOWED_ORIGINS.has(hostname);
  } catch {
    return false;
  }
}

/** Check whether a request's Referer header matches an allowed origin. */
export function isAllowedReferer(referer: string | null): boolean {
  if (!referer) return false;
  try {
    const hostname = new URL(referer).hostname.toLowerCase();
    return ALLOWED_ORIGINS.has(hostname);
  } catch {
    return false;
  }
}

/** CORS preflight handler — returns 204 for OPTIONS requests. */
export const handler = define.handlers([
  (ctx) => {
    if (ctx.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(ctx.req),
      });
    }
    return ctx.next();
  },
]);

export function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin");
  const headers = new Headers();

  if (ALLOWED_ORIGINS.size > 0) {
    // Restricted mode: only reflect allowed origins, enable credentials
    if (isAllowedOrigin(origin)) {
      headers.set("Access-Control-Allow-Origin", origin!);
      headers.set("Access-Control-Allow-Credentials", "true");
    } else {
      headers.set("Access-Control-Allow-Origin", "null");
    }
  } else {
    // Open mode: reflect origin (sendBeacon sends credentials, which
    // requires a specific origin — wildcard '*' is rejected by browsers)
    if (origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Credentials", "true");
    } else {
      headers.set("Access-Control-Allow-Origin", "*");
    }
  }

  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}
