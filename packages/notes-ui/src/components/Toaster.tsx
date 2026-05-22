import { useToastStore } from "@/lib/toast/store";
import { useEffect } from "react";

const AUTO_DISMISS_MS = 4000;

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS));
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <output
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-md border px-4 py-2 text-sm shadow-lg backdrop-blur ${
            t.tone === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-400"
              : t.tone === "success"
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-card text-fg-muted"
          }`}
        >
          <span>{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="text-fg-dim hover:text-fg"
          >
            ×
          </button>
        </div>
      ))}
    </output>
  );
}
