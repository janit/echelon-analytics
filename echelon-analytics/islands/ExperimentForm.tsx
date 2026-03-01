import { useSignal } from "@preact/signals";

interface Variant {
  variant_id: string;
  name: string;
  weight: number;
  is_control: boolean;
}

export default function ExperimentForm() {
  const experimentId = useSignal("");
  const name = useSignal("");
  const description = useSignal("");
  const metricEventType = useSignal("");
  const allocationPercent = useSignal(100);
  const variants = useSignal<Variant[]>([
    { variant_id: "control", name: "Control", weight: 50, is_control: true },
    {
      variant_id: "variant-a",
      name: "Variant A",
      weight: 50,
      is_control: false,
    },
  ]);
  const error = useSignal<string | null>(null);
  const success = useSignal<string | null>(null);
  const loading = useSignal(false);

  function addVariant() {
    const idx = variants.value.length;
    variants.value = [
      ...variants.value,
      {
        variant_id: `variant-${String.fromCharCode(97 + idx - 1)}`,
        name: `Variant ${String.fromCharCode(65 + idx - 1)}`,
        weight: 50,
        is_control: false,
      },
    ];
  }

  function removeVariant(index: number) {
    if (variants.value.length <= 2) return;
    variants.value = variants.value.filter((_, i) => i !== index);
  }

  function updateVariant(
    index: number,
    field: keyof Variant,
    value: string | number | boolean,
  ) {
    variants.value = variants.value.map((v, i) =>
      i === index ? { ...v, [field]: value } : v
    );
  }

  async function submit(e: Event) {
    e.preventDefault();
    error.value = null;
    success.value = null;

    if (!experimentId.value || !name.value || !metricEventType.value) {
      error.value = "Experiment ID, name, and metric event type are required.";
      return;
    }

    loading.value = true;
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment_id: experimentId.value,
          name: name.value,
          description: description.value || undefined,
          metric_event_type: metricEventType.value,
          allocation_percent: allocationPercent.value,
          variants: variants.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.value = data.message || "Failed to create experiment.";
      } else {
        success.value = `Created experiment: ${data.created}`;
        experimentId.value = "";
        name.value = "";
        description.value = "";
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

      <div class="grid grid-cols-3 gap-2 mb-2">
        <input
          class={inputCls}
          placeholder="experiment_id"
          value={experimentId.value}
          onInput={(
            e,
          ) => (experimentId.value = (e.target as HTMLInputElement).value)}
        />
        <input
          class={inputCls}
          placeholder="name"
          value={name.value}
          onInput={(e) => (name.value = (e.target as HTMLInputElement).value)}
        />
        <input
          class={inputCls}
          placeholder="metric_event_type"
          value={metricEventType.value}
          onInput={(
            e,
          ) => (metricEventType.value = (e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="grid grid-cols-4 gap-2 mb-2">
        <div class="col-span-3">
          <input
            class={inputCls}
            placeholder="description (optional)"
            value={description.value}
            onInput={(
              e,
            ) => (description.value = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="flex items-center gap-1">
          <span class="text-xs text-[#1a5a1a] whitespace-nowrap">alloc %</span>
          <input
            type="number"
            class={inputCls}
            min={1}
            max={100}
            value={allocationPercent.value}
            onInput={(e) => (allocationPercent.value = parseInt(
              (e.target as HTMLInputElement).value,
            ))}
          />
        </div>
      </div>

      <h6 class="text-sm text-[#33ff33] mt-3 mb-1">variants</h6>
      {variants.value.map((v, i) => (
        <div key={i} class="grid grid-cols-12 gap-2 mb-1 items-center">
          <div class="col-span-3">
            <input
              class={inputCls}
              placeholder="variant_id"
              value={v.variant_id}
              onInput={(e) =>
                updateVariant(
                  i,
                  "variant_id",
                  (e.target as HTMLInputElement).value,
                )}
            />
          </div>
          <div class="col-span-3">
            <input
              class={inputCls}
              placeholder="name"
              value={v.name}
              onInput={(e) =>
                updateVariant(
                  i,
                  "name",
                  (e.target as HTMLInputElement).value,
                )}
            />
          </div>
          <div class="col-span-2">
            <input
              type="number"
              class={inputCls}
              placeholder="weight"
              value={v.weight}
              onInput={(e) =>
                updateVariant(
                  i,
                  "weight",
                  parseInt((e.target as HTMLInputElement).value),
                )}
            />
          </div>
          <div class="col-span-2">
            <label class="flex items-center gap-1 text-sm text-[#1a9a1a]">
              <input
                type="checkbox"
                checked={v.is_control}
                onChange={(e) =>
                  updateVariant(
                    i,
                    "is_control",
                    (e.target as HTMLInputElement).checked,
                  )}
              />
              control
            </label>
          </div>
          <div class="col-span-2">
            {variants.value.length > 2 && (
              <button
                type="button"
                class="text-xs text-[#ff3333] hover:text-[#ff6666]"
                onClick={() => removeVariant(i)}
              >
                remove
              </button>
            )}
          </div>
        </div>
      ))}

      <div class="flex gap-2 mt-2">
        <button
          type="button"
          class="px-3 py-1.5 text-xs border border-[#1a3a1a] text-[#1a9a1a] hover:text-[#33ff33] hover:border-[#33ff33]"
          onClick={addVariant}
        >
          + add variant
        </button>
        <button
          type="submit"
          class="px-3 py-1.5 text-xs border border-[#33ff33] text-[#33ff33] hover:bg-[#33ff33] hover:text-[#0a0a0a] disabled:opacity-50"
          disabled={loading.value}
        >
          {loading.value ? "creating..." : "> create experiment"}
        </button>
      </div>
    </form>
  );
}
