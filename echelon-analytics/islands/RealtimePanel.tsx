import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface RealtimeData {
  site_id: string;
  active_visitors: number;
  pageviews: number;
  active_paths: { path: string; views: number }[];
}

interface Props {
  siteId: string;
}

export default function RealtimePanel({ siteId }: Props) {
  const data = useSignal<RealtimeData | null>(null);
  const error = useSignal<string | null>(null);
  const lastUpdate = useSignal<string>("");
  const isStale = useComputed(() => !data.value);

  useEffect(() => {
    let active = true;

    async function fetchData() {
      try {
        const res = await fetch(
          `/api/stats/realtime?site_id=${encodeURIComponent(siteId)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (active) {
          data.value = json;
          error.value = null;
          lastUpdate.value = new Date().toLocaleTimeString();
        }
      } catch (e) {
        if (active) error.value = (e as Error).message;
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [siteId]);

  if (error.value) {
    return (
      <div
        class="border border-[#661111] text-[#ff3333] px-4 py-2 text-sm"
        style="background:#1a0a0a"
      >
        ERROR: {error.value}
      </div>
    );
  }

  if (isStale.value) {
    return (
      <p class="text-[#1a5a1a] text-sm">
        Loading realtime data...<span class="cursor"></span>
      </p>
    );
  }

  const d = data.value!;

  return (
    <div>
      <div class="flex gap-2 mb-3 items-center">
        <span class="bg-[#1a3a1a] text-[#33ff33] text-xs px-2 py-1">
          site: {siteId}
        </span>
        <span class="text-xs text-[#1a5a1a]">
          updated: {lastUpdate.value}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="kpi-card">
          <div class="kpi-value">{d.active_visitors}</div>
          <div class="kpi-label">Active Visitors (5 min)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{d.pageviews}</div>
          <div class="kpi-label">Recent Pageviews</div>
        </div>
      </div>

      {d.active_paths.length > 0 && (
        <div class="bg-[#111] border border-[#1a3a1a] overflow-hidden">
          <div class="px-4 py-3 border-b border-[#1a3a1a]">
            <h3 class="text-sm text-[#33ff33]">Active Pages</h3>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-[#1a3a1a]">
                <th class="text-left px-4 py-2 text-xs text-[#1a5a1a]">
                  Path
                </th>
                <th class="text-right px-4 py-2 text-xs text-[#1a5a1a]">
                  Views
                </th>
              </tr>
            </thead>
            <tbody>
              {d.active_paths.map((p) => (
                <tr key={p.path} class="border-b border-[#0d1a0d]">
                  <td class="px-4 py-1.5 text-[#1a9a1a]">{p.path}</td>
                  <td class="px-4 py-1.5 text-right tabular-nums text-[#33ff33]">
                    {p.views}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
