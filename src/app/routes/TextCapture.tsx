import { TagEditor, normalizeTag } from "@/components/TagEditor";
import { enqueue, newLocalId } from "@/lib/sync";
import { useToastStore } from "@/lib/toast/store";
import { useTagRoles, useVaultStore } from "@/lib/vault";
import { useSync } from "@/providers/SyncProvider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Apple-Notes-fast typed capture. Pure text + inline tag editor, no path or
// metadata — the vault auto-names the note from its first line.
//
// Save semantics:
//   - Cmd/Ctrl+Enter or the Capture button — enqueue create-note, reset
//     editor in place, stay on /capture so the next thought lands fast.
//   - On unmount (tab-switch, nav away) with non-empty content — a
//     silent flush enqueues the draft. The queue is offline-safe, so this is
//     the thing that makes the experience feel Apple-Notes-like: typing
//     something and walking away never loses work.
//   - Empty content is always discarded (no zero-content notes).
//
// The visible button is still there because a discoverable save affordance
// matters more than absolute chrome-minimalism, and Cmd+Enter is invisible on
// touch devices.

export function TextCapture() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const pushToast = useToastStore((s) => s.push);
  const { db, engine } = useSync();
  const { roles } = useTagRoles(activeVault?.id ?? null);

  const defaultTags = useMemo(() => [roles.captureText], [roles.captureText]);
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>(() => [roles.captureText]);
  const [tagInput, setTagInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Unmount-flush uses refs to avoid tearing the cleanup effect's deps. A naive
  // `useEffect(() => cleanup, [db, content, tags, …])` would fire the flush on
  // every keystroke; we want it exactly once — at real unmount.
  const latest = useRef({ db, activeVaultId: activeVault?.id ?? null, content, tags });
  latest.current = { db, activeVaultId: activeVault?.id ?? null, content, tags };

  const save = useCallback(async (): Promise<boolean> => {
    const text = content.trim();
    if (!text) return false;
    if (!db || !activeVault) {
      pushToast("Sync queue not ready — try again in a moment.", "error");
      return false;
    }
    const localId = newLocalId();
    const cleanTags = tags.filter((t) => t.length > 0);
    try {
      await enqueue(
        db,
        {
          kind: "create-note",
          localId,
          payload: {
            content,
            ...(cleanTags.length ? { tags: cleanTags } : {}),
          },
        },
        { vaultId: activeVault.id },
      );
      void engine?.runOnce();
      setContent("");
      setTags(defaultTags);
      setTagInput("");
      pushToast("Captured.", "success");
      // Keep focus so the user can dash off the next thought.
      textareaRef.current?.focus();
      return true;
    } catch (e) {
      pushToast(e instanceof Error ? `Capture failed: ${e.message}` : "Capture failed.", "error");
      return false;
    }
  }, [content, tags, db, activeVault, engine, pushToast, defaultTags]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void save();
      }
    },
    [save],
  );

  // Focus on mount so typing is the first thing a user does — same UX as
  // autoFocus, but satisfies the a11y lint that flags the attribute itself.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      const { db, activeVaultId, content, tags } = latest.current;
      const text = content.trim();
      if (!text || !db || !activeVaultId) return;
      const cleanTags = tags.filter((t) => t.length > 0);
      // Fire-and-forget: IDB writes complete synchronously at the
      // microtask level, so the enqueue usually lands even during navigation.
      void enqueue(
        db,
        {
          kind: "create-note",
          localId: newLocalId(),
          payload: {
            content,
            ...(cleanTags.length ? { tags: cleanTags } : {}),
          },
        },
        { vaultId: activeVaultId },
      );
    };
  }, []);

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagInput("");
  };
  const removeTag = (name: string) => {
    setTags((prev) => prev.filter((x) => x !== name));
  };

  const isDirty = content.trim().length > 0;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <header>
        <h2 className="font-serif text-xl text-fg">Quick note</h2>
        <p className="mt-1 text-xs text-fg-dim">
          Start typing. <kbd className="rounded bg-bg/60 px-1">⌘</kbd>
          <kbd className="rounded bg-bg/60 px-1">↵</kbd> to capture and keep going. Leaves without
          ceremony if you walk away.
        </p>
      </header>

      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="What are you thinking?"
        aria-label="Quick note content"
        rows={10}
        className="min-h-[40vh] w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
      />

      <TagEditor
        tags={tags}
        input={tagInput}
        onInputChange={setTagInput}
        onAdd={addTag}
        onRemove={removeTag}
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!isDirty}
          className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          Capture
        </button>
        <span className="text-xs text-fg-dim">
          {isDirty ? "Draft — will save on capture or when you leave." : "Nothing to save yet."}
        </span>
      </div>
    </section>
  );
}
