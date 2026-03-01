import { define } from "../../../utils.ts";

export const handler = define.handlers({
  async POST(ctx) {
    let body: Record<string, unknown>;
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const { visitor_id, label } = body;
    if (typeof visitor_id !== "string" || !visitor_id) {
      return Response.json(
        { error: "invalid_payload", message: "visitor_id required" },
        { status: 400 },
      );
    }

    await ctx.state.db.run(
      `INSERT OR IGNORE INTO excluded_visitors (visitor_id, label) VALUES (?, ?)`,
      visitor_id,
      (label as string) ?? null,
    );
    return Response.json({ excluded: visitor_id }, { status: 201 });
  },
});
