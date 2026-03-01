import { define } from "../utils.ts";

// Resolve the Vite-built CSS at startup by scanning _fresh/client/assets/
let cssText = "";
try {
  for (const entry of Deno.readDirSync("_fresh/client/assets")) {
    if (entry.name.startsWith("client-entry-") && entry.name.endsWith(".css")) {
      cssText = Deno.readTextFileSync(`_fresh/client/assets/${entry.name}`);
      break;
    }
  }
} catch {
  // Build output not yet available (dev mode) — Vite handles CSS injection
}

export const handler = define.handlers({
  GET(_ctx) {
    return new Response(cssText, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
});
