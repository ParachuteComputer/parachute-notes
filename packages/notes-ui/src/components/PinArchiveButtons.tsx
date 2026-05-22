import { useToastStore } from "@/lib/toast/store";
import { useTagRoles, useUpdateNote, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { useCallback, useEffect } from "react";

interface Props {
  note: Note;
  keyboard?: boolean;
}

export function PinArchiveButtons({ note, keyboard = false }: Props) {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const pushToast = useToastStore((s) => s.push);
  const mutation = useUpdateNote(note.id);

  const isPinned = note.tags?.includes(roles.pinned) ?? false;
  const isArchived = note.tags?.includes(roles.archived) ?? false;

  const toggle = useCallback(
    (role: "pinned" | "archived") => {
      if (mutation.isPending) return;
      const tag = roles[role];
      const has = note.tags?.includes(tag) ?? false;
      mutation.mutate(
        { tags: has ? { remove: [tag] } : { add: [tag] } },
        {
          onSuccess: () => {
            pushToast(
              role === "pinned" ? (has ? "Unpinned" : "Pinned") : has ? "Unarchived" : "Archived",
              "success",
            );
          },
          onError: (err) => {
            if (err instanceof VaultAuthError) pushToast("Session expired. Reconnect.", "error");
            else pushToast(err instanceof Error ? err.message : "Update failed", "error");
          },
        },
      );
    },
    [mutation, note.tags, pushToast, roles],
  );

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        toggle("pinned");
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        toggle("archived");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, toggle]);

  return (
    <>
      <button
        type="button"
        onClick={() => toggle("pinned")}
        disabled={mutation.isPending}
        aria-pressed={isPinned}
        title={isPinned ? `Unpin (${roles.pinned})` : `Pin as #${roles.pinned} (P)`}
        className={
          isPinned
            ? "min-h-11 rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20 disabled:opacity-40"
            : "min-h-11 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent disabled:opacity-40"
        }
      >
        {isPinned ? "★ Pinned" : "☆ Pin"}
      </button>
      <button
        type="button"
        onClick={() => toggle("archived")}
        disabled={mutation.isPending}
        aria-pressed={isArchived}
        title={isArchived ? `Unarchive (${roles.archived})` : `Archive as #${roles.archived} (A)`}
        className={
          isArchived
            ? "min-h-11 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-500 hover:bg-amber-500/20 disabled:opacity-40"
            : "min-h-11 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent disabled:opacity-40"
        }
      >
        {isArchived ? "Archived" : "Archive"}
      </button>
    </>
  );
}
