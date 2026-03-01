import { useEffect, useRef } from "preact/hooks";

export default function ExperimentActions() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(e: Event) {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-exp-id]",
      );
      if (!btn) return;
      const expId = btn.dataset.expId;
      const status = btn.dataset.status;
      if (!expId || !status) return;
      fetch(`/api/experiments/${encodeURIComponent(expId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => {
        if (r.ok) location.reload();
        else {console.error(
            "[echelon] experiment status update failed:",
            r.status,
          );}
      }).catch((err) =>
        console.error("[echelon] experiment status update failed:", err)
      );
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, []);

  return <div ref={containerRef} style="display:contents" />;
}
