// Echelon Analytics — Event Ingestion

import type { DbAdapter } from "./db/adapter.ts";
import type { IngestBatch, IngestResult } from "../types.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateBatch(
  body: unknown,
): { ok: true; batch: IngestBatch } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Body must be a JSON object" };
  }

  const b = body as Record<string, unknown>;

  if (b.v !== 1) {
    return { ok: false, message: "Unsupported protocol version" };
  }
  if (typeof b.batch_id !== "string" || !UUID_RE.test(b.batch_id)) {
    return { ok: false, message: "Invalid batch_id" };
  }
  if (!b.context || typeof b.context !== "object") {
    return { ok: false, message: "Missing context" };
  }

  const ctx = b.context as Record<string, unknown>;
  if (typeof ctx.session_id !== "string" || !UUID_RE.test(ctx.session_id)) {
    return { ok: false, message: "Invalid session_id" };
  }

  // site_id is optional; validate format if present
  if (
    ctx.site_id !== undefined &&
    (typeof ctx.site_id !== "string" ||
      ctx.site_id.length > 64 ||
      !/^[a-zA-Z0-9._-]+$/.test(ctx.site_id))
  ) {
    return { ok: false, message: "Invalid site_id" };
  }

  if (!Array.isArray(b.events) || b.events.length === 0) {
    return { ok: false, message: "Events array is empty or missing" };
  }
  if (b.events.length > 100) {
    return { ok: false, message: "Too many events (max 100)" };
  }

  for (const evt of b.events) {
    if (!evt || typeof evt !== "object") {
      return { ok: false, message: "Invalid event object" };
    }
    const e = evt as Record<string, unknown>;
    if (typeof e.event_id !== "string" || !UUID_RE.test(e.event_id)) {
      return { ok: false, message: `Invalid event_id: ${e.event_id}` };
    }
    if (typeof e.type !== "string" || e.type.length === 0) {
      return { ok: false, message: "Event missing type" };
    }
    if (e.type.length > 64 || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(e.type)) {
      return {
        ok: false,
        message: `Invalid event type: ${String(e.type).slice(0, 32)}`,
      };
    }
    if (typeof e.ts !== "string") {
      return { ok: false, message: "Event missing ts" };
    }
  }

  return { ok: true, batch: body as IngestBatch };
}

export async function ingestBatch(
  db: DbAdapter,
  batch: IngestBatch,
): Promise<IngestResult> {
  const ctx = batch.context;
  let accepted = 0;
  let duplicate = 0;

  // Insert events as semantic_events (unified schema — no sessions table)
  await db.transaction(async (tx) => {
    for (const evt of batch.events) {
      const expId = evt.experiments?.[0]?.experiment_id ?? null;
      const varId = evt.experiments?.[0]?.variant_id ?? null;

      const data: Record<string, unknown> = {
        ...(evt.data ?? {}),
        ...(expId ? { experiment_id: expId, variant_id: varId } : {}),
        session_context: {
          device_class: ctx.device_class,
          viewport: `${ctx.viewport_width}x${ctx.viewport_height}`,
          screen: `${ctx.screen_width}x${ctx.screen_height}`,
          language: ctx.language,
        },
      };

      const now = new Date();
      const result = await tx.run(
        `INSERT INTO semantic_events
           (event_type, site_id, session_id, visitor_id, data,
            device_type, referrer, hour, month, day_of_week,
            is_returning, bot_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        evt.type,
        ctx.site_id ?? "default",
        ctx.session_id,
        null,
        JSON.stringify(data),
        ctx.device_class ?? null,
        evt.referrer ?? null,
        now.getUTCHours(),
        now.getUTCMonth() + 1,
        now.getUTCDay(),
        0,
        0,
      );

      if (result.changes > 0) {
        accepted++;
      } else {
        duplicate++;
      }
    }
  });

  return { accepted, duplicate };
}
