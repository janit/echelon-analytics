import { page } from "fresh";
import { define } from "../../../utils.ts";
import { AdminNav } from "../../../components/AdminNav.tsx";
import { getLiveStats } from "../../../lib/admin-stats.ts";
import { getExperimentStats } from "../../../lib/stats.ts";
import ExperimentActions from "../../../islands/ExperimentActions.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const expId = decodeURIComponent(ctx.params.id);

    const experiment = await db.queryOne<Record<string, unknown>>(
      `SELECT * FROM experiments WHERE experiment_id = ?`,
      expId,
    );

    if (!experiment) {
      return new Response("Experiment not found", { status: 404 });
    }

    const variants = await db.query<Record<string, unknown>>(
      `SELECT * FROM experiment_variants WHERE experiment_id = ? ORDER BY is_control DESC`,
      expId,
    );

    const stats = await getExperimentStats(db, expId);
    const liveStats = await getLiveStats(db);

    ctx.state.pageData = {
      experiment,
      variants,
      stats: stats[0] ?? null,
      liveStats,
    };
    return page();
  },
});

export default define.page<typeof handler>(function ExperimentDetailPage({
  state,
}) {
  const { experiment: exp, variants, stats, liveStats } = state.pageData;
  const expId = exp.experiment_id as string;

  return (
    <AdminNav title={exp.name as string} liveStats={liveStats}>
      <div class="flex gap-2 mb-3">
        <span
          class={`text-xs px-2 py-1 border border-[#1a3a1a] status-${exp
            .status as string}`}
        >
          {exp.status as string}
        </span>
        <span class="bg-[#1a3a1a] text-[#33ff33] text-xs px-2 py-1">
          metric: {exp.metric_event_type as string}
        </span>
        <span class="bg-[#1a3a1a] text-[#33ff33] text-xs px-2 py-1">
          alloc: {exp.allocation_percent as number}%
        </span>
        {exp.utm_campaign && (
          <span class="bg-[#1a3a1a] text-[#33ff33] text-xs px-2 py-1">
            campaign: {exp.utm_campaign as string}
          </span>
        )}
      </div>

      {exp.description && (
        <p class="text-sm text-[#1a9a1a] mb-3">
          {exp.description as string}
        </p>
      )}

      <div class="flex gap-2 mb-4">
        {exp.status === "draft" && (
          <StatusButton
            expId={expId}
            status="active"
            label="> start"
            cls="border-[#33ff33] text-[#33ff33] hover:bg-[#33ff33] hover:text-[#0a0a0a]"
          />
        )}
        {exp.status === "active" && (
          <>
            <StatusButton
              expId={expId}
              status="paused"
              label="> pause"
              cls="border-[#ffaa00] text-[#ffaa00] hover:bg-[#ffaa00] hover:text-[#0a0a0a]"
            />
            <StatusButton
              expId={expId}
              status="completed"
              label="> complete"
              cls="border-[#00ccff] text-[#00ccff] hover:bg-[#00ccff] hover:text-[#0a0a0a]"
            />
          </>
        )}
        {exp.status === "paused" && (
          <>
            <StatusButton
              expId={expId}
              status="active"
              label="> resume"
              cls="border-[#33ff33] text-[#33ff33] hover:bg-[#33ff33] hover:text-[#0a0a0a]"
            />
            <StatusButton
              expId={expId}
              status="archived"
              label="> archive"
              cls="border-[#1a5a1a] text-[#1a5a1a] hover:bg-[#1a5a1a] hover:text-[#0a0a0a]"
            />
          </>
        )}
        {exp.status === "completed" && (
          <StatusButton
            expId={expId}
            status="archived"
            label="> archive"
            cls="border-[#1a5a1a] text-[#1a5a1a] hover:bg-[#1a5a1a] hover:text-[#0a0a0a]"
          />
        )}
      </div>

      <h3 class="text-sm text-[#33ff33] mb-2">
        Variants ({variants.length})
      </h3>
      <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden mb-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#1a3a1a]">
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">ID</th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Name
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Weight
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Control
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr
                key={v.variant_id as string}
                class="border-b border-[#0d1a0d]"
              >
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {v.variant_id as string}
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {v.name as string}
                </td>
                <td class="px-4 py-1.5 tabular-nums text-[#33ff33]">
                  {v.weight as number}
                </td>
                <td class="px-4 py-1.5 text-[#33ff33]">
                  {v.is_control ? "yes" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stats && stats.variants.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2">Results</h3>
          <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[#1a3a1a]">
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Variant
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Impressions
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Conversions
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Rate
                  </th>
                  <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                    Uplift
                  </th>
                  <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                    Significance
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.variants.map((v) => (
                  <tr key={v.variant_id} class="border-b border-[#0d1a0d]">
                    <td class="px-4 py-1.5 text-[#1a9a1a]">
                      {v.name} {v.is_control && "(control)"}
                    </td>
                    <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                      {v.impressions}
                    </td>
                    <td class="px-4 py-1.5 text-right tabular-nums text-[#ff6600]">
                      {v.conversions}
                    </td>
                    <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                      {(v.conversion_rate * 100).toFixed(2)}%
                    </td>
                    <td class="px-4 py-1.5 text-right tabular-nums text-[#ffaa00]">
                      {v.relative_uplift !== null
                        ? `${(v.relative_uplift * 100).toFixed(1)}%`
                        : "-"}
                    </td>
                    <td class="px-4 py-1.5 text-xs text-[#1a5a1a]">
                      {v.significance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div class="mt-3 text-xs text-[#1a5a1a]">
        created: {(exp.created_at as string).slice(0, 16)}
        {exp.started_at &&
          ` | started: ${(exp.started_at as string).slice(0, 16)}`}
        {exp.ended_at &&
          ` | ended: ${(exp.ended_at as string).slice(0, 16)}`}
      </div>
      <ExperimentActions />
    </AdminNav>
  );
});

function StatusButton(
  { expId, status, label, cls }: {
    expId: string;
    status: string;
    label: string;
    cls: string;
  },
) {
  return (
    <button
      type="button"
      class={`px-3 py-1.5 text-xs border ${cls}`}
      data-exp-id={expId}
      data-status={status}
    >
      {label}
    </button>
  );
}
