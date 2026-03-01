// Echelon Analytics — Centralized Configuration

export const VERSION = Deno.env.get("VERSION") ?? "dev";
export const PORT = parseInt(Deno.env.get("ECHELON_PORT") ?? "1947");
export const DB_PATH = Deno.env.get("ECHELON_DB_PATH") ?? "./echelon.db";
export const SECRET = Deno.env.get("ECHELON_SECRET") ?? "";
export const RETENTION_DAYS = parseInt(
  Deno.env.get("ECHELON_RETENTION_DAYS") ?? "90",
);

export const SUSPECT_COUNTRIES = new Set(
  (Deno.env.get("ECHELON_SUSPECT_COUNTRIES") ?? "CN")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);

export const SUSPECT_POINTS =
  parseInt(Deno.env.get("ECHELON_SUSPECT_POINTS") ?? "", 10) || 30;

// Bot score threshold — views/events with score >= this are discarded entirely (not stored).
// Set to 0 to disable (store everything, filter at query time).
// Default 0 = keep all, filter in rollups. Set to e.g. 50 to drop high-score traffic.
export const BOT_DISCARD_THRESHOLD =
  parseInt(Deno.env.get("ECHELON_BOT_DISCARD_THRESHOLD") ?? "", 10) || 0;

// Challenge PoW — how many past minutes of challenges to accept as valid.
// With max-age=300 (5 min) on /ea.js, 10 min covers cache TTL + clock skew.
export const CHALLENGE_WINDOW_MINUTES = parseInt(
  Deno.env.get("ECHELON_CHALLENGE_WINDOW_MINUTES") ?? "10",
);

// Buffered writer intervals (milliseconds)
export const VIEW_FLUSH_MS = parseInt(
  Deno.env.get("ECHELON_VIEW_FLUSH_MS") ?? "15000",
); // default 15s
export const EVENT_FLUSH_MS = parseInt(
  Deno.env.get("ECHELON_EVENT_FLUSH_MS") ?? "10000",
); // default 10s

// Allowed origins/sites for tracking — comma-separated list of domains
// e.g. "islets.app,www.islets.app,afroute.com,zambia.afroute.com,maroc.afroute.com"
// Empty = accept all (open mode). When set, only these domains can send tracking data.
export const ALLOWED_ORIGINS: Set<string> = (() => {
  const raw = Deno.env.get("ECHELON_ALLOWED_ORIGINS") ?? "";
  const domains = raw.split(",").map((s) => s.trim().toLowerCase()).filter(
    Boolean,
  );
  return new Set(domains);
})();

// Rate limiting — max requests per IP per window (tracking endpoints only)
// Set to 0 to disable. Default: 100 requests per 60 seconds.
export const RATE_LIMIT_MAX =
  parseInt(Deno.env.get("ECHELON_RATE_LIMIT_MAX") ?? "", 10) || 100;
export const RATE_LIMIT_WINDOW_MS =
  parseInt(Deno.env.get("ECHELON_RATE_LIMIT_WINDOW_MS") ?? "", 10) || 60_000;

// Known bot User-Agent substrings — requests matching these are dropped (not tracked at all).
// Comma-separated. Matching is case-insensitive.
export const BOT_UA_PATTERNS: string[] = (() => {
  const defaults =
    "Googlebot,Bingbot,bingbot,Slurp,DuckDuckBot,Baiduspider,YandexBot," +
    "Sogou,Exabot,facebot,facebookexternalhit,ia_archiver," +
    "Applebot,AdsBot-Google,Mediapartners-Google,APIs-Google," +
    "AhrefsBot,SemrushBot,MJ12bot,DotBot,PetalBot,BLEXBot," +
    "GPTBot,ChatGPT-User,OAI-SearchBot,ClaudeBot,Claude-Web," +
    "Bytespider,CCBot,DataForSeoBot,Amazonbot,anthropic-ai," +
    "PerplexityBot,YouBot,Scrapy,curl,wget,python-requests,Go-http-client,HeadlessChrome";
  const raw = Deno.env.get("ECHELON_BOT_UA_PATTERNS") ?? defaults;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
})();

// Per-site suspect country overrides — format: "site_id:CC,CC;site_id:CC"
// e.g. "maroc.afroute.com:CN,RU;zambia.afroute.com:CN"
// These add extra bot score points (SUSPECT_POINTS) for the specified countries
// ON TOP of the global SUSPECT_COUNTRIES list.
export const SITE_SUSPECT_COUNTRIES: Map<string, Set<string>> = (() => {
  const raw = Deno.env.get("ECHELON_SITE_SUSPECT_COUNTRIES") ?? "";
  const map = new Map<string, Set<string>>();
  if (!raw) return map;
  for (const entry of raw.split(";")) {
    const [site, countries] = entry.split(":");
    if (!site || !countries) continue;
    const set = new Set(
      countries.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    );
    if (set.size > 0) map.set(site.trim().toLowerCase(), set);
  }
  return map;
})();

// Auth — username + PBKDF2 password hash
// Generate: deno eval "import{hashPassword}from'./lib/auth.ts';console.log(await hashPassword('yourpassword'))"
export const AUTH_USERNAME = Deno.env.get("ECHELON_USERNAME") ?? "";
export const AUTH_PASSWORD_HASH = Deno.env.get("ECHELON_PASSWORD_HASH") ?? "";

/** Constant-time string comparison to prevent timing attacks. */
export function constantTimeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  // Prefer Deno's native timingSafeEqual when available, fall back to manual XOR
  const subtle = crypto.subtle as unknown as {
    timingSafeEqual?(a: BufferSource, b: BufferSource): boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(bufA, bufB);
  }
  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

/** Validate a site ID: max 64 chars, alphanumeric + ._-  Defaults to "default". */
export function validateSiteId(raw: string): string {
  return raw.length <= 64 && /^[a-zA-Z0-9._-]+$/.test(raw) ? raw : "default";
}

// Site IDs to silently ignore (never store views/events).
// Comma-separated. Always includes "smoke-test" to filter deploy smoke tests.
export const IGNORED_SITES: Set<string> = (() => {
  const raw = Deno.env.get("ECHELON_IGNORED_SITES") ?? "";
  const sites = raw.split(",").map((s) => s.trim().toLowerCase()).filter(
    Boolean,
  );
  sites.push("smoke-test");
  return new Set(sites);
})();

// Trust proxy headers (X-Forwarded-For, X-Real-IP) for real client IP.
// Set to "true" when behind a trusted reverse proxy (Nginx, Caddy, etc.)
export const TRUST_PROXY = Deno.env.get("ECHELON_TRUST_PROXY") === "true";

// Cookie consent banner — when true and data-cookie is set on the script tag,
// a small consent banner is shown before setting the visitor cookie.
// Set to "true" to enable. When false, data-cookie sets the cookie without asking.
export const COOKIE_CONSENT = Deno.env.get("ECHELON_COOKIE_CONSENT") === "true";

// Explicit Cloudflare mode — only trust CF headers when enabled.
// When false, cf-ray/cf-connecting-ip/cf-ipcountry/cf-bot-score headers are ignored.
export const BEHIND_CLOUDFLARE =
  Deno.env.get("ECHELON_BEHIND_CLOUDFLARE") === "true";

// Trust generic geo headers (cloudfront-viewer-country, x-country-code).
// Set to "true" when behind CloudFront or a proxy that sets these headers.
// When false, only cf-ipcountry is used (requires BEHIND_CLOUDFLARE).
export const TRUST_GEO_HEADERS =
  Deno.env.get("ECHELON_TRUST_GEO_HEADERS") === "true";
