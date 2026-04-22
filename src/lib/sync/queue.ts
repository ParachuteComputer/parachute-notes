import {
  VaultAuthError,
  type VaultClient,
  VaultConflictError,
  VaultNotFoundError,
} from "@/lib/vault/client";
import {
  DEFAULT_LENS_SETTINGS,
  applySettingsPatch,
  extractLensSettings,
} from "@/lib/vault/settings";
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
    case "update-settings": {
      await drainUpdateSettings(ctx.client, m.notePath, m.patch);
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
      await ctx.blobStore.delete(m.blobId);
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
      await ctx.client.linkAttachment(noteId, {
        path,
        mimeType: m.mimeType,
        ...(m.transcribe ? { transcribe: true } : {}),
      });
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

// How many GET-merge-PATCH passes we take before resorting to a forced
// overwrite. Three is enough to handle normal interleaving with another
// device but low enough that a genuinely pathological conflict loop doesn't
// starve the drain.
const SETTINGS_MERGE_RETRIES = 3;

// Drain handler for `update-settings`. We refetch the settings note, merge
// the enqueued patch onto whatever the server currently shows, and PATCH
// with a fresh `if_updated_at`. On 409 we loop up to SETTINGS_MERGE_RETRIES
// times; only after that do we give up and force the write. This protects
// the invariant that offline settings writes merge with — never silently
// overwrite — writes made on other devices while this one was offline.
async function drainUpdateSettings(
  client: VaultClient,
  notePath: string,
  patch: import("@/lib/vault/settings").LensSettingsPatch,
): Promise<void> {
  for (let attempt = 0; attempt <= SETTINGS_MERGE_RETRIES; attempt++) {
    let note: Awaited<ReturnType<VaultClient["getNote"]>> = null;
    try {
      note = await client.getNote(notePath);
    } catch (err) {
      if (!(err instanceof VaultNotFoundError)) throw err;
    }

    if (!note) {
      // First-ever write for this vault — POST with the patch layered onto
      // defaults. The vault returns 409 if another device beat us to create,
      // which the outer retry loop handles by refetching.
      try {
        await client.createNote({
          path: notePath,
          content: "",
          metadata: { lens: applySettingsPatch(DEFAULT_LENS_SETTINGS, patch) },
        });
        return;
      } catch (err) {
        if (err instanceof VaultConflictError && attempt < SETTINGS_MERGE_RETRIES) {
          continue;
        }
        throw err;
      }
    }

    const server = extractLensSettings(note);
    const merged = applySettingsPatch(server, patch);
    const baseline = note.updatedAt ?? note.createdAt;
    try {
      await client.updateNote(notePath, {
        metadata: { lens: merged },
        if_updated_at: baseline,
      });
      return;
    } catch (err) {
      if (err instanceof VaultConflictError && attempt < SETTINGS_MERGE_RETRIES) {
        continue;
      }
      if (err instanceof VaultConflictError) {
        // Exhausted polite retries. Force the write — merged against the
        // latest server state we fetched, so this is still the "safest
        // possible overwrite" rather than a blind one.
        await client.updateNote(notePath, { metadata: { lens: merged }, force: true });
        return;
      }
      throw err;
    }
  }
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
