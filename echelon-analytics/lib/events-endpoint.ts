// Echelon Analytics — Semantic Events Endpoint (POST /e)
//
// Accepts behavioral events via sendBeacon (bounce, scroll_depth,
// session_end, session_resume, clicks, custom events).
// Uses buffered writes (like routemap4 pattern) for SQLite performance.

import type { DbAdapter } from "./db/adapter.ts";
import type { SemanticEvent } from "../types.ts";
import { getClientIp } from "./ip.ts";
import {
  computeBotScore,
  extractCloudflareSignals,
  getBurstCount,
  getVisitorCountry,
  hashIp,
  hashVisitor,
  isKnownBot,
} from "./bot-score.ts";
import { isExcluded } from "./beacon.ts";
import {
  BOT_DISCARD_THRESHOLD,
  EVENT_FLUSH_MS,
  IGNORED_SITES,
  validateSiteId,
} from "./config.ts";
import { tokenPenalty, verifyToken } from "./challenge.ts";
import { BufferedWriter } from "./buffered-writer.ts";
import { isUtmCampaignActive } from "./utm.ts";

interface ClientEvent {
  type: string;
  data?: Record<string, unknown>;
  sessionId?: string;
  utmCampaign?: string;
}

const MAX_EVENTS_PER_REQUEST = 20;
const MAX_BODY_BYTES = 16_384; // 16 KB
const MAX_EVENT_DATA_BYTES = 2_048; // 2 KB per event data

const ALLOWED_EVENT_TYPES = new Set([
  "bounce",
  "session_end",
  "session_resume",
  "scroll_depth",
  "click",
  "ad_click",
  "form_focus",
  "form_blur",
  "form_submit",
  "hover",
  "outbound",
  "download",
  "web_vital",
  "custom",
]);

import { getRequestCookie as getCookie } from "./cookie.ts";

// ── Buffered event writer ───────────────────────────────────────────────────

const INSERT_SQL = `INSERT INTO semantic_events
  (event_type, site_id, session_id, visitor_id, data,
   experiment_id, variant_id, utm_campaign,
   device_type, referrer, hour, month, day_of_week,
   is_returning, bot_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const eventWriter = new BufferedWriter<SemanticEvent>(
  async (db, batch) => {
    await db.transaction(async (tx) => {
      for (const ev of batch) {
        await tx.run(
          INSERT_SQL,
          ev.event_type,
          ev.site_id,
          ev.session_id,
          ev.visitor_id,
          ev.data,
          ev.experiment_id ?? null,
          ev.variant_id ?? null,
          ev.utm_campaign ?? null,
          ev.device_type,
          ev.referrer,
          ev.hour,
          ev.month,
          ev.day_of_week,
          ev.is_returning,
          ev.bot_score,
        );
      }
    });
  },
  50_000,
  EVENT_FLUSH_MS,
  "Event",
);

export function startEventWriter(db: DbAdapter): void {
  eventWriter.start(db);
}

export async function flushRemainingEvents(db: DbAdapter): Promise<void> {
  await eventWriter.stop(db);
}

export function getEventBufferSize(): number {
  return eventWriter.size;
}

// ── Request handler ─────────────────────────────────────────────────────────

export async function handleEvents(
  req: Request,
  _db: DbAdapter,
): Promise<Response> {
  // Drop known bots immediately
  if (isKnownBot(req.headers.get("user-agent") ?? undefined)) {
    return new Response(null, { status: 204 });
  }

  // Reject oversized payloads (check Content-Length before reading body)
  const contentLength = parseInt(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  if (rawBody.length === 0) {
    return new Response(null, { status: 400 });
  }

  let body: { events?: ClientEvent[]; siteId?: string; tok?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }

  const events = body.events;
  if (!Array.isArray(events) || events.length === 0) {
    return new Response(null, { status: 204 });
  }

  const siteId = validateSiteId(
    typeof body.siteId === "string" ? body.siteId : "default",
  );

  // Silently drop ignored sites (smoke tests, etc.)
  if (IGNORED_SITES.has(siteId.toLowerCase())) {
    return new Response(null, { status: 204 });
  }

  // Server-side context enrichment
  const now = new Date();
  const hour = now.getUTCHours();
  const month = now.getUTCMonth() + 1;
  const dayOfWeek = now.getUTCDay();

  // Device type from Sec-CH-UA-Mobile or UA heuristic
  const chMobile = req.headers.get("sec-ch-ua-mobile");
  let deviceType: string;
  if (chMobile === "?1") {
    deviceType = "mobile";
  } else if (chMobile === "?0") {
    deviceType = "desktop";
  } else {
    const ua = req.headers.get("user-agent") ?? "";
    deviceType = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  }

  // Referrer (origin only)
  const refHeader = req.headers.get("referer");
  let referrer: string | null = null;
  if (refHeader) {
    try {
      referrer = new URL(refHeader).origin;
    } catch { /* ignore malformed */ }
  }

  // Visitor identity: cookie if present, otherwise cookieless hash
  const cookieVid = getCookie(req, "_ev") ?? undefined;
  let visitorId: string | undefined = cookieVid;
  const isReturning = cookieVid !== undefined;

  if (!visitorId) {
    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent") ?? "";
    const day = new Date().toISOString().slice(0, 10);
    visitorId = await hashVisitor(ip, ua, siteId, day);
  }

  // Skip excluded visitors
  if (isExcluded(visitorId)) {
    return new Response(null, { status: 204 });
  }

  // Bot scoring
  const ip = getClientIp(req);
  const ipHash = await hashIp(ip);
  const burstCount = getBurstCount(ipHash); // Read-only — beacon increments
  const visitorCountry = getVisitorCountry(req);

  const cfSignals = extractCloudflareSignals(req);
  let botScore = computeBotScore({
    burstCount,
    hasAcceptLanguage: req.headers.has("accept-language"),
    hasSecChUa: req.headers.has("sec-ch-ua"),
    hasSecFetchSite: req.headers.has("sec-fetch-site"),
    visitorCountry,
    siteId,
    ...cfSignals,
  });

  // PoW token verification
  const tok = typeof body.tok === "string" ? body.tok : null;
  const firstSession = events[0]?.sessionId;
  const tokenResult = await verifyToken(
    tok,
    siteId,
    typeof firstSession === "string" ? firstSession : "",
  );
  botScore = Math.min(botScore + tokenPenalty(tokenResult), 100);

  // Discard if bot score exceeds threshold (when configured)
  if (BOT_DISCARD_THRESHOLD > 0 && botScore >= BOT_DISCARD_THRESHOLD) {
    return new Response(null, { status: 204 });
  }

  const limit = Math.min(events.length, MAX_EVENTS_PER_REQUEST);

  for (let i = 0; i < limit; i++) {
    const ev = events[i];
    if (!ev.type || !ALLOWED_EVENT_TYPES.has(ev.type)) continue;

    const data = ev.data ?? {};
    const dataStr = JSON.stringify(data);
    if (dataStr.length > MAX_EVENT_DATA_BYTES) continue;

    const sessionId = typeof ev.sessionId === "string"
      ? ev.sessionId.slice(0, 64)
      : null;

    // Extract experiment attribution from event data (if present)
    const experimentId = typeof data.experiment_id === "string"
      ? data.experiment_id.slice(0, 128)
      : null;
    const variantId = typeof data.variant_id === "string"
      ? data.variant_id.slice(0, 128)
      : null;

    // UTM campaign attribution (validated against active campaigns)
    const rawUtmCampaign = typeof ev.utmCampaign === "string"
      ? ev.utmCampaign.slice(0, 256)
      : null;
    const utmCampaign =
      rawUtmCampaign && isUtmCampaignActive(siteId, rawUtmCampaign)
        ? rawUtmCampaign
        : null;

    eventWriter.push({
      event_type: ev.type,
      site_id: siteId,
      session_id: sessionId,
      visitor_id: visitorId ?? null,
      data: dataStr,
      experiment_id: experimentId,
      variant_id: variantId,
      utm_campaign: utmCampaign,
      device_type: deviceType,
      referrer,
      hour,
      month,
      day_of_week: dayOfWeek,
      is_returning: isReturning ? 1 : 0,
      bot_score: botScore,
    });
  }

  return new Response(null, { status: 204 });
}
