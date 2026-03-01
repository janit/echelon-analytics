import { page } from "fresh";
import { define } from "../../utils.ts";
import { AdminNav } from "../../components/AdminNav.tsx";
import { getLiveStats } from "../../lib/admin-stats.ts";
import ConsentCssEditor from "../../islands/ConsentCssEditor.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const db = ctx.state.db;
    const site = ctx.state.siteId;
    const liveStats = await getLiveStats(db);

    const row = await db.queryOne<{ consent_css: string | null }>(
      `SELECT consent_css FROM site_settings WHERE site_id = ?`,
      site,
    );

    // Get list of known sites for the dropdown
    const sites = await db.query<{ site_id: string }>(
      `SELECT DISTINCT site_id FROM visitor_views ORDER BY site_id`,
    );
    const knownSites = sites.map((s: { site_id: string }) => s.site_id);
    if (!knownSites.includes(site)) knownSites.unshift(site);

    ctx.state.pageData = {
      site,
      consentCss: row?.consent_css ?? "",
      knownSites,
      liveStats,
    };
    return page();
  },
});

export default define.page<typeof handler>(function SettingsPage({ state }) {
  const { site, consentCss, knownSites, liveStats } = state.pageData;

  return (
    <AdminNav
      title="Site Settings"
      liveStats={liveStats}
      siteSelector={{ knownSites, siteId: site }}
    >
      <div class="bg-[#111] border border-[#1a3a1a] p-4 mb-4">
        <h3 class="text-sm text-[#33ff33] mb-3">
          Cookie Consent Banner — {site}
        </h3>
        <ConsentCssEditor siteId={site} initialCss={consentCss} />
      </div>

      <div class="text-xs text-[#1a5a1a]">
        <p class="mb-1">
          The consent banner uses a Web Component (shadow DOM) so custom CSS
          won't leak into or be affected by the host page's styles.
        </p>
        <p>
          Requires{" "}
          <code class="text-[#1a9a1a]">ECHELON_COOKIE_CONSENT=true</code> and
          {" "}
          <code class="text-[#1a9a1a]">data-cookie</code> on the script tag.
        </p>
      </div>
    </AdminNav>
  );
});
