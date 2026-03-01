import { useSignal } from "@preact/signals";

export default function ConsentCssEditor(
  { siteId, initialCss }: { siteId: string; initialCss: string },
) {
  const css = useSignal(initialCss);
  const saving = useSignal(false);
  const msg = useSignal<string | null>(null);
  const err = useSignal<string | null>(null);

  async function save() {
    saving.value = true;
    msg.value = null;
    err.value = null;
    try {
      const res = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent_css: css.value || null }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        err.value = data.message || "Save failed";
      } else {
        msg.value = "Saved";
        setTimeout(() => (msg.value = null), 2000);
      }
    } catch (e) {
      err.value = (e as Error).message;
    }
    saving.value = false;
  }

  const inputCls =
    "border border-[#1a3a1a] bg-[#0a0a0a] text-[#33ff33] px-3 py-2 text-sm w-full focus:border-[#33ff33] outline-none font-mono";

  return (
    <div>
      <label class="block text-xs text-[#1a5a1a] mb-1">
        Custom CSS (injected into shadow DOM)
      </label>
      <textarea
        class={inputCls}
        rows={6}
        placeholder={`.bar { background: #2d2d2d; }
.ok { background: #22c55e; }
.no { border-color: #666; color: #ccc; }`}
        value={css.value}
        onInput={(e) => (css.value = (e.target as HTMLTextAreaElement).value)}
      />
      <div class="flex items-center gap-3 mt-2">
        <button
          type="button"
          class="px-3 py-1.5 text-xs border border-[#33ff33] text-[#33ff33] hover:bg-[#33ff33] hover:text-[#0a0a0a] disabled:opacity-50"
          disabled={saving.value}
          onClick={save}
        >
          {saving.value ? "saving..." : "> save"}
        </button>
        {msg.value && <span class="text-xs text-[#33ff33]">{msg.value}</span>}
        {err.value && <span class="text-xs text-[#ff3333]">{err.value}</span>}
      </div>
      <div class="mt-3 text-xs text-[#1a5a1a]">
        Available selectors: <code class="text-[#1a9a1a]">.bar</code>{" "}
        (container), <code class="text-[#1a9a1a]">.msg</code> (text),{" "}
        <code class="text-[#1a9a1a]">.btns</code> (button wrapper),{" "}
        <code class="text-[#1a9a1a]">.ok</code> (accept),{" "}
        <code class="text-[#1a9a1a]">.no</code> (decline)
      </div>
    </div>
  );
}
