/** Parse a named cookie from a Cookie header string. */
export function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const [k, ...rest] = pair.split("=");
    if (k.trim() === name) return rest.join("=").trim();
  }
  return null;
}

/** Parse a named cookie from a Request. */
export function getRequestCookie(req: Request, name: string): string | null {
  return getCookie(req.headers.get("cookie"), name);
}
