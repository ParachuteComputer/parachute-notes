import {
  type PendingPayload,
  type PendingRow,
  clearPendingForVault,
  discardRow,
  estimate,
  retryRow,
  useQueueStatus,
} from "@/lib/sync";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault";
import { useSync } from "@/providers/SyncProvider";
import { useEffect, useState } from "react";
import { Link } from "react-router";

// Detail popover opened from the header indicator. Everything here runs off a
// live polling hook (useQueueStatus) so the user sees the queue change
// without manually refreshing. Destructive actions (discard, clear-all) gate
// on a confirm().

const KIND_LABELS: Record<string, string> = {
  "create-note": "new notes",
  "update-note": "note edits",
  "delete-note": "deletions",
  "upload-attachment": "uploads",
  "link-attachment": "attachment links",
  "delete-attachment": "attachment removals",
};

// Trip point for the storage warning. At 80% of quota we surface a gentle
// nudge — iOS Safari caps OPFS/IDB at roughly 50 MB, so running out while
// offline is a real hazard worth flagging.
const STORAGE_WARN_THRESHOLD = 0.8;

export function SyncStatusPanel({ onDismiss }: { onDismiss?: () => void }) {
  const { db, isOnline, isDraining, lastSyncedAt } = useSync();
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const pushToast = useToastStore((s) => s.push);
  const status = useQueueStatus(db, activeVaultId);

  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  // Live-tick the "Last synced" relative time without jamming the main render.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void estimate().then((r) => {
      if (cancelled) return;
      if (r.supported && typeof r.usage === "number" && typeof r.quota === "number") {
        setQuota({ usage: r.usage, quota: r.quota });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stateHeadline = status.authHalt
    ? "Reconnect needed"
    : !isOnline
      ? "Offline — changes queued"
      : isDraining
        ? "Syncing…"
        : status.total > 0
          ? "Sync pending"
          : "All caught up";

  const handleRetry = async (seq: number) => {
    if (!db) return;
    await retryRow(db, seq);
    pushToast("Retrying…", "success");
  };
  const handleDiscard = async (seq: number, row: PendingRow) => {
    if (!db) return;
    if (!confirm(`Discard this ${describeMutation(row.mutation)}? It cannot be recovered.`)) return;
    await discardRow(db, seq);
    pushToast("Row discarded.", "success");
  };
  const handleClearAll = async () => {
    if (!db || !activeVaultId) return;
    if (!confirm(`Clear every pending row for this vault (${status.total} total)? Destructive.`))
      return;
    const n = await clearPendingForVault(db, activeVaultId);
    pushToast(`Cleared ${n} pending row${n === 1 ? "" : "s"}.`, "success");
  };

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h3 className="font-serif text-base text-fg">{stateHeadline}</h3>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close sync status"
            className="text-xs text-fg-dim hover:text-accent"
          >
            ×
          </button>
        ) : null}
      </header>

      {status.authHalt ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
          <p className="mb-2">{status.authHalt.message || "Vault rejected the current session."}</p>
          <Link
            to="/add"
            onClick={onDismiss}
            className="inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            Reconnect to resume sync
          </Link>
        </div>
      ) : null}

      {status.total === 0 ? (
        <p className="text-xs text-fg-dim">Nothing pending in this vault.</p>
      ) : (
        <section>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-fg-dim">Queue</h4>
          <ul className="space-y-0.5 text-xs">
            {Object.entries(status.byKind).map(([kind, count]) => (
              <li key={kind} className="flex justify-between">
                <span className="text-fg-muted">{KIND_LABELS[kind] ?? kind}</span>
                <span className="tabular-nums text-fg-dim">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status.needsHumanCount > 0 ? (
        <section>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-fg-dim">Needs your help</h4>
          <ul className="space-y-1.5">
            {status.rows
              .filter((r) => r.status === "needs-human")
              .map((row) => (
                <li
                  key={row.seq}
                  className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs"
                >
                  <p className="font-medium text-amber-200">{describeMutation(row.mutation)}</p>
                  {row.lastError ? (
                    <p className="mt-0.5 break-words text-amber-100/70">{row.lastError}</p>
                  ) : null}
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleRetry(row.seq)}
                      className="text-accent hover:underline"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDiscard(row.seq, row)}
                      className="text-red-300 hover:underline"
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="text-xs text-fg-dim">
        <p>
          Last synced:{" "}
          <span className="text-fg-muted">
            {lastSyncedAt ? relativeTime(new Date(lastSyncedAt).toISOString()) : "never"}
          </span>
        </p>
      </section>

      {quota ? <StorageBar usage={quota.usage} quota={quota.quota} /> : null}

      {status.total > 0 ? (
        <div className="flex justify-end border-t border-border pt-3">
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-red-400 hover:underline"
          >
            Clear all pending
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function describeMutation(m: PendingPayload): string {
  switch (m.kind) {
    case "create-note":
      return `Create note (${m.payload.path ?? "untitled"})`;
    case "update-note":
      return `Update note ${m.targetId}`;
    case "update-settings":
      return `Update settings (${m.notePath})`;
    case "delete-note":
      return `Delete note ${m.targetId}`;
    case "upload-attachment":
      return `Upload ${m.filename}`;
    case "link-attachment":
      return `Link attachment to ${m.noteId}`;
    case "delete-attachment":
      return `Remove attachment from ${m.noteId}`;
  }
}

function StorageBar({ usage, quota }: { usage: number; quota: number }) {
  const pct = quota > 0 ? usage / quota : 0;
  const warn = pct >= STORAGE_WARN_THRESHOLD;
  return (
    <section className="text-xs">
      <div className="mb-1 flex justify-between text-fg-dim">
        <span>Storage</span>
        <span className={warn ? "text-amber-300" : "text-fg-muted"}>
          {formatBytes(usage)} / {formatBytes(quota)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
        <div
          className={`h-full ${warn ? "bg-amber-400" : "bg-accent"}`}
          style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
        />
      </div>
      {warn ? (
        <p className="mt-1 text-amber-300">
          Nearly full. Sync what you can and consider clearing stuck rows.
        </p>
      ) : null}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
