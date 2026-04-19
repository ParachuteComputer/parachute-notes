import type { CreateNotePayload, UpdateNotePayload } from "@/lib/vault/client";

// Shape of every row in the `pending` object store. Mutations flow through here
// FIFO by autoincrement `seq`. `targetId` may be a local-only ID that needs
// resolving against the id-map at drain time.
export type PendingKind =
  | "create-note"
  | "update-note"
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
}

export interface PendingDeleteNote {
  kind: "delete-note";
  targetId: string;
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
}

export interface PendingDeleteAttachment {
  kind: "delete-attachment";
  noteId: string;
  attachmentId: string;
}

export type PendingPayload =
  | PendingCreateNote
  | PendingUpdateNote
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
