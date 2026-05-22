import type { CreateNotePayload, UpdateNotePayload } from "@/lib/vault/client";
import type { LensSettingsPatch } from "@/lib/vault/settings";

// Shape of every row in the `pending` object store. Mutations flow through here
// FIFO by autoincrement `seq`. `targetId` may be a local-only ID that needs
// resolving against the id-map at drain time.
export type PendingKind =
  | "create-note"
  | "update-note"
  | "update-settings"
  | "delete-note"
  | "upload-attachment"
  | "link-attachment"
  | "delete-attachment";

export interface PendingCreateNote {
  kind: "create-note";
  // Local-only ID assigned at enqueue time so the UI has something to route on
  // immediately. When the drain succeeds, the server's real ID is mapped to this.
  localId: string;
  payload: CreateNotePayload;
}

export interface PendingUpdateNote {
  kind: "update-note";
  // Either a server ID or a local ID awaiting resolution via the id-map.
  targetId: string;
  payload: UpdateNotePayload;
  // Last-known `note.updatedAt` captured at enqueue time — supplied as
  // `if_updated_at` on drain so an offline write doesn't silently overwrite a
  // cross-device write that landed first. Optional for forward-compat with
  // rows enqueued before this field existed; the drain handler treats a
  // missing baseline like a 428 (refetch + retry).
  baselineUpdatedAt?: string;
}

export interface PendingDeleteNote {
  kind: "delete-note";
  targetId: string;
}

// Settings-note update. Carries the ORIGINAL patch (not a pre-merged full
// payload) so the drain handler can refetch the note, apply the patch onto
// whatever the server currently has, and PATCH with a fresh if_updated_at.
// A forced PATCH is the last-resort fallback after merge-retries are
// exhausted — otherwise we'd silently clobber another device's write that
// landed while we were offline.
export interface PendingUpdateSettings {
  kind: "update-settings";
  notePath: string;
  patch: LensSettingsPatch;
  // The serverUpdatedAt we last observed when the row was enqueued. Used as
  // the initial `if_updated_at`; stale by the time the drain runs, but the
  // drain refetches to recover a fresh baseline regardless.
  baselineUpdatedAt: string | null;
}

export interface PendingUploadAttachment {
  kind: "upload-attachment";
  // Reference into the blob-store (OPFS or IDB fallback).
  blobId: string;
  filename: string;
  mimeType: string;
}

export interface PendingLinkAttachment {
  kind: "link-attachment";
  // Either a server note ID or a local ID.
  noteId: string;
  // Either a storage path the vault already knows, or a `blob:<blobId>` reference
  // which resolves to the server path once the matching upload-attachment row drains.
  pathRef: string;
  mimeType: string;
  // When true, ask the vault to transcribe this attachment and overwrite the
  // note's `_Transcript pending._` placeholder with the transcript. Vault's
  // transcription-worker does the actual work — Notes just flags intent.
  transcribe?: boolean;
}

export interface PendingDeleteAttachment {
  kind: "delete-attachment";
  noteId: string;
  attachmentId: string;
}

export type PendingPayload =
  | PendingCreateNote
  | PendingUpdateNote
  | PendingUpdateSettings
  | PendingDeleteNote
  | PendingUploadAttachment
  | PendingLinkAttachment
  | PendingDeleteAttachment;

export type PendingStatus = "pending" | "needs-human";

export interface PendingRow {
  // Autoincrement primary key; determines FIFO drain order.
  seq: number;
  // Opaque client-side UUID, stable across the row's life for external reference.
  id: string;
  // Which vault this mutation targets — each has its own token + URL.
  vaultId: string;
  mutation: PendingPayload;
  createdAt: number;
  attemptCount: number;
  // When the engine should next attempt this row. Set on backoff; rows with
  // `nextAttemptAt > now` are skipped during drain.
  nextAttemptAt: number;
  lastError?: string;
  status: PendingStatus;
}

// Mapping of local → server IDs for notes created offline. Populated on
// successful create-note drain so subsequent update/delete rows can resolve.
export interface IdMapRow {
  localId: string;
  realId: string;
  vaultId: string;
  mappedAt: number;
}

// Mapping of blob-store blob-id → server storage path for attachments uploaded
// offline. Populated on upload-attachment drain so link-attachment rows resolve.
export interface BlobPathMapRow {
  blobId: string;
  serverPath: string;
  vaultId: string;
  mappedAt: number;
}

// Meta key/value store for engine state (schema version, auth-halted marker,
// storage-persist result).
export interface MetaRow {
  key: string;
  value: unknown;
}

export interface DrainOutcome {
  drained: number;
  stashed: number;
  deferred: number;
  authHalted: boolean;
}
