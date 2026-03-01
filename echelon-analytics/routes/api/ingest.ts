import { define } from "../../utils.ts";
import { ingestBatch, validateBatch } from "../../lib/ingest.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const MAX_BODY = 1_048_576; // 1 MB
    const contentLength = parseInt(
      ctx.req.headers.get("content-length") ?? "0",
    );
    if (contentLength > MAX_BODY) {
      return Response.json(
        { error: "payload_too_large", message: "Body exceeds 1MB limit" },
        { status: 413 },
      );
    }
    let rawBody: string;
    try {
      rawBody = await ctx.req.text();
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Could not read body" },
        { status: 400 },
      );
    }
    if (rawBody.length > MAX_BODY) {
      return Response.json(
        { error: "payload_too_large", message: "Body exceeds 1MB limit" },
        { status: 413 },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const validation = validateBatch(body);
    if (!validation.ok) {
      return Response.json(
        { error: "invalid_payload", message: validation.message },
        { status: 400 },
      );
    }

    try {
      const result = await ingestBatch(ctx.state.db, validation.batch);
      return Response.json(result);
    } catch (err) {
      console.error("[echelon] Ingest error:", err);
      return Response.json(
        { error: "internal", message: "Ingest failed" },
        { status: 500 },
      );
    }
  },
});
