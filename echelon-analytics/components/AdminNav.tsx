import type { ComponentChildren } from "preact";
import { VERSION } from "../lib/config.ts";

interface AdminNavProps {
  title: string;
  children: ComponentChildren;
  siteSelector?: {
    knownSites: string[];
    siteId: string;
    days?: number;
    dayOptions?: number[];
  };
  liveStats?: {
    viewBuffer: number;
    eventBuffer: number;
    humanViews: number;
    botViews: number;
    uniqueVisitors: number;
    avgResponseMs: number;
    rps: number;
    uptimeSeconds: number;
  };
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ${
      Math.floor((seconds % 3600) / 60)
    }m`;
  }
  return `${Math.floor(seconds / 86400)}d ${
    Math.floor((seconds % 86400) / 3600)
  }h`;
}

export function AdminNav(
  { title, children, siteSelector, liveStats }: AdminNavProps,
) {
  const sel = siteSelector;
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} - Echelon Analytics</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <nav
          class="border-b border-[#1a3a1a]"
          style="background:#111"
        >
          <div class="max-w-7xl mx-auto px-4 flex items-center h-12 gap-6">
            <a
              href="/admin"
              class="font-bold text-lg tracking-tight text-[#33ff33]"
            >
              Echelon
            </a>

            {sel && (
              <form method="get" class="flex items-center gap-2">
                <select
                  name="site_id"
                  class="border border-[#1a3a1a] bg-[#0a0a0a] text-[#33ff33] px-2 py-1 text-xs focus:border-[#33ff33] outline-none"
                  onchange="this.form.submit()"
                >
                  {sel.knownSites.map((s: string) => (
                    <option key={s} value={s} selected={s === sel.siteId}>
                      {s}
                    </option>
                  ))}
                </select>
                {sel.dayOptions && (
                  <select
                    name="days"
                    class="border border-[#1a3a1a] bg-[#0a0a0a] text-[#33ff33] px-2 py-1 text-xs focus:border-[#33ff33] outline-none"
                    onchange="this.form.submit()"
                  >
                    {sel.dayOptions.map((d) => (
                      <option key={d} value={d} selected={d === sel.days}>
                        {d}d
                      </option>
                    ))}
                  </select>
                )}
                <noscript>
                  <button
                    type="submit"
                    class="px-2 py-1 text-xs border border-[#1a3a1a] text-[#1a5a1a] hover:border-[#33ff33] hover:text-[#33ff33]"
                  >
                    go
                  </button>
                </noscript>
              </form>
            )}

            <div class="flex gap-4 text-sm">
              <a
                href="/admin"
                class="text-[#1a9a1a] hover:text-[#33ff33]"
              >
                Dashboard
              </a>
              <a
                href="/admin/realtime"
                class="text-[#1a9a1a] hover:text-[#33ff33]"
              >
                Realtime
              </a>
              <div class="relative group">
                <span class="cursor-default text-[#1a9a1a]">Bots</span>
                <div
                  class="hidden group-hover:block absolute left-0 top-full py-1 z-10 min-w-32 border border-[#1a3a1a]"
                  style="background:#111"
                >
                  <a
                    href="/admin/bots"
                    class="block px-4 py-1.5 text-sm text-[#1a9a1a] hover:text-[#33ff33] hover:bg-[#1a3a1a]"
                  >
                    Suspicious
                  </a>
                  <a
                    href="/admin/bots/excluded"
                    class="block px-4 py-1.5 text-sm text-[#1a9a1a] hover:text-[#33ff33] hover:bg-[#1a3a1a]"
                  >
                    Excluded
                  </a>
                </div>
              </div>
              <a
                href="/admin/experiments"
                class="text-[#1a9a1a] hover:text-[#33ff33]"
              >
                Experiments
              </a>
              <a
                href="/admin/campaigns"
                class="text-[#1a9a1a] hover:text-[#33ff33]"
              >
                Campaigns
              </a>
              <a
                href="/admin/perf"
                class="text-[#1a9a1a] hover:text-[#33ff33]"
              >
                Performance
              </a>
              <a
                href="/admin/settings"
                class="text-[#1a9a1a] hover:text-[#33ff33]"
              >
                Settings
              </a>
            </div>

            <a
              href="/admin/logout"
              class="ml-auto text-xs text-[#1a5a1a] hover:text-[#33ff33]"
            >
              logout
            </a>
          </div>
        </nav>

        {liveStats && (
          <div
            class="border-b border-[#1a3a1a]"
            style="background:#0a0a0a"
          >
            <div class="max-w-7xl mx-auto px-4 flex items-center h-8 gap-3 text-xs text-[#1a5a1a]">
              <span title="Human views (24h)">
                <span class="text-[#33ff33]">{liveStats.humanViews}</span> users
              </span>
              <span title="Bot views (24h)">
                <span class="text-[#ff3333]">{liveStats.botViews}</span> bots
              </span>
              <span class="text-[#1a3a1a]">|</span>
              <span title="Unique visitors (24h)">
                {liveStats.uniqueVisitors} unique
              </span>
              <span class="text-[#1a3a1a]">|</span>
              <span title="Views buffered / Events buffered">
                buf: {liveStats.viewBuffer}v/{liveStats.eventBuffer}e
              </span>
              <span class="text-[#1a3a1a]">|</span>
              <span title="Avg response time (5 min)">
                {liveStats.avgResponseMs.toFixed(0)}ms
              </span>
              <span title="Requests per second">
                {liveStats.rps} rps
              </span>
              <span class="text-[#1a3a1a]">|</span>
              <span title="Uptime">
                {formatUptime(liveStats.uptimeSeconds)}
              </span>
            </div>
          </div>
        )}
        <main class="max-w-7xl mx-auto px-4 py-6">
          <h1 class="text-xl font-semibold text-[#33ff33] mb-4">
            <span class="text-[#1a9a1a]">##</span>
            {title}
          </h1>
          {children}
        </main>
        <footer class="max-w-7xl mx-auto px-4 py-4 text-xs text-[#1a5a1a] text-center border-t border-[#1a3a1a]">
          <a
            href="https://ea.js.org/"
            target="_blank"
            rel="noopener"
            class="hover:text-[#33ff33]"
          >
            Echelon Analytics
          </a>{" "}
          {VERSION}
        </footer>
      </body>
    </html>
  );
}
