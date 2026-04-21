import { DeleteNoteButton } from "@/components/DeleteNoteButton";
import { MarkdownView, buildWikilinkResolver } from "@/components/MarkdownView";
import { NeighborhoodGraph } from "@/components/NeighborhoodGraph";
import { PinArchiveButtons } from "@/components/PinArchiveButtons";
import { TranscriptionStatus } from "@/components/TranscriptionStatus";
import { pushRecent } from "@/lib/quick-switch/recents";
import { relativeTime } from "@/lib/time";
import { useActiveVaultClient, useNote, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note, NoteAttachment, NoteLink } from "@/lib/vault/types";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";

export function NoteView() {
  const { id } = useParams<{ id: string }>();
  const decodedId = id ? decodeURIComponent(id) : undefined;
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const note = useNote(decodedId);

  useEffect(() => {
    if (activeVault && decodedId) pushRecent(activeVault.id, decodedId);
  }, [activeVault, decodedId]);

  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-6 text-sm text-fg-dim">
        <Link to="/" className="hover:text-accent">
          ← All notes
        </Link>
      </nav>

      {note.isPending ? (
        <NoteSkeleton />
      ) : note.isError ? (
        <ErrorBlock error={note.error} />
      ) : !note.data ? (
        <NotFoundBlock id={decodedId ?? ""} />
      ) : (
        <NoteBody note={note.data} />
      )}
    </div>
  );
}

function NoteBody({ note }: { note: Note }) {
  const resolver = useMemo(() => buildWikilinkResolver(note), [note]);
  const label = note.path ?? note.id;
  const summary = typeof note.metadata?.summary === "string" ? note.metadata.summary : null;
  const inbound = useMemo(
    () =>
      (note.links ?? []).filter(
        (l) => l.targetId === note.id && l.sourceId !== note.id && l.sourceNote,
      ),
    [note],
  );
  const outbound = useMemo(() => {
    const seen = new Set<string>();
    const out: NoteLink[] = [];
    for (const l of note.links ?? []) {
      if (l.sourceId !== note.id || l.targetId === note.id) continue;
      if (!l.targetNote) continue;
      if (seen.has(l.targetId)) continue;
      seen.add(l.targetId);
      out.push(l);
    }
    return out;
  }, [note]);

  return (
    <article className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <header className="mb-6 border-b border-border pb-4">
          <p className="font-mono text-xs text-fg-dim break-all">{label}</p>
          <h1 className="mt-1 font-serif text-3xl tracking-tight">
            {note.path ? pathTitle(note.path) : note.id}
          </h1>
          {summary ? <p className="mt-3 text-fg-muted">{summary}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              to={`/n/${encodeURIComponent(note.id)}/edit`}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent"
            >
              Edit
            </Link>
            <PinArchiveButtons note={note} keyboard />
            <DeleteNoteButton note={note} />
          </div>
        </header>

        <TranscriptionStatus content={note.content ?? ""} />

        <MarkdownView content={note.content ?? ""} resolve={resolver} />

        {note.attachments && note.attachments.length > 0 ? (
          <section className="mt-10 border-t border-border pt-6">
            <h2 className="mb-3 font-serif text-xl">Attachments</h2>
            <div className="space-y-6">
              {note.attachments.map((a) => (
                <AttachmentView key={a.id} attachment={a} />
              ))}
            </div>
          </section>
        ) : null}

        <NeighborhoodGraph anchor={note} />
      </div>

      <aside className="space-y-6 text-sm lg:sticky lg:top-24 lg:self-start">
        <MetadataPanel note={note} />
        {note.tags && note.tags.length > 0 ? <TagsPanel tags={note.tags} /> : null}
        {outbound.length > 0 ? (
          <LinksPanel title="Outbound" links={outbound} peer="target" />
        ) : null}
        {inbound.length > 0 ? <LinksPanel title="Inbound" links={inbound} peer="source" /> : null}
      </aside>
    </article>
  );
}

function pathTitle(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}

function MetadataPanel({ note }: { note: Note }) {
  const created = note.createdAt;
  const updated = note.updatedAt;
  const metaEntries = Object.entries(note.metadata ?? {}).filter(([key]) => key !== "summary");

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">Metadata</h2>
      <dl className="space-y-1.5 text-sm">
        {note.path ? (
          <Row
            label="Path"
            value={<span className="font-mono text-xs break-all">{note.path}</span>}
          />
        ) : null}
        <Row label="ID" value={<span className="font-mono text-xs break-all">{note.id}</span>} />
        <Row label="Created" value={<time title={created}>{relativeTime(created)}</time>} />
        {updated ? (
          <Row label="Updated" value={<time title={updated}>{relativeTime(updated)}</time>} />
        ) : null}
        {metaEntries.map(([key, value]) => (
          <Row
            key={key}
            label={key}
            value={<span className="break-all text-fg-muted">{String(value)}</span>}
          />
        ))}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wider text-fg-dim">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function TagsPanel({ tags }: { tags: string[] }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">Tags</h2>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <Link
            key={t}
            to={`/?tag=${encodeURIComponent(t)}`}
            className="rounded-full border border-border bg-bg/60 px-2 py-0.5 text-xs text-fg-dim hover:text-accent"
          >
            {t}
          </Link>
        ))}
      </div>
    </section>
  );
}

function LinksPanel({
  title,
  links,
  peer,
}: {
  title: string;
  links: NoteLink[];
  peer: "source" | "target";
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">
        {title} ({links.length})
      </h2>
      <ul className="space-y-1.5">
        {links.map((l) => {
          const peerNote = peer === "source" ? l.sourceNote : l.targetNote;
          if (!peerNote) return null;
          const label = peerNote.path ?? peerNote.id;
          const summary =
            typeof peerNote.metadata?.summary === "string" ? peerNote.metadata.summary : null;
          return (
            <li key={`${l.sourceId}->${l.targetId}:${l.relationship}`}>
              <Link
                to={`/n/${encodeURIComponent(peerNote.id)}`}
                className="block rounded px-1 py-0.5 hover:bg-bg/50"
              >
                <div className="truncate font-mono text-xs text-fg-muted hover:text-accent">
                  {label}
                </div>
                {summary ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-fg-dim">{summary}</div>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AttachmentView({ attachment }: { attachment: NoteAttachment }) {
  const mime = (attachment.mimeType ?? "").toLowerCase();
  const filename = attachment.filename ?? attachment.id;

  return (
    <figure className="rounded-md border border-border bg-card p-3">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="truncate font-mono text-xs text-fg-muted">{filename}</span>
        {typeof attachment.size === "number" ? (
          <span className="shrink-0 text-xs text-fg-dim">{formatBytes(attachment.size)}</span>
        ) : null}
      </figcaption>
      <AttachmentBody attachment={attachment} mime={mime} filename={filename} />
    </figure>
  );
}

function AttachmentBody({
  attachment,
  mime,
  filename,
}: {
  attachment: NoteAttachment;
  mime: string;
  filename: string;
}) {
  const client = useActiveVaultClient();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kind = attachmentKind(mime, filename);
  const needsBlob = kind !== "other";
  const src = attachment.url;

  useEffect(() => {
    if (!needsBlob || !src || !client) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setError(null);
    client
      .fetchAttachmentBlob(src)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load attachment");
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [needsBlob, src, client]);

  if (!src) {
    return <p className="text-sm text-fg-dim">(no URL)</p>;
  }
  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (needsBlob && !blobUrl) {
    return <div className="h-32 animate-pulse rounded bg-border/40" aria-busy="true" />;
  }

  const displayUrl = blobUrl ?? src;
  if (kind === "image") {
    return <img src={displayUrl} alt={filename} className="max-h-[32rem] rounded" />;
  }
  if (kind === "audio") {
    // biome-ignore lint/a11y/useMediaCaption: vault attachments don't carry caption tracks
    return <audio controls src={displayUrl} className="w-full" />;
  }
  if (kind === "video") {
    // biome-ignore lint/a11y/useMediaCaption: vault attachments don't carry caption tracks
    return <video controls src={displayUrl} className="w-full rounded" />;
  }
  if (kind === "pdf") {
    return (
      <>
        <iframe
          src={displayUrl}
          title={filename}
          className="h-[40rem] w-full rounded border border-border"
        />
        <a
          href={displayUrl}
          download={filename}
          className="mt-2 inline-block text-sm text-accent hover:underline"
        >
          Download {filename}
        </a>
      </>
    );
  }
  return (
    <a href={displayUrl} download={filename} className="text-sm text-accent hover:underline">
      Download {filename}
    </a>
  );
}

function attachmentKind(
  mime: string,
  filename: string,
): "image" | "audio" | "video" | "pdf" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (ext === "pdf") return "pdf";
  return "other";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function NoteSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]" aria-busy="true">
      <div className="min-w-0 space-y-3">
        <div className="h-3 w-32 animate-pulse rounded bg-border/40" />
        <div className="h-8 w-2/3 animate-pulse rounded bg-border/60" />
        <div className="h-4 w-full animate-pulse rounded bg-border/30" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-border/30"
              style={{ width: `${70 + ((i * 13) % 25)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded bg-border/30" />
        <div className="h-24 animate-pulse rounded bg-border/30" />
      </div>
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
      <Link to="/" className="text-sm text-accent hover:underline">
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
