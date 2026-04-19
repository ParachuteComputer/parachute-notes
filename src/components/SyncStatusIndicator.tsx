import { SyncStatusPanel } from "@/components/SyncStatusPanel";
import { useQueueStatus } from "@/lib/sync";
import { useVaultStore } from "@/lib/vault";
import { useSync } from "@/providers/SyncProvider";
import { useEffect, useRef, useState } from "react";

type Tone = "online" | "offline" | "syncing" | "halted";

// Resolves the most important thing to communicate at a glance. Order matters:
// auth-halt beats offline beats syncing beats online, because the user's next
// action depends on the most severe state.
function resolveTone(opts: {
  isOnline: boolean;
  isDraining: boolean;
  authHalt: boolean;
}): Tone {
  if (opts.authHalt) return "halted";
  if (!opts.isOnline) return "offline";
  if (opts.isDraining) return "syncing";
  return "online";
}

export function SyncStatusIndicator() {
  const { db, isOnline, isDraining } = useSync();
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const status = useQueueStatus(db, activeVaultId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close the panel when the user clicks anywhere outside. Bound at the
  // document level so it catches clicks on header siblings too.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const tone = resolveTone({
    isOnline,
    isDraining,
    authHalt: status.authHalt !== null,
  });

  const label = describeTone(tone);
  const badge = status.total > 0 ? status.total : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Sync status: ${label}${badge ? `, ${badge} pending` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-fg-muted hover:text-accent"
      >
        <Dot tone={tone} />
        <span className="hidden text-xs sm:inline">{label}</span>
        {badge !== null ? (
          <span
            aria-label={`${badge} pending`}
            className="rounded-full bg-accent/20 px-1.5 text-[10px] font-medium tabular-nums text-accent"
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        // biome-ignore lint/a11y/useSemanticElements: a native <dialog> requires imperative show()/showModal() calls; this is a popover, not a modal.
        <div
          role="dialog"
          aria-label="Sync status details"
          className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-border bg-card p-4 text-sm shadow-lg"
        >
          <SyncStatusPanel onDismiss={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

function describeTone(tone: Tone): string {
  switch (tone) {
    case "online":
      return "Online";
    case "offline":
      return "Offline";
    case "syncing":
      return "Syncing…";
    case "halted":
      return "Reconnect";
  }
}

function Dot({ tone }: { tone: Tone }) {
  const color =
    tone === "online"
      ? "bg-emerald-400"
      : tone === "offline"
        ? "bg-amber-400"
        : tone === "syncing"
          ? "bg-sky-400 animate-pulse"
          : "bg-red-500";
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
