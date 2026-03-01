// Echelon Analytics — Fresh 2.2.0 Entry Point
//
// IMPORTANT: This app uses in-memory state (session store, rate limiter,
// buffered writers, caches). When using `deno serve`, run with a single
// worker (default). Multiple workers (--parallel) will create isolated
// copies of all in-memory state, causing incorrect behavior.

import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { closeDb, initDb } from "./lib/db/database.ts";
import { flushRemainingViews, startViewWriter } from "./lib/beacon.ts";
import {
  flushRemainingEvents,
  startEventWriter,
} from "./lib/events-endpoint.ts";
import { scheduleDailyMaintenance } from "./lib/maintenance.ts";
import { recordRequest } from "./lib/request-stats.ts";
import { pruneSessions } from "./lib/session.ts";
import { refreshUtmCampaigns } from "./lib/utm.ts";

// Initialize database
const db = await initDb();

// Start buffered writers
startViewWriter(db);
startEventWriter(db);

// Warm UTM campaign cache
await refreshUtmCampaigns(db);

// Schedule daily maintenance (rollup + purge + VACUUM at 03:00 UTC)
scheduleDailyMaintenance(db);

// Prune expired sessions every 30 minutes
setInterval(pruneSessions, 30 * 60 * 1000);

// Graceful shutdown
let _shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[echelon] ${signal} received — flushing writers...`);
  Promise.all([
    flushRemainingViews(db),
    flushRemainingEvents(db),
  ]).then(async () => {
    await closeDb();
    Deno.exit(0);
  }).catch((e) => {
    console.error("[echelon] Error during shutdown:", e);
    Deno.exit(1);
  });
}

Deno.addSignalListener("SIGTERM", () => gracefulShutdown("SIGTERM"));
Deno.addSignalListener("SIGINT", () => gracefulShutdown("SIGINT"));

export const app = new App<State>();

app.use(staticFiles());

// Request timing middleware
app.use(async (ctx) => {
  const start = performance.now();
  const resp = await ctx.next();
  const durationMs = performance.now() - start;
  const url = new URL(ctx.req.url);
  recordRequest(url.pathname, durationMs, resp.status);
  return resp;
});

// Inject DB into state for all routes
app.use((ctx) => {
  ctx.state.db = db;
  ctx.state.isAuthenticated = false;
  return ctx.next();
});

app.fsRoutes();
