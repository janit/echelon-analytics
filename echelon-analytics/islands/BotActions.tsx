import { useSignal } from "@preact/signals";

interface Props {
  visitorId: string;
  isExcluded: boolean;
}

export default function BotActions({ visitorId, isExcluded }: Props) {
  const excluded = useSignal(isExcluded);
  const loading = useSignal(false);

  async function toggle() {
    loading.value = true;
    try {
      if (excluded.value) {
        await fetch(
          `/api/bots/exclude/${encodeURIComponent(visitorId)}`,
          { method: "DELETE" },
        );
        excluded.value = false;
      } else {
        await fetch("/api/bots/exclude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitor_id: visitorId }),
        });
        excluded.value = true;
      }
    } catch {
      // Ignore errors
    }
    loading.value = false;
  }

  return (
    <button
      type="button"
      class={`px-2 py-1 text-xs font-medium border ${
        excluded.value
          ? "border-[#1a3a1a] text-[#33ff33] hover:bg-[#1a3a1a]"
          : "border-[#661111] text-[#ff3333] hover:bg-[#1a0a0a]"
      } disabled:opacity-50`}
      onClick={toggle}
      disabled={loading.value}
    >
      {loading.value ? "..." : excluded.value ? "include" : "exclude"}
    </button>
  );
}
