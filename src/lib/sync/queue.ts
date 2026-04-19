import { ScribeError, type ScribeSettings, transcribeAudio } from "@/lib/scribe";
import {
  VaultAuthError,
  type VaultClient,
  VaultConflictError,
  VaultNotFoundError,
} from "@/lib/vault/client";
import type { BlobStore } from "./blob-store";
import { type LensDB, setMeta } from "./db";
import {
  blobIdFromRef,
  isBlobRef,
  recordBlobPath,
  recordIdMap,
  resolveBlobPath,
  resolveNoteId,
} from "./id-map";
import type { DrainOutcome, PendingPayload, PendingRow } from "./types";

// Key into `meta` set when the drain hits an auth error. UI reads this to
// prompt reconnect; cleared once the user re-authenticates.
export const AUTH_HALT_META = "auth-halted";

// Backoff schedule for transient errors. Caps at 10 minutes to keep the loop
// cheap during extended outages.
const BACKOFF_CEILING_MS = 10 * 60 * 1000;

// How long we'll keep retrying a transcribe-memo row before giving up and
// dropping the blob. 24h is enough to cover overnight scribe downtime but
// avoids accumulating long-lived rows that will never complete (e.g. when a
// user pointed at a scribe instance that has since gone away).
export const TRANSCRIBE_GIVE_UP_MS = 24 * 60 * 60 * 1000;

function backoffFor(attempt: number): number {
  const base = 2 ** attempt * 1000;
  return Math.min(base, BACKOFF_CEILING_MS);
}

export interface EnqueueOptions {
  vaultId: string;
}

export async function enqueue(
  db: LensDB,
  mutation: PendingPayload,
  opts: EnqueueOptions,
): Promise<PendingRow> {
  const row: Omit<PendingRow, "seq"> = {
    id: crypto.randomUUID(),
    vaultId: opts.vaultId,
    mutation,
    createdAt: Date.now(),
    attemptCount: 0,
    nextAttemptAt: 0,
    status: "pending",
  };
  // The store is keyPath: "seq", autoIncrement, so add() returns the new seq.
  const seq = (await db.add("pending", row as PendingRow)) as number;
  return { ...row, seq };
}

export async function listPending(db: LensDB, vaultId?: string): Promise<PendingRow[]> {
  if (vaultId) return db.getAllFromIndex("pending", "by-vault", vaultId);
  return db.getAll("pending");
}

export async function countPending(db: LensDB, vaultId?: string): Promise<number> {
  if (vaultId) return db.countFromIndex("pending", "by-vault", vaultId);
  return db.count("pending");
}

export interface DrainContext {
  db: LensDB;
  client: VaultClient;
  vaultId: string;
  blobStore: BlobStore;
  // Optional per-vault scribe settings. When absent, transcribe-memo rows
  // are dropped (with a lastError explanation) rather than retried forever.
  scribeSettings?: ScribeSettings | null;
  // Injection for tests: lets us stub transcribeAudio without mocking fetch.
  transcribeImpl?: typeof transcribeAudio;
  now?: () => number;
}

// Drain every ready row for `vaultId` in FIFO (`seq`) order. Stops on auth
// error (halting the whole drain), continues past conflicts (stashed as
// needs-human), and defers rows whose backoff window hasn't elapsed.
export async function drain(ctx: DrainContext): Promise<DrainOutcome> {
  const now = ctx.now ?? (() => Date.now());
  const outcome: DrainOutcome = { drained: 0, stashed: 0, deferred: 0, authHalted: false };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = await nextReadyRow(ctx.db, ctx.vaultId, now());
    if (!next) break;

    try {
      await runMutation(ctx, next);
      await ctx.db.delete("pending", next.seq);
      outcome.drained += 1;
    } catch (err) {
      if (err instanceof VaultAuthError) {
        await setMeta(ctx.db, AUTH_HALT_META, {
          vaultId: ctx.vaultId,
          at: now(),
          message: err.message,
        });
        outcome.authHalted = true;
        // Leave the row in place for retry after reconnect.
        await bumpAttempt(ctx.db, next, err, now);
        outcome.deferred += 1;
        break;
      }
      if (err instanceof VaultConflictError) {
        await ctx.db.put("pending", {
          ...next,
          status: "needs-human",
          lastError: `Conflict: current=${err.currentUpdatedAt ?? "?"} expected=${
            err.expectedUpdatedAt ?? "?"
          }`,
          attemptCount: next.attemptCount + 1,
        });
        outcome.stashed += 1;
        continue;
      }
      if (err instanceof DeferRowError) {
        // A local/blob ref couldn't resolve — defer briefly; the next drain will retry.
        await ctx.db.put("pending", {
          ...next,
          attemptCount: next.attemptCount + 1,
          lastError: err.message,
          nextAttemptAt: now() + 5000,
        });
        outcome.deferred += 1;
        break;
      }
      if (err instanceof DropRowError) {
        // Terminal: remove the row, move on.
        await ctx.db.delete("pending", next.seq);
        outcome.drained += 1;
        continue;
      }
      if (err instanceof SkipNoClobberError) {
        // Surface in needs-human so the user can re-run transcription.
        await ctx.db.put("pending", {
          ...next,
          status: "needs-human",
          lastError: err.message,
          attemptCount: next.attemptCount + 1,
        });
        outcome.stashed += 1;
        continue;
      }
      if (err instanceof ScribeError) {
        // "unavailable" is transient — backoff and retry on the next tick.
        // "auth" we also treat as retryable (users may fix their token
        // without re-auth to the vault). "bad-request" / "parse" are terminal.
        if (err.kind === "unavailable" || err.kind === "auth") {
          await bumpAttempt(ctx.db, next, err, now);
          outcome.deferred += 1;
          break;
        }
        await ctx.db.delete("pending", next.seq);
        outcome.drained += 1;
        continue;
      }
      if (err instanceof VaultNotFoundError) {
        // Target is gone — drop the row rather than retry forever.
        await ctx.db.delete("pending", next.seq);
        outcome.drained += 1;
        continue;
      }
      await bumpAttempt(ctx.db, next, err, now);
      outcome.deferred += 1;
      // Don't spin the whole queue on a single flaky row — defer and let the
      // next tick retry.
      break;
    }
  }

  return outcome;
}

async function nextReadyRow(db: LensDB, vaultId: string, now: number): Promise<PendingRow | null> {
  // by-vault isn't a sorted-by-seq index, but IDB's default key order is the
  // primary key (seq) when iterating via the store. We filter vault + status
  // in-app for simplicity; the queue depth is small.
  const tx = db.transaction("pending", "readonly");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const row = cursor.value;
    if (row.vaultId === vaultId && row.status === "pending" && row.nextAttemptAt <= now) {
      return row;
    }
    cursor = await cursor.continue();
  }
  return null;
}

async function bumpAttempt(
  db: LensDB,
  row: PendingRow,
  err: unknown,
  now: () => number,
): Promise<void> {
  const attempts = row.attemptCount + 1;
  await db.put("pending", {
    ...row,
    attemptCount: attempts,
    nextAttemptAt: now() + backoffFor(attempts),
    lastError: err instanceof Error ? err.message : String(err),
  });
}

class DeferRowError extends Error {}

// A terminal error: this row cannot complete, remove it from the queue.
// Used when upstream state (config, blob, note) has gone away.
class DropRowError extends Error {}

// A "don't overwrite user content" signal — we stash the row as needs-human so
// the user can decide whether to re-run transcription later.
class SkipNoClobberError extends Error {}

async function runMutation(ctx: DrainContext, row: PendingRow): Promise<void> {
  const m = row.mutation;
  switch (m.kind) {
    case "create-note": {
      const created = await ctx.client.createNote(m.payload);
      await recordIdMap(ctx.db, m.localId, created.id, ctx.vaultId);
      return;
    }
    case "update-note": {
      const targetId = await resolveNoteId(ctx.db, m.targetId, ctx.vaultId);
      if (!targetId) {
        throw new DeferRowError(`Awaiting local id ${m.targetId}`);
      }
      await ctx.client.updateNote(targetId, m.payload);
      return;
    }
    case "delete-note": {
      const targetId = await resolveNoteId(ctx.db, m.targetId, ctx.vaultId);
      if (!targetId) {
        throw new DeferRowError(`Awaiting local id ${m.targetId}`);
      }
      await ctx.client.deleteNote(targetId);
      return;
    }
    case "upload-attachment": {
      const stored = await ctx.blobStore.get(m.blobId);
      if (!stored) {
        throw new DeferRowError(`Missing blob ${m.blobId}`);
      }
      const mimeType = stored.mimeType || m.mimeType;
      const file = new File([stored.data], m.filename, { type: mimeType });
      const uploaded = await ctx.client.uploadStorageFile(file);
      await recordBlobPath(ctx.db, m.blobId, uploaded.path, ctx.vaultId);
      // Keep the blob when a downstream transcribe-memo row still needs it;
      // that row owns cleanup.
      if (!m.retain) await ctx.blobStore.delete(m.blobId);
      return;
    }
    case "link-attachment": {
      const noteId = await resolveNoteId(ctx.db, m.noteId, ctx.vaultId);
      if (!noteId) {
        throw new DeferRowError(`Awaiting local id ${m.noteId}`);
      }
      let path: string | null = m.pathRef;
      if (isBlobRef(m.pathRef)) {
        path = await resolveBlobPath(ctx.db, m.pathRef, ctx.vaultId);
        if (!path) {
          throw new DeferRowError(`Awaiting blob ${blobIdFromRef(m.pathRef)}`);
        }
      }
      await ctx.client.linkAttachment(noteId, { path, mimeType: m.mimeType });
      return;
    }
    case "delete-attachment": {
      const noteId = await resolveNoteId(ctx.db, m.noteId, ctx.vaultId);
      if (!noteId) {
        throw new DeferRowError(`Awaiting local id ${m.noteId}`);
      }
      await ctx.client.deleteAttachment(noteId, m.attachmentId);
      return;
    }
    case "transcribe-memo": {
      await runTranscribeMemo(ctx, row, m);
      return;
    }
  }
}

async function runTranscribeMemo(
  ctx: DrainContext,
  row: PendingRow,
  m: Extract<PendingPayload, { kind: "transcribe-memo" }>,
): Promise<void> {
  const noteId = await resolveNoteId(ctx.db, m.noteId, ctx.vaultId);
  if (!noteId) throw new DeferRowError(`Awaiting local id ${m.noteId}`);

  const now = ctx.now ?? (() => Date.now());

  // Settings may have been cleared between enqueue and drain. We treat that
  // as a permanent failure (drop the row + blob) rather than retry forever.
  if (!ctx.scribeSettings?.url) {
    await ctx.blobStore.delete(m.blobId);
    throw new DropRowError("scribe not configured for this vault");
  }

  // Bail out if we've been retrying too long. Drop the blob and leave a
  // trailing footnote so the user knows transcription didn't run.
  if (now() - row.createdAt > TRANSCRIBE_GIVE_UP_MS) {
    await replaceMarkerIfPresent(ctx.client, noteId, m.marker, transcriptionUnavailableText());
    await ctx.blobStore.delete(m.blobId);
    throw new DropRowError("transcription gave up after 24h");
  }

  const stored = await ctx.blobStore.get(m.blobId);
  if (!stored) {
    // Blob was swept by some other path — nothing to transcribe.
    throw new DropRowError(`missing blob ${m.blobId}`);
  }

  // Don't clobber if the user already edited the note. We check server-side
  // because the local stub isn't authoritative (the user might have edited
  // on another device or tab).
  const note = await ctx.client.getNote(noteId);
  if (!note) {
    await ctx.blobStore.delete(m.blobId);
    throw new VaultNotFoundError(`note ${noteId} gone`);
  }
  const currentContent = note.content ?? "";
  if (!currentContent.includes(m.marker)) {
    // User edited ahead of us — surface as needs-human via conflict-like semantics.
    throw new SkipNoClobberError("note no longer contains transcript marker");
  }

  const transcribe = ctx.transcribeImpl ?? transcribeAudio;
  const result = await transcribe(ctx.scribeSettings.url, {
    audio: stored.data,
    filename: m.filename,
    mimeType: m.mimeType,
    cleanup: ctx.scribeSettings.cleanup,
    token: ctx.scribeSettings.token,
  });

  const transcriptBlock = transcriptBody(result.text.trim());
  const nextContent = currentContent.replace(m.marker, transcriptBlock);
  await ctx.client.updateNote(noteId, { content: nextContent });
  await ctx.blobStore.delete(m.blobId);
}

function transcriptBody(text: string): string {
  if (!text) return "_Transcription produced no text._";
  return `## Transcript\n\n${text}`;
}

function transcriptionUnavailableText(): string {
  return "_Transcription unavailable._";
}

async function replaceMarkerIfPresent(
  client: VaultClient,
  noteId: string,
  marker: string,
  replacement: string,
): Promise<void> {
  try {
    const note = await client.getNote(noteId);
    if (!note?.content?.includes(marker)) return;
    const next = note.content.replace(marker, replacement);
    await client.updateNote(noteId, { content: next });
  } catch {
    // Best-effort — if we can't reach the vault we just skip the footnote.
  }
}

export async function clearAuthHalt(db: LensDB): Promise<void> {
  await db.delete("meta", AUTH_HALT_META);
}

// Reset a stashed row so the next drain picks it back up. Used by the sync
// status panel's "Retry" action on a needs-human row. Clears the error
// counters so the row gets a fresh attempt budget, not a backoff from its
// previous failure.
export async function retryRow(db: LensDB, seq: number): Promise<void> {
  const row = await db.get("pending", seq);
  if (!row) return;
  await db.put("pending", {
    ...row,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: 0,
    lastError: undefined,
  });
}

// Drop a single pending row — used by "Discard" on a stashed row.
export async function discardRow(db: LensDB, seq: number): Promise<void> {
  await db.delete("pending", seq);
}

// Nuke every pending row for `vaultId`. Destructive escape hatch when a row
// is wedged in a way the user can't unpick inline. Does not touch blobs or
// id-map — those are cleaned by their own GC paths.
export async function clearPendingForVault(db: LensDB, vaultId: string): Promise<number> {
  const rows = await listPending(db, vaultId);
  const tx = db.transaction("pending", "readwrite");
  for (const row of rows) {
    await tx.store.delete(row.seq);
  }
  await tx.done;
  return rows.length;
}
