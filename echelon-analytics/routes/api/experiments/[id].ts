import { define } from "../../../utils.ts";

const VALID_STATUSES = new Set([
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
]);

export const handler = define.handlers({
  async PATCH(ctx) {
    const db = ctx.state.db;
    const expId = ctx.params.id.slice(0, 128);

    let body: Record<string, unknown>;
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const { status } = body;
    if (!status || !VALID_STATUSES.has(status as string)) {
      return Response.json(
        {
          error: "invalid_payload",
          message: "Invalid status. Must be one of: " +
            [...VALID_STATUSES].join(", "),
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    if (status === "active") {
      await db.run(
        `UPDATE experiments SET status = ?, started_at = COALESCE(started_at, ?) WHERE experiment_id = ?`,
        status as string,
        now,
        expId,
      );
    } else if (status === "completed" || status === "archived") {
      await db.run(
        `UPDATE experiments SET status = ?, ended_at = COALESCE(ended_at, ?) WHERE experiment_id = ?`,
        status as string,
        now,
        expId,
      );
    } else {
      await db.run(
        `UPDATE experiments SET status = ? WHERE experiment_id = ?`,
        status as string,
        expId,
      );
    }

    return Response.json({ updated: expId });
  },
});
