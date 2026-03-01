import { useSignal } from "@preact/signals";

export default function CampaignForm() {
  const id = useSignal("");
  const name = useSignal("");
  const utmCampaign = useSignal("");
  const siteId = useSignal("default");
  const error = useSignal<string | null>(null);
  const success = useSignal<string | null>(null);
  const loading = useSignal(false);

  async function submit(e: Event) {
    e.preventDefault();
    error.value = null;
    success.value = null;

    if (!id.value || !name.value || !utmCampaign.value) {
      error.value = "ID, name, and utm_campaign are required.";
      return;
    }

    loading.value = true;
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id.value,
          name: name.value,
          utm_campaign: utmCampaign.value,
          site_id: siteId.value || "default",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.value = data.message || "Failed to create campaign.";
      } else {
        id.value = "";
        name.value = "";
        utmCampaign.value = "";
        siteId.value = "default";
        success.value = data.created;
        location.href = `/admin/campaigns/${encodeURIComponent(data.created)}`;
      }
    } catch (err) {
      error.value = (err as Error).message;
    }
    loading.value = false;
  }

  const inputCls =
    "border border-[#1a3a1a] bg-[#0a0a0a] text-[#33ff33] px-2 py-1.5 text-sm w-full focus:border-[#33ff33] outline-none";

  return (
    <form onSubmit={submit}>
      {error.value && (
        <div
          class="border border-[#661111] text-[#ff3333] px-3 py-1.5 text-sm mb-2"
          style="background:#1a0a0a"
        >
          {error.value}
        </div>
      )}
      {success.value && (
        <div
          class="border border-[#1a3a1a] text-[#33ff33] px-3 py-1.5 text-sm mb-2"
          style="background:#0d1a0d"
        >
          {success.value}
        </div>
      )}

      <div class="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
        <input
          class={inputCls}
          placeholder="id (slug)"
          value={id.value}
          onInput={(e) => (id.value = (e.target as HTMLInputElement).value)}
        />
        <input
          class={inputCls}
          placeholder="name"
          value={name.value}
          onInput={(e) => (name.value = (e.target as HTMLInputElement).value)}
        />
        <input
          class={inputCls}
          placeholder="utm_campaign value"
          value={utmCampaign.value}
          onInput={(
            e,
          ) => (utmCampaign.value = (e.target as HTMLInputElement).value)}
        />
        <input
          class={inputCls}
          placeholder="site_id (default)"
          value={siteId.value}
          onInput={(e) => (siteId.value = (e.target as HTMLInputElement).value)}
        />
      </div>

      <button
        type="submit"
        class="px-3 py-1.5 text-xs border border-[#33ff33] text-[#33ff33] hover:bg-[#33ff33] hover:text-[#0a0a0a] disabled:opacity-50"
        disabled={loading.value}
      >
        {loading.value ? "creating..." : "> create campaign"}
      </button>
    </form>
  );
}
