import { page } from "fresh";
import { define } from "../../utils.ts";
import {
  AUTH_PASSWORD_HASH,
  AUTH_USERNAME,
  constantTimeEquals,
  VERSION,
} from "../../lib/config.ts";
import { verifyPassword } from "../../lib/auth.ts";
import { createSession } from "../../lib/session.ts";
import { getClientIp } from "../../lib/ip.ts";

// --- Login rate limiting ---
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5;

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();

// GC stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

function isRateLimited(ip: string): boolean {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.attempts >= RATE_LIMIT_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(ip, { attempts: 1, firstAttempt: now });
  } else {
    entry.attempts++;
  }
}

export const handler = define.handlers({
  GET(_ctx) {
    _ctx.state.pageData = {
      error: false,
      rateLimited: false,
      version: VERSION,
    };
    return page();
  },

  async POST(ctx) {
    const ip = getClientIp(ctx.req);

    // Check rate limit before processing
    if (isRateLimited(ip)) {
      ctx.state.pageData = {
        error: false,
        rateLimited: true,
        version: VERSION,
      };
      return page();
    }

    const form = await ctx.req.formData();
    const username = (form.get("username") as string) ?? "";
    const password = (form.get("password") as string) ?? "";

    if (
      constantTimeEquals(username, AUTH_USERNAME) &&
      await verifyPassword(password, AUTH_PASSWORD_HASH)
    ) {
      const { token } = createSession(username);
      const headers = new Headers({ location: "/admin" });
      headers.append(
        "set-cookie",
        `echelon_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400`,
      );
      return new Response(null, { status: 303, headers });
    }

    // Record failed attempt for rate limiting
    recordFailedAttempt(ip);

    ctx.state.pageData = { error: true, rateLimited: false, version: VERSION };
    return page();
  },
});

export default define.page<typeof handler>(function LoginPage({ state }) {
  const data = state.pageData as {
    error: boolean;
    rateLimited: boolean;
    version: string;
  };
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login — Echelon Analytics</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body class="flex items-center justify-center min-h-screen">
        <div
          class="w-full max-w-sm p-6 border border-[#1a3a1a]"
          style="background:#111"
        >
          <h1 class="text-lg font-semibold text-[#33ff33] mb-4">
            <a
              href="https://ea.js.org/"
              target="_blank"
              rel="noopener"
              class="hover:underline"
            >
              Echelon Analytics
            </a>
          </h1>
          {data.rateLimited && (
            <p
              class="text-sm text-[#ff3333] mb-3 border border-[#661111] px-3 py-1.5"
              style="background:#1a0a0a"
            >
              RATE LIMITED — Too many failed attempts. Try again later.
            </p>
          )}
          {data.error && (
            <p
              class="text-sm text-[#ff3333] mb-3 border border-[#661111] px-3 py-1.5"
              style="background:#1a0a0a"
            >
              ACCESS DENIED — Invalid credentials.
            </p>
          )}
          <form method="POST">
            <label class="block text-sm text-[#1a9a1a] mb-1">username</label>
            <input
              type="text"
              name="username"
              required
              class="w-full border border-[#1a3a1a] px-3 py-2 text-sm mb-3 bg-[#0a0a0a] text-[#33ff33] focus:outline-none focus:border-[#33ff33]"
            />
            <label class="block text-sm text-[#1a9a1a] mb-1">password</label>
            <input
              type="password"
              name="password"
              required
              class="w-full border border-[#1a3a1a] px-3 py-2 text-sm mb-4 bg-[#0a0a0a] text-[#33ff33] focus:outline-none focus:border-[#33ff33]"
            />
            <button
              type="submit"
              class="w-full border border-[#33ff33] text-[#33ff33] px-4 py-2 text-sm hover:bg-[#33ff33] hover:text-[#0a0a0a]"
            >
              &gt; authenticate
            </button>
          </form>
          <p class="mt-4 text-xs text-[#1a5a1a] text-center">
            <a
              href="https://ea.js.org/"
              target="_blank"
              rel="noopener"
              class="hover:text-[#33ff33]"
            >
              Echelon Analytics
            </a>{" "}
            {data.version}
          </p>
        </div>
      </body>
    </html>
  );
});
