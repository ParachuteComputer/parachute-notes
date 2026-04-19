import { useToastStore } from "@/lib/toast/store";
import { VaultAuthError } from "@/lib/vault/client";
import type { TagMutationResult } from "@/lib/vault/tag-mutations";
import { useCallback, useEffect, useId, useRef, useState } from "react";

// Shared confirm-dialog for rename (one source → target) and merge
// (many sources → target). Both operations share a partial-failure UX:
// after a successful but imperfect run, we hold the dialog open to show
// per-note errors rather than toast-and-close.

interface Props {
  mode: "rename" | "merge";
  sources: string[];
  tagOptions: string[];
  onClose(): void;
  onRun(target: string): Promise<TagMutationResult | TagMutationResult[]>;
  pending: boolean;
  offline: boolean;
}

export function TagRenameDialog({
  mode,
  sources,
  tagOptions,
  onClose,
  onRun,
  pending,
  offline,
}: Props) {
  const pushToast = useToastStore((s) => s.push);
  const datalistId = useId();
  const [target, setTarget] = useState(mode === "rename" ? (sources[0] ?? "") : "");
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<TagMutationResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cleanTarget = target.trim().replace(/^#/, "");
  const canConfirm =
    !pending &&
    !offline &&
    cleanTarget.length > 0 &&
    !(mode === "rename" && cleanTarget === sources[0]);

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return;
    setErr(null);
    try {
      const res = await onRun(cleanTarget);
      const arr = Array.isArray(res) ? res : [res];
      const anyFailed = arr.some((r) => r.failed.length > 0);
      if (anyFailed) {
        setResults(arr);
        return;
      }
      const total = arr.reduce((s, r) => s + r.succeeded, 0);
      pushToast(
        mode === "rename"
          ? `Renamed on ${total} note${total === 1 ? "" : "s"}.`
          : `Merged into #${cleanTarget} on ${total} note${total === 1 ? "" : "s"}.`,
        "success",
      );
      onClose();
    } catch (e) {
      if (e instanceof VaultAuthError) {
        setErr("Session expired. Reconnect to retry.");
      } else {
        setErr(e instanceof Error ? e.message : "Operation failed.");
      }
    }
  }, [canConfirm, cleanTarget, mode, onClose, onRun, pushToast]);

  const title = mode === "rename" ? "Rename tag" : `Merge ${sources.length} tags`;

  return (
    <dialog
      open
      aria-labelledby="tag-op-title"
      className="fixed inset-0 z-40 m-0 flex h-full max-h-full w-full max-w-full items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl">
        <h2 id="tag-op-title" className="mb-2 font-serif text-xl text-fg">
          {title}
        </h2>
        {results ? (
          <PartialFailureBody results={results} mode={mode} onClose={onClose} />
        ) : (
          <>
            <p className="mb-3 text-sm text-fg-muted">
              {mode === "rename" ? (
                <>
                  Rename <Chip>{sources[0]}</Chip> on every note that carries it. Notes that already
                  have the new tag will end up with one copy.
                </>
              ) : (
                <>
                  Combine{" "}
                  {sources.map((s, i) => (
                    <span key={s}>
                      <Chip>{s}</Chip>
                      {i < sources.length - 1 ? ", " : ""}
                    </span>
                  ))}{" "}
                  into one tag. The originals are removed.
                </>
              )}{" "}
              Changes apply now — there's no undo, but the operation is idempotent if you retry.
            </p>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-fg-muted">
                {mode === "rename" ? "New tag name" : "Target tag"}
              </span>
              <input
                ref={inputRef}
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canConfirm) void handleConfirm();
                }}
                list={datalistId}
                aria-label={mode === "rename" ? "New tag name" : "Merge target tag"}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full rounded-md border border-border bg-bg/40 px-2.5 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
                autoComplete="off"
              />
              <datalist id={datalistId}>
                {tagOptions.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            {offline ? (
              <p className="mb-3 text-sm text-amber-300">
                Offline — tag operations need a live vault connection.
              </p>
            ) : null}
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
                onClick={() => void handleConfirm()}
                disabled={!canConfirm}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {pending
                  ? mode === "rename"
                    ? "Renaming…"
                    : "Merging…"
                  : mode === "rename"
                    ? "Rename"
                    : "Merge"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function PartialFailureBody({
  results,
  mode,
  onClose,
}: {
  results: TagMutationResult[];
  mode: "rename" | "merge";
  onClose(): void;
}) {
  const succeeded = results.reduce((s, r) => s + r.succeeded, 0);
  const failed = results.flatMap((r) => r.failed);
  return (
    <>
      <p className="mb-3 text-sm text-fg-muted">
        {mode === "rename" ? "Rename" : "Merge"} finished with errors. {succeeded} note
        {succeeded === 1 ? "" : "s"} updated, {failed.length} failed. Retrying is safe — the
        successful notes won't be touched again.
      </p>
      <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-bg/40 p-2 text-xs">
        {failed.map((f, i) => (
          <li key={`${f.noteId}-${i}`} className="font-mono text-red-400">
            <span className="text-fg-muted">{f.path ?? f.noteId}:</span> {f.error}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Close
        </button>
      </div>
    </>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">#{children}</span>
  );
}
