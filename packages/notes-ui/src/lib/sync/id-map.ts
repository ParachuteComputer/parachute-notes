import type { LensDB } from "./db";
import type { BlobPathMapRow, IdMapRow } from "./types";

export const LOCAL_ID_PREFIX = "local-";

export function newLocalId(): string {
  return `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

// Resolve a possibly-local note ID to its server-assigned ID. Returns null when
// the row is still a local ID that has not yet drained. Real IDs pass through.
export async function resolveNoteId(
  db: LensDB,
  id: string,
  vaultId: string,
): Promise<string | null> {
  if (!isLocalId(id)) return id;
  const row = await db.get("id_map", id);
  if (!row || row.vaultId !== vaultId) return null;
  return row.realId;
}

export async function recordIdMap(
  db: LensDB,
  localId: string,
  realId: string,
  vaultId: string,
): Promise<void> {
  const row: IdMapRow = { localId, realId, vaultId, mappedAt: Date.now() };
  await db.put("id_map", row);
}

export const BLOB_PATH_PREFIX = "blob:";

export function isBlobRef(pathRef: string): boolean {
  return pathRef.startsWith(BLOB_PATH_PREFIX);
}

export function blobRef(blobId: string): string {
  return `${BLOB_PATH_PREFIX}${blobId}`;
}

export function blobIdFromRef(pathRef: string): string {
  return pathRef.slice(BLOB_PATH_PREFIX.length);
}

export async function resolveBlobPath(
  db: LensDB,
  pathRef: string,
  vaultId: string,
): Promise<string | null> {
  if (!isBlobRef(pathRef)) return pathRef;
  const id = blobIdFromRef(pathRef);
  const row = await db.get("blob_path_map", id);
  if (!row || row.vaultId !== vaultId) return null;
  return row.serverPath;
}

export async function recordBlobPath(
  db: LensDB,
  blobId: string,
  serverPath: string,
  vaultId: string,
): Promise<void> {
  const row: BlobPathMapRow = { blobId, serverPath, vaultId, mappedAt: Date.now() };
  await db.put("blob_path_map", row);
}
