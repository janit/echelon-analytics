import { define } from "../../../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const rows = await ctx.state.db.query(
      `SELECT * FROM experiments ORDER BY created_at DESC`,
    );
    return Response.json(rows);
  },

  async POST(ctx) {
    const db = ctx.state.db;
    let body: Record<string, unknown>;
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_payload", message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const {
      experiment_id,
      name,
      description,
      metric_event_type,
      allocation_percent,
      variants,
    } = body;
    if (!experiment_id || !name || !metric_event_type) {
      return Response.json(
        { error: "invalid_payload", message: "Missing required fields" },
        { status: 400 },
      );
    }

    // Validate lengths and variant count
    const expId = String(experiment_id).slice(0, 128);
    const expName = String(name).slice(0, 256);
    const expDesc = description ? String(description).slice(0, 1024) : null;
    const expMetric = String(metric_event_type).slice(0, 128);
    const expAlloc = Math.max(
      1,
      Math.min(100, Number(allocation_percent) || 100),
    );
    const variantList = Array.isArray(variants)
      ? (variants as Record<string, unknown>[]).slice(0, 20)
      : [];

    try {
      await db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO experiments (experiment_id, name, description, metric_event_type, allocation_percent)
           VALUES (?, ?, ?, ?, ?)`,
          expId,
          expName,
          expDesc,
          expMetric,
          expAlloc,
        );

        for (const v of variantList) {
          await tx.run(
            `INSERT INTO experiment_variants (experiment_id, variant_id, name, weight, is_control, config)
             VALUES (?, ?, ?, ?, ?, ?)`,
            expId,
            String(v.variant_id ?? "").slice(0, 128),
            String(v.name ?? "").slice(0, 256),
            Math.max(1, Number(v.weight) || 50),
            v.is_control ? 1 : 0,
            v.config ? JSON.stringify(v.config).slice(0, 4096) : null,
          );
        }
      });

      return Response.json({ created: expId }, { status: 201 });
    } catch {
      return Response.json(
        { error: "conflict", message: "Experiment creation failed" },
        { status: 409 },
      );
    }
  },
});
