import { AttachmentDropZone } from "@/components/AttachmentDropZone";
import { AttachmentPicker } from "@/components/AttachmentPicker";
import { AttachmentUploadList } from "@/components/AttachmentUploadList";
import type { CodeMirrorEditorHandle } from "@/components/CodeMirrorEditor";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { DeleteNoteButton } from "@/components/DeleteNoteButton";
import { MarkdownView, buildWikilinkResolver } from "@/components/MarkdownView";
import { PinArchiveButtons } from "@/components/PinArchiveButtons";
import { RemoveAttachmentButton } from "@/components/RemoveAttachmentButton";
import { TagEditor, normalizeTag } from "@/components/TagEditor";
import { useAttachmentUploader } from "@/components/useAttachmentUploader";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import { useNote, useUpdateNote, useVaultStore } from "@/lib/vault";
import { type UpdateNotePayload, VaultAuthError, VaultConflictError } from "@/lib/vault/client";
import type { Note, NoteAttachment } from "@/lib/vault/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

export function NoteEditor() {
  const { id } = useParams<{ id: string }>();
  const decodedId = id ? decodeURIComponent(id) : undefined;
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const note = useNote(decodedId);

  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <nav className="mb-4 text-sm text-fg-dim">
        <Link
          to={decodedId ? `/notes/${encodeURIComponent(decodedId)}` : "/notes"}
          className="hover:text-accent"
        >
          ← Back to note
        </Link>
      </nav>
      {note.isPending ? (
        <EditorSkeleton />
      ) : note.isError ? (
        <ErrorBlock error={note.error} />
      ) : !note.data ? (
        <NotFoundBlock id={decodedId ?? ""} />
      ) : (
        <EditorSurface note={note.data} />
      )}
    </div>
  );
}

interface EditorState {
  content: string;
  path: string;
  tags: string[];
}

function toEditorState(note: Note): EditorState {
  return {
    content: note.content ?? "",
    path: note.path ?? "",
    tags: [...(note.tags ?? [])],
  };
}

type EditorPane = "edit" | "preview";

function EditorSurface({ note }: { note: Note }) {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const resolver = useMemo(() => buildWikilinkResolver(note), [note]);
  const [baseline, setBaseline] = useState<EditorState>(() => toEditorState(note));
  const [draft, setDraft] = useState<EditorState>(() => toEditorState(note));
  const [tagInput, setTagInput] = useState("");
  const [conflict, setConflict] = useState<VaultConflictError | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Mobile-only pane toggle. Desktop renders both side-by-side and ignores it.
  const [mobilePane, setMobilePane] = useState<EditorPane>("edit");
  const mutation = useUpdateNote(note.id);
  const lastServerNote = useRef<Note>(note);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);

  const uploader = useAttachmentUploader({
    noteId: note.id,
    onInsert: (md) => {
      if (editorRef.current) {
        editorRef.current.insertAtCursor(md);
      } else {
        setDraft((d) => ({ ...d, content: `${d.content}${md}` }));
      }
    },
    onLinked: () => {
      pushToast("Attachment added", "success");
    },
    onError: (msg) => pushToast(msg, "error"),
  });

  // If the server-side note is refetched (e.g., after a background refresh),
  // only update baseline if the user has no in-flight changes.
  useEffect(() => {
    lastServerNote.current = note;
  }, [note]);

  const isDirty =
    draft.content !== baseline.content ||
    draft.path !== baseline.path ||
    !setEquals(draft.tags, baseline.tags);

  const handleSave = useCallback(() => {
    if (!isDirty || mutation.isPending) return;
    const payload: UpdateNotePayload = {};
    if (draft.content !== baseline.content) payload.content = draft.content;
    if (draft.path !== baseline.path) payload.path = draft.path;
    const tagDiff = diffTags(baseline.tags, draft.tags);
    if (tagDiff.add.length || tagDiff.remove.length) payload.tags = tagDiff;

    // Optimistic concurrency: always send the last-known updatedAt (fall back
    // to createdAt for never-edited notes). A stale value surfaces 409 so we
    // can prompt the user to reload rather than silently clobbering a
    // concurrent write from another client.
    const ifUpdatedAt = lastServerNote.current.updatedAt ?? lastServerNote.current.createdAt;
    if (ifUpdatedAt) payload.if_updated_at = ifUpdatedAt;

    setSaveError(null);
    setConflict(null);
    mutation.mutate(payload, {
      onSuccess: (updated) => {
        setBaseline(toEditorState(updated));
        setDraft(toEditorState(updated));
        lastServerNote.current = updated;
        // If path change moved the note to a new id, land on the new URL.
        if (updated.id !== note.id) {
          navigate(`/notes/${encodeURIComponent(updated.id)}/edit`, { replace: true });
        }
      },
      onError: (err) => {
        if (err instanceof VaultConflictError) setConflict(err);
        else if (err instanceof VaultAuthError) setSaveError("Session expired. Reconnect to save.");
        else setSaveError(err instanceof Error ? err.message : "Save failed");
      },
    });
  }, [baseline, draft, isDirty, mutation, navigate, note.id]);

  const handleRevert = useCallback(() => {
    if (!isDirty) return;
    if (!confirm("Discard all edits and revert to last saved version?")) return;
    setDraft(baseline);
    setConflict(null);
    setSaveError(null);
  }, [baseline, isDirty]);

  const handleCancel = useCallback(() => {
    if (isDirty && !confirm("Discard unsaved changes?")) return;
    navigate(`/notes/${encodeURIComponent(note.id)}`);
  }, [isDirty, navigate, note.id]);

  // Prevent tab close with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const pathChanged = draft.path !== baseline.path;

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t) return;
    if (draft.tags.includes(t)) return;
    setDraft((d) => ({ ...d, tags: [...d.tags, t] }));
    setTagInput("");
  };
  const removeTag = (name: string) => {
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== name) }));
  };

  // Preview re-renders on every keystroke; the content is already in memory so
  // this is cheap. If highlighting shows up as a bottleneck later, debounce.
  const previewContent = draft.content;

  return (
    <article>
      <header className="mb-4 border-b border-border pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs uppercase tracking-wider text-fg-dim">Editing</span>
            {isDirty ? (
              <span
                className="inline-flex items-center gap-1 text-xs text-accent"
                aria-label="unsaved changes"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                unsaved
              </span>
            ) : (
              <span className="text-xs text-fg-dim">saved {relativeTime(note.updatedAt)}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PinArchiveButtons note={note} />
            <DeleteNoteButton note={note} />
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <button
              type="button"
              onClick={handleRevert}
              disabled={!isDirty || mutation.isPending}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent disabled:opacity-40"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || mutation.isPending}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              title="Save (⌘S)"
            >
              {mutation.isPending ? "Saving…" : "Save"}
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
              placeholder="(no path)"
            />
          </label>
          {pathChanged ? (
            <p className="text-xs text-accent">Renaming moves the note — its id may change.</p>
          ) : null}
          <TagEditor
            tags={draft.tags}
            input={tagInput}
            onInputChange={setTagInput}
            onAdd={addTag}
            onRemove={removeTag}
          />
        </div>
      </header>

      {conflict ? (
        <ConflictBanner
          conflict={conflict}
          onReload={() => {
            window.location.reload();
          }}
          onDismiss={() => setConflict(null)}
        />
      ) : null}
      {saveError ? (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          {saveError}
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Editor view"
        className="mb-3 inline-flex rounded-md border border-border bg-card p-0.5 text-sm lg:hidden"
      >
        {(["edit", "preview"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={mobilePane === p}
            onClick={() => setMobilePane(p)}
            className={`rounded px-3 py-1.5 capitalize ${
              mobilePane === p ? "bg-accent text-white" : "text-fg-muted hover:text-accent"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="grid min-h-[60vh] gap-4 lg:grid-cols-2">
        <AttachmentDropZone
          onDropFiles={uploader.start}
          className={`min-w-0 rounded-md border border-border bg-card ${
            mobilePane === "edit" ? "" : "hidden lg:block"
          }`}
          hint={ALLOWLIST_HINT}
        >
          <CodeMirrorEditor
            ref={editorRef}
            value={draft.content}
            onChange={(content) => setDraft((d) => ({ ...d, content }))}
            onSave={handleSave}
            onCancel={handleCancel}
            onPasteFile={(files) => {
              uploader.start(files);
              return true;
            }}
          />
        </AttachmentDropZone>
        <div
          className={`min-w-0 overflow-auto rounded-md border border-border bg-card p-4 ${
            mobilePane === "preview" ? "" : "hidden lg:block"
          }`}
        >
          <MarkdownView content={previewContent} resolve={resolver} />
        </div>
      </div>

      <AttachmentsSection
        noteId={note.id}
        attachments={note.attachments ?? []}
        uploads={uploader.uploads}
        onPickFiles={uploader.start}
        onCancel={uploader.cancel}
        onDismiss={uploader.dismiss}
      />
    </article>
  );
}

const ALLOWLIST_HINT = (
  <>
    Images, audio, webm video.{" "}
    <a
      href="https://github.com/ParachuteComputer/parachute-vault/issues/127"
      target="_blank"
      rel="noreferrer"
      className="underline"
    >
      PDF + mp4 coming
    </a>
  </>
);

function AttachmentsSection({
  noteId,
  attachments,
  uploads,
  onPickFiles,
  onCancel,
  onDismiss,
}: {
  noteId: string;
  attachments: NoteAttachment[];
  uploads: ReturnType<typeof useAttachmentUploader>["uploads"];
  onPickFiles: (files: File[]) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <section className="mt-6 border-t border-border pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-lg">Attachments</h2>
        <AttachmentPicker onPickFiles={onPickFiles} />
      </div>
      <p className="mb-3 text-xs text-fg-dim">
        Drop or paste files into the editor. Max 100 MB each. {ALLOWLIST_HINT}.
      </p>
      <AttachmentUploadList uploads={uploads} onCancel={onCancel} onDismiss={onDismiss} />
      {attachments.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded border border-border bg-card/50 px-3 py-1.5 font-mono text-xs"
            >
              <span className="truncate" title={a.path ?? a.id}>
                {a.filename ?? a.path ?? a.id}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {a.mimeType ? <span className="text-fg-dim">{a.mimeType}</span> : null}
                <RemoveAttachmentButton noteId={noteId} attachment={a} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ConflictBanner({
  conflict,
  onReload,
  onDismiss,
}: {
  conflict: VaultConflictError;
  onReload(): void;
  onDismiss(): void;
}) {
  return (
    <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="mb-1 font-medium text-amber-500">This note was edited elsewhere.</p>
      <p className="mb-3 text-sm text-fg-muted">
        Your save was rejected to avoid overwriting the other edit.
        {conflict.currentUpdatedAt
          ? ` Latest update ${relativeTime(conflict.currentUpdatedAt)}.`
          : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReload}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Reload latest (discard my edits)
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
        >
          Keep editing
        </button>
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="grid min-h-[60vh] gap-4 lg:grid-cols-2" aria-busy="true">
      <div className="animate-pulse rounded-md border border-border bg-card" />
      <div className="animate-pulse rounded-md border border-border bg-card" />
    </div>
  );
}

function NotFoundBlock({ id }: { id: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-10 text-center">
      <p className="mb-2 font-serif text-xl">Note not found</p>
      <p className="mb-4 text-sm text-fg-muted">
        No note with id <span className="font-mono">{id}</span> in this vault.
      </p>
      <Link to="/notes" className="text-sm text-accent hover:underline">
        Back to all notes
      </Link>
    </div>
  );
}

function ErrorBlock({ error }: { error: Error }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-6">
      <p className="mb-2 font-medium text-red-400">
        {isAuth ? "Session expired" : "Could not load note"}
      </p>
      <p className="mb-4 text-sm text-fg-muted">{error.message}</p>
      {isAuth ? (
        <Link
          to="/add"
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Reconnect vault
        </Link>
      ) : null}
    </div>
  );
}

function setEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const x of b) if (!set.has(x)) return false;
  return true;
}

function diffTags(before: string[], after: string[]): { add: string[]; remove: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const add = after.filter((t) => !beforeSet.has(t));
  const remove = before.filter((t) => !afterSet.has(t));
  return { add, remove };
}
