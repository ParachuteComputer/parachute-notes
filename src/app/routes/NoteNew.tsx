import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { MarkdownView, buildWikilinkResolver } from "@/components/MarkdownView";
import { TagEditor, normalizeTag } from "@/components/TagEditor";
import { useToastStore } from "@/lib/toast/store";
import { useCreateNote, useVaultStore } from "@/lib/vault";
import { type CreateNotePayload, VaultAuthError } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

interface DraftState {
  content: string;
  path: string;
  tags: string[];
  summary: string;
}

const EMPTY_DRAFT: DraftState = { content: "", path: "", tags: [], summary: "" };

export function NoteNew() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const mutation = useCreateNote();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [tagInput, setTagInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!activeVault) return <Navigate to="/" replace />;

  const isDirty =
    draft.content.length > 0 ||
    draft.path.length > 0 ||
    draft.tags.length > 0 ||
    draft.summary.length > 0;

  const isValid = draft.content.trim().length > 0 && draft.path.trim().length > 0;

  const handleCreate = useCallback(() => {
    if (!isValid || mutation.isPending) return;
    const payload: CreateNotePayload = {
      content: draft.content,
      path: draft.path.trim(),
    };
    if (draft.tags.length) payload.tags = draft.tags;
    const summary = draft.summary.trim();
    if (summary) payload.metadata = { summary };

    setSaveError(null);
    mutation.mutate(payload, {
      onSuccess: (created: Note) => {
        pushToast(`Created ${created.path ?? created.id}`, "success");
        navigate(`/notes/${encodeURIComponent(created.id)}`);
      },
      onError: (err) => {
        if (err instanceof VaultAuthError) {
          setSaveError("Session expired. Reconnect to save.");
        } else {
          // Vault returns 500 with "Internal server error" on duplicate paths;
          // surface whatever message we got so the user can adjust the path.
          setSaveError(
            err instanceof Error
              ? `${err.message} — if the path is taken, try a different one.`
              : "Create failed",
          );
        }
      },
    });
  }, [draft, isValid, mutation, navigate, pushToast]);

  const handleCancel = useCallback(() => {
    if (isDirty && !confirm("Discard this draft?")) return;
    navigate("/notes");
  }, [isDirty, navigate]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t || draft.tags.includes(t)) return;
    setDraft((d) => ({ ...d, tags: [...d.tags, t] }));
    setTagInput("");
  };
  const removeTag = (name: string) => {
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== name) }));
  };

  const resolver = buildWikilinkResolver({
    id: "__new__",
    createdAt: new Date().toISOString(),
  } as Note);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <nav className="mb-4 text-sm text-fg-dim">
        <Link to="/notes" className="hover:text-accent">
          ← All notes
        </Link>
      </nav>

      <article>
        <header className="mb-4 border-b border-border pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-fg-dim">New note</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!isValid || mutation.isPending}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                title="Create (⌘S)"
              >
                {mutation.isPending ? "Creating…" : "Create"}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-baseline gap-3 text-sm">
              <span className="shrink-0 text-xs uppercase tracking-wider text-fg-dim">Path</span>
              <input
                type="text"
                value={draft.path}
                onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
                className="flex-1 rounded-md border border-border bg-card px-2.5 py-1 font-mono text-sm text-fg focus:border-accent focus:outline-none"
                aria-label="Note path"
                placeholder="e.g. Projects/README"
              />
            </label>
            <label className="flex items-baseline gap-3 text-sm">
              <span className="shrink-0 text-xs uppercase tracking-wider text-fg-dim">Summary</span>
              <input
                type="text"
                value={draft.summary}
                onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
                className="flex-1 rounded-md border border-border bg-card px-2.5 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                aria-label="Note summary"
                placeholder="(optional one-line description)"
              />
            </label>
            <TagEditor
              tags={draft.tags}
              input={tagInput}
              onInputChange={setTagInput}
              onAdd={addTag}
              onRemove={removeTag}
            />
          </div>
        </header>

        {saveError ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400"
          >
            {saveError}
          </div>
        ) : null}

        <div className="grid min-h-[60vh] gap-4 lg:grid-cols-2">
          <div className="min-w-0 rounded-md border border-border bg-card">
            <CodeMirrorEditor
              value={draft.content}
              onChange={(content) => setDraft((d) => ({ ...d, content }))}
              onSave={handleCreate}
              onCancel={handleCancel}
            />
          </div>
          <div className="min-w-0 overflow-auto rounded-md border border-border bg-card p-4">
            {draft.content.trim() ? (
              <MarkdownView content={draft.content} resolve={resolver} />
            ) : (
              <p className="text-sm text-fg-dim">Preview appears here as you type.</p>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
