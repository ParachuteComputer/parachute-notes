import { useToastStore } from "@/lib/toast/store";
import { useDeleteAttachment } from "@/lib/vault";
import { VaultAuthError, VaultNotFoundError } from "@/lib/vault/client";
import type { NoteAttachment } from "@/lib/vault/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  noteId: string;
  attachment: NoteAttachment;
}

// Short delay before the Remove button becomes clickable. Prevents a double-click
// on the trash icon from landing straight on Remove. 250ms is below the threshold
// where users notice it as "slow" but above the ~100ms where accidental clicks land.
const CONFIRM_ARM_DELAY_MS = 250;

export function RemoveAttachmentButton({ noteId, attachment }: Props) {
  const [open, setOpen] = useState(false);
  const label = labelFor(attachment);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Remove attachment ${label}`}
        className="shrink-0 rounded border border-transparent px-1.5 py-0.5 text-fg-dim hover:border-red-500/40 hover:text-red-400"
      >
        ✕
      </button>
      {open ? (
        <ConfirmRemoveDialog
          noteId={noteId}
          attachment={attachment}
          label={label}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ConfirmRemoveDialog({
  noteId,
  attachment,
  label,
  onClose,
}: {
  noteId: string;
  attachment: NoteAttachment;
  label: string;
  onClose(): void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const mutation = useDeleteAttachment();
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), CONFIRM_ARM_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleConfirm = useCallback(() => {
    if (!armed || mutation.isPending) return;
    setErr(null);
    mutation.mutate(
      { noteId, attachmentId: attachment.id },
      {
        onSuccess: () => {
          pushToast(`Removed ${label}`, "success");
          onClose();
        },
        onError: (e) => {
          if (e instanceof VaultAuthError) {
            setErr("Session expired. Reconnect to remove attachments.");
            return;
          }
          if (e instanceof VaultNotFoundError) {
            // Already gone — the attachment list query is invalidated by the
            // hook's onSuccess path, but for 404 we still want to refresh UI
            // and let the user know.
            pushToast(`Already removed ${label}`, "info");
            onClose();
            return;
          }
          setErr(e instanceof Error ? e.message : "Remove failed");
        },
      },
    );
  }, [armed, attachment.id, label, mutation, noteId, onClose, pushToast]);

  return (
    <dialog
      open
      aria-labelledby="confirm-remove-attachment-title"
      className="fixed inset-0 z-40 m-0 flex h-full max-h-full w-full max-w-full items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl">
        <h2 id="confirm-remove-attachment-title" className="mb-2 font-serif text-lg text-red-400">
          Remove attachment?
        </h2>
        <p className="mb-3 text-sm text-fg-muted">
          <span className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">{label}</span>{" "}
          will be detached from this note. If no other note references the file, it will also be
          deleted from storage. Markdown referencing it will show a broken link until you update it.
        </p>
        {err ? (
          <p role="alert" className="mb-3 text-sm text-red-400">
            {err}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!armed || mutation.isPending}
            className="rounded-md bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
          >
            {mutation.isPending ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function labelFor(a: NoteAttachment): string {
  if (a.filename) return a.filename;
  if (a.path) {
    const last = a.path.split("/").pop();
    if (last) return last;
    return a.path;
  }
  return a.id;
}
