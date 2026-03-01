import { page } from "fresh";
import { define } from "../../../utils.ts";
import { AdminNav } from "../../../components/AdminNav.tsx";
import { getLiveStats } from "../../../lib/admin-stats.ts";
import { getExperimentStats } from "../../../lib/stats.ts";
import ExperimentForm from "../../../islands/ExperimentForm.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const experiments = await db.query<Record<string, unknown>>(
      `SELECT * FROM experiments ORDER BY created_at DESC`,
    );
    const stats = await getExperimentStats(db);
    const liveStats = await getLiveStats(db);
    ctx.state.pageData = { experiments, stats, liveStats };
    return page();
  },
});

export default define.page<typeof handler>(function ExperimentsPage({ state }) {
  const { experiments, stats, liveStats } = state.pageData;

  return (
    <AdminNav title="Experiments" liveStats={liveStats}>
      <div class="bg-[#111] border border-[#1a3a1a] p-4 mb-4">
        <h3 class="text-sm text-[#33ff33] mb-2">Create Experiment</h3>
        <ExperimentForm />
      </div>

      <h3 class="text-sm text-[#33ff33] mb-2">
        All Experiments ({experiments.length})
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
                Status
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Metric
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Created
              </th>
              <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((e) => (
              <tr
                key={e.experiment_id as string}
                class="border-b border-[#0d1a0d]"
              >
                <td class="px-4 py-1.5">
                  <a
                    href={`/admin/experiments/${
                      encodeURIComponent(e.experiment_id as string)
                    }`}
                    class="text-[#33ff33] hover:text-[#66ff66]"
                  >
                    {e.experiment_id as string}
                  </a>
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {e.name as string}
                </td>
                <td class="px-4 py-1.5">
                  <span class={`status-${e.status as string}`}>
                    {e.status as string}
                  </span>
                </td>
                <td class="px-4 py-1.5 text-[#1a9a1a]">
                  {e.metric_event_type as string}
                </td>
                <td class="px-4 py-1.5 text-[#1a5a1a]">
                  {(e.created_at as string).slice(0, 10)}
                </td>
                <td class="px-4 py-1.5">
                  <a
                    href={`/admin/experiments/${
                      encodeURIComponent(e.experiment_id as string)
                    }`}
                    class="text-xs text-[#33ff33] hover:text-[#66ff66]"
                  >
                    view
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {experiments.length === 0 && (
        <p class="text-[#1a5a1a] text-sm">No experiments yet.</p>
      )}

      {stats.length > 0 && (
        <>
          <h3 class="text-sm text-[#33ff33] mb-2 mt-4">
            Active/Completed Stats
          </h3>
          {stats.map((s) => (
            <div
              key={s.experiment_id}
              class="bg-[#111] border border-[#1a3a1a] p-4 mb-3"
            >
              <h4 class="text-sm text-[#33ff33]">
                {s.name} <span class={`status-${s.status}`}>({s.status})</span>
              </h4>
              <table class="w-full text-sm mt-2">
                <thead>
                  <tr class="border-b border-[#1a3a1a]">
                    <th class="text-left py-1 text-xs text-[#1a5a1a]">
                      Variant
                    </th>
                    <th class="text-right py-1 text-xs text-[#1a5a1a]">
                      Impressions
                    </th>
                    <th class="text-right py-1 text-xs text-[#1a5a1a]">
                      Conversions
                    </th>
                    <th class="text-right py-1 text-xs text-[#1a5a1a]">
                      Rate
                    </th>
                    <th class="text-right py-1 text-xs text-[#1a5a1a]">
                      Uplift
                    </th>
                    <th class="text-left py-1 text-xs text-[#1a5a1a]">
                      Significance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.variants.map((v) => (
                    <tr key={v.variant_id} class="border-b border-[#0d1a0d]">
                      <td class="py-1 text-[#1a9a1a]">
                        {v.name} {v.is_control && "(control)"}
                      </td>
                      <td class="py-1 text-right tabular-nums text-[#33ff33]">
                        {v.impressions}
                      </td>
                      <td class="py-1 text-right tabular-nums text-[#ff6600]">
                        {v.conversions}
                      </td>
                      <td class="py-1 text-right tabular-nums text-[#33ff33]">
                        {(v.conversion_rate * 100).toFixed(2)}%
                      </td>
                      <td class="py-1 text-right tabular-nums text-[#ffaa00]">
                        {v.relative_uplift !== null
                          ? `${(v.relative_uplift * 100).toFixed(1)}%`
                          : "-"}
                      </td>
                      <td class="py-1 text-xs text-[#1a5a1a]">
                        {v.significance}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </AdminNav>
  );
});
