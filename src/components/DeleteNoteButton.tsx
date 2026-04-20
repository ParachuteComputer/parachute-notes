import { useToastStore } from "@/lib/toast/store";
import { useDeleteNote } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

interface Props {
  note: Note;
  className?: string;
  label?: string;
}

export function DeleteNoteButton({ note, className, label = "Delete" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "rounded-md border border-red-500/40 bg-transparent px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
        }
        title="Delete this note"
      >
        {label}
      </button>
      {open ? <ConfirmDeleteDialog note={note} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ConfirmDeleteDialog({ note, onClose }: { note: Note; onClose(): void }) {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const mutation = useDeleteNote();
  const confirmLabel = note.path ?? note.id;
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canConfirm = typed === confirmLabel && !mutation.isPending;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    setErr(null);
    mutation.mutate(note.id, {
      onSuccess: () => {
        pushToast(`Deleted ${confirmLabel}`, "success");
        navigate("/");
      },
      onError: (e) => {
        if (e instanceof VaultAuthError) {
          setErr("Session expired. Reconnect to delete.");
        } else {
          setErr(e instanceof Error ? e.message : "Delete failed");
        }
      },
    });
  }, [canConfirm, confirmLabel, mutation, navigate, note.id, pushToast]);

  return (
    <dialog
      open
      aria-labelledby="confirm-delete-title"
      className="fixed inset-0 z-40 m-0 flex h-full max-h-full w-full max-w-full items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl">
        <h2 id="confirm-delete-title" className="mb-2 font-serif text-xl text-red-400">
          Delete this note?
        </h2>
        <p className="mb-3 text-sm text-fg-muted">
          This permanently removes the note, its tags, and its links. This cannot be undone.
        </p>
        <p className="mb-3 text-sm text-fg-muted">
          Type{" "}
          <span className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">
            {confirmLabel}
          </span>{" "}
          to confirm:
        </p>
        <input
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) handleConfirm();
          }}
          aria-label="Type note path to confirm"
          className="mb-3 w-full rounded-md border border-border bg-bg/40 px-2.5 py-1.5 font-mono text-sm text-fg focus:border-red-400 focus:outline-none"
          placeholder={confirmLabel}
          autoComplete="off"
          spellCheck={false}
        />
        {err ? (
          <p role="alert" className="mb-3 text-sm text-red-400">
            {err}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-md bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
          >
            {mutation.isPending ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
