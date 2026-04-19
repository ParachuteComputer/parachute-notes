import { useToastStore } from "@/lib/toast/store";
import { VaultAuthError, VaultTargetExistsError } from "@/lib/vault/client";
import { useCallback, useEffect, useId, useRef, useState } from "react";

// Shared confirm-dialog for rename (one source → target) and merge
// (many sources → target). Both operations are atomic at the vault: success
// toasts and closes; a thrown error renders inline. Rename has one special
// branch: if the target already exists (409 target_exists), we surface a
// "merge instead" affordance that re-runs via `onRunMerge`.

export interface RenameResult {
  renamed: number;
}
export interface MergeResult {
  merged: Record<string, number>;
  target: string;
}

const sumMerged = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0);

interface Props {
  mode: "rename" | "merge";
  sources: string[];
  tagOptions: string[];
  onClose(): void;
  onRun(target: string): Promise<RenameResult | MergeResult>;
  // Rename-mode only: rerun the operation as a merge when the target already
  // exists. Called with the colliding target name.
  onRunMerge?(target: string): Promise<MergeResult>;
  pending: boolean;
  offline: boolean;
}

export function TagRenameDialog({
  mode,
  sources,
  tagOptions,
  onClose,
  onRun,
  onRunMerge,
  pending,
  offline,
}: Props) {
  const pushToast = useToastStore((s) => s.push);
  const datalistId = useId();
  const [target, setTarget] = useState(mode === "rename" ? (sources[0] ?? "") : "");
  const [err, setErr] = useState<string | null>(null);
  const [collidingTarget, setCollidingTarget] = useState<string | null>(null);
  const [mergingCollision, setMergingCollision] = useState(false);
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
    !mergingCollision &&
    cleanTarget.length > 0 &&
    !(mode === "rename" && cleanTarget === sources[0]);

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return;
    setErr(null);
    setCollidingTarget(null);
    try {
      const res = await onRun(cleanTarget);
      if ("renamed" in res) {
        pushToast(`Renamed on ${res.renamed} note${res.renamed === 1 ? "" : "s"}.`, "success");
      } else {
        const total = sumMerged(res.merged);
        pushToast(
          `Merged into #${res.target} on ${total} note${total === 1 ? "" : "s"}.`,
          "success",
        );
      }
      onClose();
    } catch (e) {
      if (e instanceof VaultTargetExistsError && mode === "rename" && onRunMerge) {
        setCollidingTarget(e.target);
        return;
      }
      if (e instanceof VaultAuthError) {
        setErr("Session expired. Reconnect to retry.");
      } else {
        setErr(e instanceof Error ? e.message : "Operation failed.");
      }
    }
  }, [canConfirm, cleanTarget, mode, onClose, onRun, onRunMerge, pushToast]);

  const handleMergeInstead = useCallback(async () => {
    if (!collidingTarget || !onRunMerge) return;
    setErr(null);
    setMergingCollision(true);
    try {
      const res = await onRunMerge(collidingTarget);
      const total = sumMerged(res.merged);
      pushToast(`Merged into #${res.target} on ${total} note${total === 1 ? "" : "s"}.`, "success");
      onClose();
    } catch (e) {
      if (e instanceof VaultAuthError) {
        setErr("Session expired. Reconnect to retry.");
      } else {
        setErr(e instanceof Error ? e.message : "Merge failed.");
      }
      setMergingCollision(false);
    }
  }, [collidingTarget, onClose, onRunMerge, pushToast]);

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
          Changes apply atomically on the vault.
        </p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-fg-muted">
            {mode === "rename" ? "New tag name" : "Target tag"}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              if (collidingTarget) setCollidingTarget(null);
            }}
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
        {collidingTarget ? (
          <div
            role="alert"
            className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          >
            <p className="mb-2 text-amber-300">
              A tag named <Chip>{collidingTarget}</Chip> already exists.
            </p>
            <p className="mb-3 text-fg-muted">
              Merge <Chip>{sources[0]}</Chip> into <Chip>{collidingTarget}</Chip> instead? Notes
              that carry both end up with one copy.
            </p>
            <button
              type="button"
              onClick={() => void handleMergeInstead()}
              disabled={mergingCollision}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {mergingCollision ? "Merging…" : `Merge into #${collidingTarget}`}
            </button>
          </div>
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
      </div>
    </dialog>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">#{children}</span>
  );
}
